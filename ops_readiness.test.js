// ops_readiness.test.js -- the pure ops-readiness builder. PURE = deterministic given input,
// and (load-bearing) it must NEVER echo a secret value -- only presence.
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildOpsReadiness, CREDENTIAL_KEYS } from "./ops_readiness.js";

// A fully-ready fixture: db present, postgres on, all sources healthy, every key present.
const readyInput = () => ({
  now: "2026-06-30T00:00:00.000Z",
  node_version: "v22.0.0",
  platform: "linux",
  pid: 123,
  uptime_s: 42,
  db_path: "/app/crm.db",
  db_exists: true,
  db_size_bytes: 2_097_152, // 2 MiB
  backups_enabled: true,
  backup_dir: "/app/backups",
  backup_files: ["crm-1.db", "crm-2.db"],
  backup_last: "2026-06-30T00:00:00.000Z",
  postgres_configured: true,
  source_health: { enabled: true, rows: [{ source_id: "a", last_ok: true, success_rate: 100 }] },
  recent_source_runs: [],
  credentials: {
    rentcast_api_key: { present: true, source: "setting" },
    anthropic_api_key: { present: true, source: "env" },
    batchdata_api_key: { present: true, source: "setting" },
    google_maps_api_key: { present: true, source: "setting" },
    gmail_user: { present: true, source: "setting" },
    gmail_app_password: { present: true, source: "setting" },
  },
});

test("ready system: no blockers, operate/source/skiptrace all true", () => {
  const m = buildOpsReadiness(readyInput());
  assert.equal(m.overall.ready_to_operate, true);
  assert.equal(m.overall.ready_to_source, true);
  assert.equal(m.overall.ready_to_skiptrace, true);
  assert.deepEqual(m.overall.blockers, []);
  assert.equal(m.database.size_mb, 2);
  assert.equal(m.backup.status.startsWith("ok"), true);
  assert.equal(m.sources.healthy, 1);
});

test("missing database is a hard blocker and blocks operate/skiptrace", () => {
  const m = buildOpsReadiness({ ...readyInput(), db_exists: false });
  assert.equal(m.overall.ready_to_operate, false);
  assert.equal(m.overall.ready_to_skiptrace, false);
  assert.equal(m.overall.blockers.length, 1);
  assert.match(m.overall.blockers[0], /database file missing/);
});

test("missing BatchData key: skiptrace not ready, warning raised, operate still ok", () => {
  const input = readyInput();
  input.credentials.batchdata_api_key = { present: false, source: null };
  const m = buildOpsReadiness(input);
  assert.equal(m.overall.ready_to_operate, true);
  assert.equal(m.skiptrace.ready, false);
  assert.equal(m.skiptrace.provider_key_present, false);
  assert.ok(m.overall.warnings.some((w) => /BatchData key absent/.test(w)));
});

test("skiptrace stays spend-gated even when key present (presence != authorization)", () => {
  const m = buildOpsReadiness(readyInput());
  assert.equal(m.skiptrace.ready, true);
  assert.equal(m.skiptrace.spend_still_gated, true);
  assert.match(m.skiptrace.note, /skiptrace_gate/);
});

test("DNC posture is deny-until-checked and auto outreach is never allowed", () => {
  const m = buildOpsReadiness(readyInput());
  assert.equal(m.dnc.contact_gate_enforced, true);
  assert.equal(m.dnc.default_posture, "deny_until_checked");
  assert.equal(m.dnc.auto_outreach_allowed, false);
  assert.equal(m.overall.contact_posture, "deny_until_checked");
});

test("NO_BACKUP -> backup disabled, no 'no backups' warning", () => {
  const m = buildOpsReadiness({ ...readyInput(), backups_enabled: false, backup_files: [] });
  assert.equal(m.backup.enabled, false);
  assert.match(m.backup.status, /disabled/);
  assert.ok(!m.overall.warnings.some((w) => /backups on disk yet/.test(w)));
});

test("empty backup dir with backups enabled raises a warning", () => {
  const m = buildOpsReadiness({ ...readyInput(), backup_files: [] });
  assert.equal(m.backup.count, 0);
  assert.ok(m.overall.warnings.some((w) => /no database backups on disk/.test(w)));
});

test("no postgres -> source tracking off + warning", () => {
  const m = buildOpsReadiness({ ...readyInput(), postgres_configured: false, source_health: null });
  assert.equal(m.postgres.configured, false);
  assert.equal(m.sources.tracking_enabled, false);
  assert.ok(m.overall.warnings.some((w) => /DATABASE_URL not set/.test(w)));
});

test("failing source is counted as down and warned", () => {
  const m = buildOpsReadiness({
    ...readyInput(),
    source_health: { enabled: true, rows: [
      { source_id: "a", last_ok: true, success_rate: 100 },
      { source_id: "b", last_ok: false, success_rate: 0 },
      { source_id: "c", last_ok: true, success_rate: 50 }, // degraded
    ] },
  });
  assert.equal(m.sources.total, 3);
  assert.equal(m.sources.healthy, 1);
  assert.equal(m.sources.down, 1);
  assert.equal(m.sources.degraded, 1);
  assert.ok(m.overall.warnings.some((w) => /failing their last probe/.test(w)));
});

test("recent job failures surface from source runs and lead-engine error", () => {
  const m = buildOpsReadiness({
    ...readyInput(),
    recent_source_runs: [
      { source_id: "ok_src", ok: true },
      { source_id: "bad_src", ok: false, error_kind: "auth/quota", error: "401 bad key", ran_at: "2026-06-30T00:00:00Z" },
    ],
    last_lead_engine_error: "plan failed: no city",
  });
  assert.equal(m.recent_job_failures.length, 2);
  assert.equal(m.recent_job_failures[0].source, "bad_src");
  assert.equal(m.recent_job_failures[0].kind, "auth/quota");
  assert.equal(m.recent_job_failures[1].source, "lead_engine");
});

// ---- the load-bearing safety property ----
test("credentials carry PRESENCE ONLY -- a secret value can never leak through", () => {
  const SECRET = "sk-live-SUPER-SECRET-VALUE-123";
  const m = buildOpsReadiness({
    ...readyInput(),
    credentials: {
      // Defensive: a caller accidentally passes the raw secret instead of {present}.
      batchdata_api_key: SECRET,
      // Or passes an object with the secret smuggled in extra fields.
      anthropic_api_key: { present: true, source: "setting", value: SECRET, key: SECRET },
    },
  });
  const serialized = JSON.stringify(m);
  assert.equal(serialized.includes(SECRET), false, "secret value leaked into read-model");
  assert.equal(m.credentials.batchdata_api_key.present, true);
  assert.equal(m.credentials.batchdata_api_key.source, null);
  // extra smuggled fields are stripped -- only {present, source} survive
  assert.deepEqual(Object.keys(m.credentials.anthropic_api_key).sort(), ["present", "source"]);
});

test("every credential key is always present in the model (absent -> present:false)", () => {
  const m = buildOpsReadiness({ db_exists: true }); // minimal input, no credentials
  for (const k of CREDENTIAL_KEYS) {
    assert.equal(m.credentials[k].present, false, `${k} should default to not-present`);
    assert.equal(m.credentials[k].source, null);
  }
});

test("missing inputs degrade gracefully to nulls, not throws", () => {
  const m = buildOpsReadiness({});
  assert.equal(m.generated_at, null);
  assert.equal(m.database.exists, false);
  assert.equal(m.database.size_mb, null);
  assert.equal(m.server.status, "not_checked");
  // db missing -> blocker present
  assert.equal(m.overall.ready_to_operate, false);
});

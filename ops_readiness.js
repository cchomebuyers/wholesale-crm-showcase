// ops_readiness.js -- PURE read-model builder for operational readiness.
//
// One question, answered without reading code: "Is this system ready to source, enrich,
// skip-trace, DNC-check, and operate?" This module is PURE -- it performs NO I/O (no fs,
// no db, no env, no Date.now). The caller gathers raw facts and injects them; this builder
// derives the readiness read-model, computes blockers/warnings, and -- critically -- emits
// credential PRESENCE only (true/false + source), NEVER a secret value.
//
// Facts modeled here trace to:
//   - server.js:57   database lives at join(__dirname, "crm.db")  (db_path / db_size)
//   - server.js:2540-2560  backup dir listing + lastBackup        (backup status)
//   - server.js:1626-1629  rentcast/anthropic/batchdata/maps key presence (credentials)
//   - server.js:1155-1159  gmail_user / gmail_app_password settings (credentials)
//   - server.js:2624,2636  createSourceHealth + /api/sources/health (source health)
//   - skiptrace_gate.js     paid skip-trace is gated; key presence != authorization
//   - compliance_gate.js    contact stays outreach_allowed:false until DNC/consent verified
//
// Hard rule (CLAUDE.md ground rule #4): "No secrets in the substrate (store key *presence*,
// never the value)." This builder enforces that by coercing every credential to a boolean.

const bool = (v) => Boolean(v);
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : null);

// The credentials an operator may need wired before paid/contact workflows. Order is the
// display order. `gates` marks what each key unlocks (for the readiness narrative).
export const CREDENTIAL_KEYS = [
  "rentcast_api_key",
  "anthropic_api_key",
  "batchdata_api_key",
  "google_maps_api_key",
  "gmail_user",
  "gmail_app_password",
];

// Normalize a single credential input to PRESENCE ONLY. Anything the caller passes that is
// not {present, source} is dropped on the floor -- a secret value can never leak through here.
function normalizeCredential(raw) {
  if (raw === null || raw === undefined) return { present: false, source: null };
  if (typeof raw === "object") {
    return { present: bool(raw.present), source: raw.source ?? null };
  }
  // A bare truthy/falsey (or, defensively, an accidental secret string) -> just presence.
  return { present: bool(raw), source: null };
}

function summarizeSources(sourceHealth) {
  if (!sourceHealth || sourceHealth.enabled === false) {
    return { tracking_enabled: false, total: 0, healthy: 0, down: 0, degraded: 0, note: "Set DATABASE_URL (Postgres) to record source health (server.js:2624)." };
  }
  const rows = Array.isArray(sourceHealth.rows) ? sourceHealth.rows : [];
  let healthy = 0, down = 0, degraded = 0;
  for (const r of rows) {
    const lastOk = r.last_ok === true || r.last_ok === "t" || r.last_ok === 1;
    const rate = num(r.success_rate);
    if (!lastOk) down += 1;
    else if (rate !== null && rate < 100) degraded += 1;
    else healthy += 1;
  }
  return { tracking_enabled: true, total: rows.length, healthy, down, degraded, note: null };
}

function summarizeFailures(recentRuns, lastLeadEngineError) {
  const out = [];
  for (const r of Array.isArray(recentRuns) ? recentRuns : []) {
    const ok = r.ok === true || r.ok === "t" || r.ok === 1;
    if (ok) continue;
    out.push({
      source: r.source_id ?? null,
      kind: r.error_kind ?? null,
      // error text is a connector message (server.js source_runs.error), not a secret.
      error: r.error ? String(r.error).slice(0, 300) : null,
      at: r.ran_at ?? null,
    });
  }
  if (lastLeadEngineError) {
    out.push({ source: "lead_engine", kind: "job_error", error: String(lastLeadEngineError).slice(0, 300), at: null });
  }
  return out;
}

/**
 * Build the ops_readiness read-model from injected facts. PURE: no I/O.
 *
 * @param {object} input
 * @param {string}  [input.now]                 ISO timestamp (caller supplies; builder never calls Date)
 * @param {string}  [input.node_version]        process.version
 * @param {string}  [input.platform]            process.platform
 * @param {number}  [input.pid]
 * @param {number}  [input.uptime_s]
 * @param {boolean} [input.server_live]         optional liveness probe result (null = not checked)
 * @param {string}  [input.db_path]             absolute path to crm.db (server.js:57)
 * @param {boolean} [input.db_exists]
 * @param {number}  [input.db_size_bytes]
 * @param {boolean} [input.backups_enabled]     false when NO_BACKUP is set
 * @param {string}  [input.backup_dir]
 * @param {string[]}[input.backup_files]        filenames in the backup dir
 * @param {string}  [input.backup_last]         ISO of last in-process backup (server.js lastBackup)
 * @param {boolean} [input.postgres_configured] Boolean(DATABASE_URL)
 * @param {object}  [input.source_health]       { enabled, rows } from createSourceHealth().health()
 * @param {object[]}[input.recent_source_runs]  rows from createSourceHealth().recent()
 * @param {object}  [input.credentials]         map key -> {present, source} (PRESENCE ONLY)
 * @param {string}  [input.last_lead_engine_error]
 * @returns {object} ops_readiness read-model (no secret values)
 */
export function buildOpsReadiness(input = {}) {
  const blockers = [];
  const warnings = [];

  // ---- server / runtime ----
  const server = {
    node_version: input.node_version ?? null,
    platform: input.platform ?? null,
    pid: num(input.pid),
    uptime_s: num(input.uptime_s),
    status: input.server_live === true ? "live" : input.server_live === false ? "down" : "not_checked",
  };

  // ---- database ----
  const dbExists = bool(input.db_exists);
  const sizeBytes = num(input.db_size_bytes);
  const database = {
    path: input.db_path ?? null,
    exists: dbExists,
    size_bytes: sizeBytes,
    size_mb: sizeBytes === null ? null : Math.round((sizeBytes / 1048576) * 100) / 100,
  };
  if (!dbExists) blockers.push("database file missing -- the app cannot store leads (server.js:57)");

  // ---- backup ----
  const backupFiles = Array.isArray(input.backup_files) ? input.backup_files : [];
  const backupsEnabled = input.backups_enabled !== false; // default on unless explicitly disabled
  const backup = {
    enabled: backupsEnabled,
    dir: input.backup_dir ?? null,
    count: backupFiles.length,
    last: input.backup_last ?? null,
    latest: backupFiles.length ? backupFiles[backupFiles.length - 1] : null,
    status: !backupsEnabled
      ? "disabled (NO_BACKUP set)"
      : backupFiles.length === 0
      ? "no backups on disk yet"
      : `ok -- ${backupFiles.length} backup(s) on disk`,
  };
  if (backupsEnabled && backupFiles.length === 0) warnings.push("no database backups on disk yet (POST /api/backup, server.js:2553)");

  // ---- postgres / source health ----
  const postgres = { configured: bool(input.postgres_configured) };
  const sources = summarizeSources(input.source_health);
  if (!postgres.configured) warnings.push("DATABASE_URL not set -- source-health tracking is off (server.js:2624)");
  if (sources.down > 0) warnings.push(`${sources.down} data source(s) failing their last probe (GET /api/sources/health)`);

  // ---- credentials (PRESENCE ONLY) ----
  const rawCreds = input.credentials || {};
  const credentials = {};
  for (const k of CREDENTIAL_KEYS) credentials[k] = normalizeCredential(rawCreds[k]);

  // ---- skiptrace readiness ----
  // Key presence makes paid skip-trace *possible*; skiptrace_gate.js still decides per-record
  // whether spend is justified. Presence != authorization.
  const batchdataPresent = credentials.batchdata_api_key.present;
  const skiptrace = {
    ready: batchdataPresent,
    provider: "batchdata",
    provider_key_present: batchdataPresent,
    spend_still_gated: true,
    note: "skiptrace_gate.js gates every lookup: spend only on spend-eligible tier + known owner + distress + (ARV or buyer demand).",
  };
  if (!batchdataPresent) warnings.push("BatchData key absent -- cannot skip-trace for phone numbers (server.js:949)");

  // ---- DNC / contact readiness ----
  // compliance_gate.js is authoritative and DENY-by-default: a found phone/email is NOT callable
  // until DNC + consent are verified per channel/jurisdiction. The system is "ready to contact"
  // only in the sense that this gate is enforced; individual contacts still require a DNC check.
  const dnc = {
    contact_gate_enforced: true,
    default_posture: "deny_until_checked",
    auto_outreach_allowed: false,
    note: "compliance_gate.js: outreach_allowed stays false until DNC/consent verified (call needs DNC clear; sms/email need consent; mail is ungated).",
  };

  // ---- recent job failures ----
  const recent_job_failures = summarizeFailures(input.recent_source_runs, input.last_lead_engine_error);

  // ---- overall verdict ----
  const ready_to_operate = blockers.length === 0;
  const ready_to_source = ready_to_operate; // sourcing uses free connectors; no paid key required
  const ready_to_skiptrace = ready_to_operate && skiptrace.ready;

  return {
    generated_at: input.now ?? null,
    overall: {
      ready_to_operate,
      ready_to_source,
      ready_to_skiptrace,
      // Contact is never globally "ready" -- it is per-contact, gated. We surface the posture.
      contact_posture: dnc.default_posture,
      blockers,
      warnings,
    },
    server,
    database,
    backup,
    postgres,
    sources,
    credentials,
    skiptrace,
    dnc,
    recent_job_failures,
  };
}

export default buildOpsReadiness;

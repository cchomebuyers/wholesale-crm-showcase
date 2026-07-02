// tools/ops_readiness_report.mjs -- gather real ops facts and print the ops_readiness JSON.
//
// This is the read-only surface for the pure builder in ../ops_readiness.js. The protocol for
// the 2026-06-30 audit run makes CALLNOW the sole editor of server.js, so ops readiness is
// exposed as a SCRIPT instead of an HTTP route (the loop prompt allows "endpoint OR script").
//
// It NEVER prints secret values -- only credential PRESENCE (true/false + where it came from).
// It does NOT boot the server and does NOT create backups. Postgres source-health is read only
// if DATABASE_URL is set, behind a short timeout so a missing DB cannot hang the report.
//
//   Usage:  node tools/ops_readiness_report.mjs            # pretty JSON to stdout
//           node tools/ops_readiness_report.mjs --compact  # single-line JSON
//
// Facts traced to server.js:57 (db path), :2538 (backups dir), :1626-1629 & :1155-1159
// (credential settings), :2624/:2636 (source health). See ../docs/ops_readiness.md.

import { DatabaseSync } from "node:sqlite";
import { existsSync, statSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { buildOpsReadiness, CREDENTIAL_KEYS } from "../ops_readiness.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

// setting key -> env var fallback (mirrors server.js getSetting(k) || process.env.X)
const ENV_FOR = {
  rentcast_api_key: "RENTCAST_API_KEY",
  anthropic_api_key: "ANTHROPIC_API_KEY",
  batchdata_api_key: "BATCHDATA_API_KEY",
  google_maps_api_key: "GOOGLE_MAPS_API_KEY",
  gmail_user: "GMAIL_USER",
  gmail_app_password: "GMAIL_APP_PASSWORD",
};

function readSettings(dbPath) {
  // Open read-only so this report never mutates or VACUUMs the live DB.
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    const get = db.prepare("SELECT value FROM settings WHERE key = ?");
    const settingPresent = (k) => {
      try {
        const row = get.get(k);
        return Boolean(row && row.value);
      } catch {
        return false;
      }
    };
    const settingValue = (k) => {
      try {
        const row = get.get(k);
        return row ? row.value : null;
      } catch {
        return null;
      }
    };
    return { settingPresent, settingValue, close: () => db.close() };
  } catch (e) {
    db.close();
    throw e;
  }
}

// Credential PRESENCE only. Never returns the value.
function credentialPresence({ settingPresent }) {
  const creds = {};
  for (const k of CREDENTIAL_KEYS) {
    const inSetting = settingPresent ? settingPresent(k) : false;
    const inEnv = Boolean(process.env[ENV_FOR[k]]);
    creds[k] = {
      present: inSetting || inEnv,
      source: inSetting ? "setting" : inEnv ? "env" : null,
    };
  }
  return creds;
}

const withTimeout = (p, ms) =>
  Promise.race([p, new Promise((resolve) => setTimeout(() => resolve(null), ms))]);

async function gatherSourceHealth() {
  if (!process.env.DATABASE_URL) return { source_health: null, recent_source_runs: null };
  try {
    const { createSourceHealth } = await import("../source_health.js");
    const sh = createSourceHealth(process.env.DATABASE_URL, () => ({}));
    if (!sh) return { source_health: null, recent_source_runs: null };
    const health = await withTimeout(sh.health(), 4000).catch(() => null);
    const recent = await withTimeout(sh.recent(50), 4000).catch(() => null);
    try { await sh.pool.end(); } catch {}
    return {
      source_health: health ? { enabled: true, rows: health } : null,
      recent_source_runs: Array.isArray(recent) ? recent : null,
    };
  } catch {
    return { source_health: null, recent_source_runs: null };
  }
}

async function main() {
  const dbPath = join(ROOT, "crm.db");
  const dbExists = existsSync(dbPath);
  const dbSize = dbExists ? statSync(dbPath).size : null;

  let settings = { settingPresent: () => false, settingValue: () => null, close: () => {} };
  if (dbExists) {
    try { settings = readSettings(dbPath); } catch { /* fall back to env-only presence */ }
  }

  const backupDir = join(ROOT, "backups");
  const backupFiles = existsSync(backupDir)
    ? readdirSync(backupDir).filter((f) => f.startsWith("crm-") && f.endsWith(".db")).sort()
    : [];

  const credentials = credentialPresence(settings);
  const lastLeadEngineError = settings.settingValue("last_lead_engine_error");

  const { source_health, recent_source_runs } = await gatherSourceHealth();
  try { settings.close(); } catch {}

  const model = buildOpsReadiness({
    now: new Date().toISOString(),
    node_version: process.version,
    platform: process.platform,
    pid: process.pid,
    uptime_s: Math.round(process.uptime()),
    server_live: null, // this script does not boot or probe the server
    db_path: dbPath,
    db_exists: dbExists,
    db_size_bytes: dbSize,
    backups_enabled: !process.env.NO_BACKUP,
    backup_dir: backupDir,
    backup_files: backupFiles,
    backup_last: null, // in-process lastBackup is server-only state; not available to this script
    postgres_configured: Boolean(process.env.DATABASE_URL),
    source_health,
    recent_source_runs,
    credentials,
    last_lead_engine_error: lastLeadEngineError,
  });

  // Live operational counters (additive — appended after the pure build so the
  // buildOpsReadiness contract/tests stay untouched). Sources: dnc_records
  // (verdicts by status), call_outcomes (dials + permanent suppressions),
  // pipeline_runs (last one-button run), buyers (active list size).
  try {
    const { DatabaseSync } = await import("node:sqlite");
    const ldb = new DatabaseSync(dbPath, { readOnly: true });
    const safe = (fn, d) => { try { return fn(); } catch { return d; } };
    model.live_counts = {
      dnc_records: safe(() => Object.fromEntries(ldb.prepare("SELECT status, COUNT(*) n FROM dnc_records GROUP BY status").all().map((r) => [r.status, r.n])), {}),
      call_outcomes: safe(() => ldb.prepare("SELECT COUNT(*) c FROM call_outcomes").get().c, 0),
      outreach_suppressed_properties: safe(() => ldb.prepare("SELECT COUNT(DISTINCT property_id) c FROM call_outcomes WHERE outreach_suppressed=1").get().c, 0),
      active_buyers: safe(() => ldb.prepare("SELECT COUNT(*) c FROM buyers").get().c, 0),
      last_pipeline_run: safe(() => {
        const r = ldb.prepare("SELECT id, status, finished_at, preset FROM pipeline_runs ORDER BY id DESC LIMIT 1").get();
        return r ? { id: r.id, status: r.status, preset: r.preset, finished_at: r.finished_at } : null;
      }, null),
    };
    ldb.close();
  } catch { /* db absent — model stands on its own */ }

  const compact = process.argv.includes("--compact");
  process.stdout.write(JSON.stringify(model, null, compact ? 0 : 2) + "\n");
}

main().catch((e) => {
  process.stderr.write("ops_readiness_report failed: " + (e && e.message ? e.message : String(e)) + "\n");
  process.exit(1);
});

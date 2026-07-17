#!/usr/bin/env node
// ============================================================================
// Agent 7 — System Doctor: one health pass over the whole machine.
// ============================================================================
// Checks, in order: server up → db integrity/orphans → backup freshness →
// inbox-sync freshness → funnel health → recent server.log errors →
// integration key *presence* (names only, never values — CLAUDE.md rule 4).
// Each failing check files ONE actionable "Fix: …" task (idempotent while
// open) and the run ends with a digest in agent_runs. Run once and exit:
//   node focus/agents/doctor.mjs

import { existsSync, readdirSync, statSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { openFocusDb, DB_PATH, todayStart } from "../focus-data.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");
const CRM_URL = process.env.CRM_URL || "http://localhost:4000";

if (!existsSync(DB_PATH)) { console.error(`crm.db not found at ${DB_PATH}`); process.exit(1); }
const store = openFocusDb();
const db = store.db;

const results = []; // { name, level: 'ok'|'warn'|'critical', detail, task? }
const ok = (name, detail) => results.push({ name, level: "ok", detail });
const warn = (name, detail, task) => results.push({ name, level: "warn", detail, task });
const critical = (name, detail, task) => results.push({ name, level: "critical", detail, task });
const getSetting = (k) => { try { return db.prepare("SELECT value FROM settings WHERE key=?").get(k)?.value ?? null; } catch { return null; } };
const count = (sql) => { try { return db.prepare(sql).get()?.n ?? 0; } catch { return 0; } };
const ago = (ms) => ms < 3_600_000 ? `${Math.round(ms / 60000)}m` : ms < 86_400_000 ? `${(ms / 3_600_000).toFixed(1)}h` : `${(ms / 86_400_000).toFixed(1)}d`;

// 1 · Server up — the whole product hangs off :4000, so down is CRITICAL.
try {
  const res = await fetch(`${CRM_URL}/api/health`, { signal: AbortSignal.timeout(2000) });
  if (res.ok) ok("server", `responding at ${CRM_URL}`);
  else critical("server", `HTTP ${res.status}`, `Fix: CRM server unhealthy (HTTP ${res.status} from /api/health) — check server.log / launchd`);
} catch (e) {
  critical("server", e.message, `Fix: CRM server down at ${CRM_URL} — check launchd job and server.log`);
}

// 2 · DB integrity + orphaned rows pointing at deleted leads.
try {
  const check = db.prepare("PRAGMA quick_check").get();
  const verdict = String(Object.values(check || {})[0] ?? "");
  if (verdict === "ok") ok("db", "quick_check ok");
  else critical("db", verdict, `Fix: crm.db failed quick_check (${verdict.slice(0, 80)}) — restore latest backup from backups/`);
  const orphans = {
    activities: count("SELECT COUNT(*) n FROM activities a WHERE a.lead_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM leads l WHERE l.id=a.lead_id)"),
    emails: count("SELECT COUNT(*) n FROM emails e WHERE e.lead_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM leads l WHERE l.id=e.lead_id)"),
    tasks: count("SELECT COUNT(*) n FROM tasks t WHERE t.lead_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM leads l WHERE l.id=t.lead_id)"),
  };
  const total = orphans.activities + orphans.emails + orphans.tasks;
  const parts = Object.entries(orphans).filter(([, n]) => n > 0).map(([t, n]) => `${n} ${t}`).join(", ");
  if (total === 0) ok("orphans", "no orphaned rows");
  else warn("orphans", parts, `Fix: ${total} orphaned rows (${parts}) reference deleted leads — clean up crm.db`);
} catch (e) {
  critical("db", e.message, `Fix: crm.db integrity check errored (${e.message.slice(0, 80)}) — inspect the database`);
}

// 3 · Backups fresh — server.js snapshots into backups/; stale means no safety net.
try {
  const dir = join(ROOT, "backups");
  const newest = readdirSync(dir)
    .map((f) => { try { return statSync(join(dir, f)).mtimeMs; } catch { return 0; } })
    .reduce((a, b) => Math.max(a, b), 0);
  const age = Date.now() - newest;
  if (!newest) warn("backups", "no backup files", "Fix: no database backups found in backups/ — check the backup job");
  else if (age > 12 * 3_600_000) warn("backups", `newest ${ago(age)} old`, `Fix: newest backup is stale — check the backup job in server.js`);
  else ok("backups", `newest ${ago(age)} old`);
} catch (e) {
  warn("backups", e.message, "Fix: backups/ directory unreadable — check the backup job");
}

// 4 · Inbox sync fresh — auto-sync runs every 10 min; >30 min means IMAP broke.
try {
  const syncedAt = getSetting("inbox_synced_at");
  const age = syncedAt ? Date.now() - Date.parse(syncedAt) : NaN;
  if (!syncedAt) warn("inbox", "never synced", "Fix: inbox has never synced — connect Gmail in Settings");
  else if (!(age < 30 * 60_000)) warn("inbox", `stale ${ago(age)}`, `Fix: inbox sync stale ${ago(age)} — check Gmail IMAP`);
  else ok("inbox", `synced ${ago(age)} ago`);
} catch (e) { warn("inbox", e.message, "Fix: inbox sync status unreadable — check settings table"); }

// 5 · Funnel health — leads the machine literally can't move.
try {
  const uncontactable = count(`SELECT COUNT(*) n FROM leads WHERE active=1 AND stage NOT IN ('Closed','Dead')
    AND (seller_email IS NULL OR TRIM(seller_email)='') AND (seller_phone IS NULL OR TRIM(seller_phone)='')`);
  const staleNew = count(`SELECT COUNT(*) n FROM leads WHERE active=1 AND stage='New'
    AND updated_at < '${new Date(Date.now() - 3 * 86_400_000).toISOString()}'`);
  const offerReady = count(`SELECT COUNT(*) n FROM leads WHERE active=1 AND stage NOT IN ('Dead','Closed','Assigned')
    AND seller_email IS NOT NULL AND TRIM(seller_email) != ''
    AND COALESCE(offer_amount, mao) > 0 AND offer_sent_at IS NULL`);
  if (uncontactable > 0) warn("funnel-contact", `${uncontactable} uncontactable`, `Fix: ${uncontactable} active leads have no email or phone — find contact info`);
  else ok("funnel-contact", "every active lead reachable");
  if (staleNew > 0) warn("funnel-new", `${staleNew} New >3d`, `Fix: ${staleNew} leads sitting in New for 3+ days — triage them`);
  else ok("funnel-new", "no stale New leads");
  if (offerReady > 0) warn("funnel-offers", `${offerReady} offer-ready unsent`, `Fix: ${offerReady} offer-ready leads with no offer sent — run Sonny Emailer`);
  else ok("funnel-offers", "no offer-ready leads waiting");
} catch (e) { warn("funnel", e.message, "Fix: funnel health query failed — inspect leads table"); }

// 6 · server.log recent errors — last 200 lines, cosmetic noise excluded.
try {
  const logPath = join(ROOT, "server.log");
  if (!existsSync(logPath)) ok("log", "no server.log");
  else {
    const lines = readFileSync(logPath, "utf8").split("\n").slice(-200);
    const cosmetic = /DeprecationWarning|ExperimentalWarning|punycode|node --trace/i;
    const errs = lines.filter((l) => /error/i.test(l) && !cosmetic.test(l));
    if (!errs.length) ok("log", "no recent errors");
    else {
      // top distinct message = the most repeated error line (digits stripped so timestamps/ids collapse)
      const tally = new Map();
      for (const l of errs) { const k = l.replace(/\d+/g, "#").trim().slice(0, 120); tally.set(k, (tally.get(k) || 0) + 1); }
      const [top] = [...tally.entries()].sort((a, b) => b[1] - a[1]);
      warn("log", `${errs.length} error lines; top: ${top[0]}`, `Fix: ${errs.length} recent errors in server.log — top: ${top[0].slice(0, 90)}`);
    }
  }
} catch (e) { warn("log", e.message, "Fix: server.log unreadable — check permissions"); }

// 7 · Integration presence — key NAMES only, never values (CLAUDE.md rule 4).
try {
  const KEYS = ["gmail_user", "gmail_app_password", "anthropic_api_key", "rentcast_api_key", "batchdata_api_key"];
  const missing = KEYS.filter((k) => { const v = getSetting(k); return v === null || String(v).trim() === ""; });
  if (!missing.length) ok("integrations", "all keys present");
  else warn("integrations", `missing: ${missing.join(", ")}`, `Fix: missing integration keys — add ${missing.join(", ")} in Settings`);
} catch (e) { warn("integrations", e.message, "Fix: settings table unreadable — inspect crm.db"); }

// --- file tasks + digest -----------------------------------------------------
let filed = 0;
for (const r of results) {
  if (!r.task) continue;
  try { const t = store.addTaskOnce(r.task, { dueDate: todayStart() }); if (!t.skipped) filed++; } catch { /* keep going */ }
}
const n = (lv) => results.filter((r) => r.level === lv).length;
const digest = `${n("critical")} critical, ${n("warn")} warn, ${n("ok")} ok — ${filed ? `${filed} tasks filed` : "no new tasks"}`;
for (const r of results.filter((r) => r.level !== "ok")) console.error(`  ${r.level.toUpperCase()} ${r.name}: ${r.detail}`);
console.log(`doctor: ${digest}`);
store.recordAgentRun("doctor", digest);
store.close();

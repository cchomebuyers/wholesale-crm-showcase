#!/usr/bin/env node
// ============================================================================
// Agent — Reply Triage: no seller/agent reply goes cold.
// ============================================================================
// Scans inbound emails that are matched to a lead, classifies each with
// deterministic rules (no AI dependency), files the right follow-up task and
// logs a triage activity on the lead. The `[triage #<email id>]` marker in the
// activity body is the dedupe key, so re-runs are idempotent. NEVER kills a
// lead — "not interested" files a "Confirm dead?" task for the human.
//   node focus/agents/replies.mjs

import { existsSync } from "node:fs";
import { openFocusDb, DB_PATH, todayStart } from "../focus-data.mjs";

if (!existsSync(DB_PATH)) { console.error(`crm.db not found at ${DB_PATH}`); process.exit(1); }
const store = openFocusDb();
const db = store.db;
const nowIso = () => new Date().toISOString();

// --- Deterministic classifier (subject + body, lowercased) ------------------
const RE_INTERESTED = /\b(yes|interested|call me|let'?s talk|sounds good|when can|works for me)\b/;
const RE_NOT_INTERESTED = /\b(not interested|no thanks|stop|remove|unsubscribe|already sold|off the market)\b/;
const RE_PRICE_WORDS = /\b(want|asking|take|counter|price)\b/;

function hasCounterAmount(text) {
  // A $ amount, or a bare number >= 1000, within ~40 chars of a price-y word.
  for (const m of text.matchAll(/\$\s*[\d,]+(?:\.\d+)?|\b\d{1,3}(?:,\d{3})+\b|\b\d+(?:\.\d+)?\s*[km]?\b/g)) {
    const raw = m[0];
    let val = parseFloat(raw.replace(/[$,\s]/g, ""));
    if (/k\s*$/i.test(raw)) val *= 1000;
    if (/m\s*$/i.test(raw)) val *= 1000000;
    const dollar = raw.includes("$");
    if (!dollar && !(val >= 1000)) continue;
    const around = text.slice(Math.max(0, m.index - 40), m.index + raw.length + 40);
    if (RE_PRICE_WORDS.test(around)) return true;
  }
  return false;
}

function classify(subject, body) {
  const text = `${subject || ""} ${body || ""}`.toLowerCase();
  if (RE_NOT_INTERESTED.test(text)) return "not_interested"; // opt-outs win — never mis-file "not interested" as interested
  if (hasCounterAmount(text)) return "counter";
  if (RE_INTERESTED.test(text)) return "interested";
  if (text.includes("?")) return "question";
  return "other";
}

// --- Select inbound, lead-matched, not-yet-triaged emails --------------------
let emails = [];
try {
  emails = db.prepare(
    `SELECT e.id, e.lead_id, e.from_addr, e.subject, e.body, e.msg_date FROM emails e
     WHERE e.direction='in' AND e.lead_id IS NOT NULL
     ORDER BY e.msg_date ASC LIMIT 50`).all();
} catch (e) { console.error(`replies: query failed: ${e.message}`); }

const alreadyTriaged = db.prepare(
  "SELECT 1 FROM activities WHERE lead_id=? AND body LIKE '%[triage #' || ? || ']%'");
const getLead = db.prepare("SELECT id, address, seller_name, stage FROM leads WHERE id=?");
const addActivity = db.prepare("INSERT INTO activities (lead_id, created_at, type, body) VALUES (?,?,?,?)");
const setStage = db.prepare("UPDATE leads SET stage='Follow-Up', updated_at=? WHERE id=?");

const counts = { interested: 0, counter: 0, not_interested: 0, question: 0, other: 0 };
let triaged = 0, tasksFiled = 0;

for (const e of emails) {
  try {
    // Dedupe on the [triage #id] marker. Bind the id as TEXT — a number binds
    // as REAL here, and '…' || 41.0 builds the wrong LIKE pattern.
    if (alreadyTriaged.get(e.lead_id, String(e.id))) continue;

    const lead = getLead.get(e.lead_id);
    const where = lead?.address || e.from_addr || `lead #${e.lead_id}`;
    const cls = classify(e.subject, e.body);
    const today = todayStart();

    if (cls === "interested") {
      const r = store.addTaskOnce(`Call back — INTERESTED: ${where}`, { leadId: e.lead_id, dueDate: today });
      if (!r.skipped) tasksFiled++;
      if (lead && (lead.stage === "New" || lead.stage === "Contacted")) {
        setStage.run(nowIso(), e.lead_id);
        addActivity.run(e.lead_id, nowIso(), "stage_change", `Stage: ${lead.stage} → Follow-Up (reply triage)`);
      }
    } else if (cls === "counter") {
      const r = store.addTaskOnce(`Counter received: ${where} — review reply & respond`, { leadId: e.lead_id, dueDate: today });
      if (!r.skipped) tasksFiled++;
    } else if (cls === "not_interested") {
      // Human decides — no stage change, never auto-kill.
      const r = store.addTaskOnce(`Confirm dead? ${where} — reply says not interested`, { leadId: e.lead_id, dueDate: today });
      if (!r.skipped) tasksFiled++;
    } else { // question / other
      const r = store.addTaskOnce(`Reply needs answer: ${where}`, { leadId: e.lead_id, dueDate: today });
      if (!r.skipped) tasksFiled++;
    }

    const excerpt = String(e.body || e.subject || "").replace(/\s+/g, " ").trim().slice(0, 120);
    addActivity.run(e.lead_id, nowIso(), "note", `🤖 Reply triage (${cls}): "${excerpt}" [triage #${e.id}]`);
    counts[cls]++;
    triaged++;
  } catch (err) { console.error(`replies: skipped email ${e.id}: ${err.message}`); }
}

const digest = triaged === 0
  ? "0 new replies"
  : `${triaged} triaged (${counts.interested} interested, ${counts.counter} counter, ${counts.not_interested} dead?, ${counts.question} question, ${counts.other} other) — ${tasksFiled} tasks filed`;
console.log(`replies: ${digest}`);
store.recordAgentRun("replies", digest);
store.close();

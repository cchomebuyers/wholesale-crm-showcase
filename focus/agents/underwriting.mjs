#!/usr/bin/env node
// ============================================================================
// Agent 2 — Underwriting Analyst: every lead gets a number.
// ============================================================================
// For open leads that have an ARV but no MAO: compute the 70%-rule numbers
// (MAO = ARV × 0.70 − repairs − target fee), write them to the lead, and file
// a "Send offer" approval task. Leads with NO ARV get an "Underwrite (needs
// comps)" task instead — comps stay a human/connector step for now.
//   node focus/agents/underwriting.mjs   (UW_TARGET_FEE=10000 UW_REPAIR_PCT=0.10)

import { existsSync } from "node:fs";
import { openFocusDb, DB_PATH, todayStart } from "../focus-data.mjs";

if (!existsSync(DB_PATH)) { console.error(`crm.db not found at ${DB_PATH}`); process.exit(1); }
const TARGET_FEE = +(process.env.UW_TARGET_FEE || 10000);
const REPAIR_PCT = +(process.env.UW_REPAIR_PCT || 0.10); // fallback when no estimate
const store = openFocusDb();
const db = store.db;
const now = new Date().toISOString();
const money = (v) => "$" + Math.round(v).toLocaleString("en-US");

let priced = 0, flagged = 0;

// (a) ARV known, MAO missing → price it
let ready = [];
try {
  ready = db.prepare(
    `SELECT id, address, arv, repair_estimate FROM leads
     WHERE active=1 AND stage NOT IN ('Closed','Dead')
       AND arv IS NOT NULL AND arv > 0 AND (mao IS NULL OR mao <= 0)
     LIMIT 20`).all();
} catch { /* fresh db */ }
for (const l of ready) {
  const repairs = l.repair_estimate && l.repair_estimate > 0 ? l.repair_estimate : Math.round(l.arv * REPAIR_PCT);
  const mao = Math.max(0, Math.round(l.arv * 0.70 - repairs - TARGET_FEE));
  if (mao <= 0) { flagged++; store.addTaskOnce(`Underwrite ${l.address || "lead #" + l.id} — 70% rule negative, needs judgment`, { leadId: l.id, dueDate: todayStart() }); continue; }
  db.prepare("UPDATE leads SET mao=?, repair_estimate=?, offer_amount=COALESCE(offer_amount, ?), assignment_fee=COALESCE(assignment_fee, ?), uw_at=?, updated_at=? WHERE id=?")
    .run(mao, repairs, mao, TARGET_FEE, now, now, l.id);
  try {
    db.prepare("INSERT INTO activities (lead_id, created_at, type, body) VALUES (?,?,?,?)")
      .run(l.id, now, "note", `🤖 Underwriting: ARV ${money(l.arv)} × 0.70 − repairs ${money(repairs)} − fee ${money(TARGET_FEE)} = MAO ${money(mao)}`);
  } catch { /* activities optional */ }
  store.addTaskOnce(`Send offer on ${l.address || "lead #" + l.id} — MAO ${money(mao)}`, { leadId: l.id, dueDate: todayStart() });
  priced++;
}

// (b) no ARV → queue for comps
let needsComps = [];
try {
  needsComps = db.prepare(
    `SELECT id, address FROM leads
     WHERE active=1 AND stage NOT IN ('Closed','Dead') AND (arv IS NULL OR arv <= 0)
     ORDER BY updated_at DESC LIMIT 10`).all();
} catch { /* fresh db */ }
for (const l of needsComps) {
  store.addTaskOnce(`Underwrite ${l.address || "lead #" + l.id} (needs comps/ARV)`, { leadId: l.id });
}

const digest = `${priced} leads priced (MAO written + offer task filed), ${needsComps.length} queued for comps, ${flagged} flagged for judgment`;
console.log(`underwriting: ${digest}`);
store.recordAgentRun("underwriting", digest);
store.close();

#!/usr/bin/env node
// ============================================================================
// Agent 4 — Momentum Keeper: nothing in the pipeline goes stale silently.
// ============================================================================
// Scans the live crm.db for (a) lead follow-ups due/overdue, (b) property call
// follow-ups due, (c) leads stuck in one stage too long — and files each as a
// dated task (idempotent: exact-title dedupe while open). Run once and exit:
//   node focus/agents/momentum.mjs        (STUCK_DAYS=7 to tune)

import { existsSync } from "node:fs";
import { openFocusDb, DB_PATH, todayStart } from "../focus-data.mjs";

if (!existsSync(DB_PATH)) { console.error(`crm.db not found at ${DB_PATH}`); process.exit(1); }
const STUCK_DAYS = +(process.env.STUCK_DAYS || 7);
const store = openFocusDb();
const today = todayStart();
let created = 0, skipped = 0;
const file = (title, opts) => { const r = store.addTaskOnce(title, opts); r.skipped ? skipped++ : created++; return r; };

// (a) + (b) — everything the dashboard already counts as due
const due = store.followupsDue();
for (const f of due.leads) {
  file(`Follow up: ${f.seller_name || "seller"} — ${f.address || "lead #" + f.id}`, { leadId: f.id, dueDate: today });
}
for (const c of due.calls) {
  file(`Call back: ${c.address || c.formatted_address || "property #" + c.property_id}`, { dueDate: today });
}

// (c) — stuck leads: open, not fresh, untouched for STUCK_DAYS
const cutoff = new Date(Date.now() - STUCK_DAYS * 86400000).toISOString();
let stuck = [];
try {
  stuck = store.db.prepare(
    `SELECT id, address, seller_name, stage, updated_at FROM leads
     WHERE active=1 AND stage NOT IN ('Closed','Dead') AND updated_at < ?
     ORDER BY updated_at ASC LIMIT 25`).all(cutoff);
} catch { /* fresh db */ }
for (const l of stuck) {
  // No day-count in the title — a changing title would defeat the exact-title
  // dedupe and re-file the same stuck lead every day.
  file(`Unstick: ${l.address || l.seller_name || "lead #" + l.id} — stuck in ${l.stage}`, { leadId: l.id, dueDate: today });
}

console.log(`momentum: ${due.leads.length} lead follow-ups, ${due.calls.length} call-backs, ${stuck.length} stuck → ${created} tasks filed, ${skipped} already queued`);
store.close();

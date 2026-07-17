#!/usr/bin/env node
// ============================================================================
// Agent — Comps Analyst: price unpriced leads with the FREE Detroit comps engine.
// ============================================================================
// Finds active leads missing ARV/MAO and asks the running CRM server to
// underwrite each one via POST /api/leads/:id/underwrite (Detroit parcel file
// + recorded-sales comps — all free open data; the server writes arv /
// repair_estimate / mao / opportunity_score onto the lead). After each call we
// re-read the lead: MAO > 0 → "Send offer" task; no ARV derived → "Needs
// manual comps" task. One lead failing never stops the loop. Run once:
//   node focus/agents/comps.mjs        (COMPS_MAX=10, CRM_URL=http://localhost:4000)

import { existsSync } from "node:fs";
import { openFocusDb, DB_PATH, todayStart } from "../focus-data.mjs";

if (!existsSync(DB_PATH)) { console.error(`crm.db not found at ${DB_PATH}`); process.exit(1); }
const CRM_URL = process.env.CRM_URL || "http://localhost:4000";
const MAX = Math.max(1, +(process.env.COMPS_MAX || 10) || 10);
const store = openFocusDb();
const db = store.db;
const money = (v) => "$" + Math.round(v).toLocaleString("en-US");

// 1 · Candidates: active, open-stage, missing ARV or MAO — newest first.
let candidates = [];
try {
  candidates = db.prepare(
    `SELECT id, address FROM leads
     WHERE active=1 AND stage NOT IN ('Dead','Closed','Assigned')
       AND (arv IS NULL OR mao IS NULL)
     ORDER BY updated_at DESC LIMIT ?`).all(MAX);
} catch { /* fresh db */ }

// 2 · Server reachable? If not, don't hammer N timeouts — record and exit clean.
let serverUp = true;
try {
  await fetch(`${CRM_URL}/api/health`, { signal: AbortSignal.timeout(2000) });
} catch { serverUp = false; }

let priced = 0, offerReady = 0, manual = 0, failed = 0;

if (serverUp) {
  for (const l of candidates) {
    const label = l.address || "lead #" + l.id;
    try {
      const res = await fetch(`${CRM_URL}/api/leads/${l.id}/underwrite`, {
        method: "POST",
        signal: AbortSignal.timeout(5000),
      });
      let body = null;
      try { body = await res.json(); } catch { /* non-JSON reply */ }
      const responseFailed = !res.ok || body?.ok === false || body?.error;
      // 3 · Re-read the lead — the server writes results directly onto it.
      const lead = db.prepare("SELECT id, address, arv, mao FROM leads WHERE id=?").get(l.id) || l;
      if (lead.mao && lead.mao > 0) {
        priced++; offerReady++;
        store.addTaskOnce(`Send offer on ${lead.address || label} — MAO ${money(lead.mao)}`, { leadId: l.id, dueDate: todayStart() });
      } else if (responseFailed || lead.arv == null || lead.arv <= 0) {
        manual++;
        store.addTaskOnce(`Needs manual comps: ${lead.address || label}`, { leadId: l.id, dueDate: todayStart() });
      } else {
        priced++; // ARV derived, but no positive MAO — underwriting agent picks it up
      }
    } catch (e) {
      failed++;
      console.error(`  comps: ${label} — ${e?.message || e}`);
    }
  }
}

const digest = serverUp
  ? `comps: ${priced} priced (${offerReady} offer-ready), ${manual} need manual comps, ${failed} failed`
  : `comps: server down — start the CRM (${candidates.length} leads waiting at ${CRM_URL})`;
console.log(digest);
store.recordAgentRun("comps", digest);
store.close();

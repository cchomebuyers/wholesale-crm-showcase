#!/usr/bin/env node
// ============================================================================
// Agent 1 — Acquisitions Autopilot: shortlist → pipeline, hands-free.
// ============================================================================
// The autonomous lead engine (autonomous_lead_engine.js, hourly via server.js)
// already fills lead_engine_candidates. This agent promotes top-scored
// shortlisted candidates into `leads` (stage 'New'), dedupes on address, and
// files a "Review new lead" approval task. It never contacts anyone and never
// spends money — compliance gating (outreach_allowed) is untouched.
//   node focus/agents/acquisitions.mjs      (MIN_SCORE=70 MAX_PROMOTE=10)

import { existsSync } from "node:fs";
import { openFocusDb, DB_PATH, todayStart } from "../focus-data.mjs";
// The house canonicalizer — MUST match server.js (server.js:17,330) or the
// never-duplicates index (idx_leads_canon) gets poisoned with a second format.
import { canonicalAddr } from "../../connectors/census.js";

if (!existsSync(DB_PATH)) { console.error(`crm.db not found at ${DB_PATH}`); process.exit(1); }
const MIN_SCORE = +(process.env.MIN_SCORE || 70);
const MAX_PROMOTE = +(process.env.MAX_PROMOTE || 10);
const store = openFocusDb();
const db = store.db;
const now = new Date().toISOString();

let candidates = [];
try {
  candidates = db.prepare(
    `SELECT id, thinga_id, address, score, data_json FROM lead_engine_candidates
     WHERE status='shortlisted' AND lead_id IS NULL AND score >= ?
     ORDER BY score DESC LIMIT ?`).all(MIN_SCORE, MAX_PROMOTE);
} catch { console.log("acquisitions: lead engine has not run yet (no candidates table)"); process.exit(0); }

let promoted = 0, duped = 0;
for (const c of candidates) {
  try {
    let d = {};
    try { d = JSON.parse(c.data_json || "{}"); } catch { /* keep going with address only */ }
    const address = c.address || d.address || d.formatted_address;
    if (!address) continue;
    // never-duplicates: match the canonical address against existing leads
    const dupe = db.prepare("SELECT id FROM leads WHERE addr_canon = ? OR address = ?").get(canonicalAddr(address), address);
    if (dupe) {
      db.prepare("UPDATE lead_engine_candidates SET status='duplicate', lead_id=? WHERE id=?").run(dupe.id, c.id);
      duped++;
      continue;
    }
    const info = db.prepare(
      `INSERT INTO leads (created_at, updated_at, stage, address, city, state, zip, asking_price, arv, source, notes, active, addr_canon)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,1,?)`).run(
      now, now, "New", address, d.city ?? null, d.state ?? null, d.zip ?? null,
      d.price ?? d.asking_price ?? null, d.arv ?? null, "lead-engine",
      `Promoted by acquisitions agent · score ${c.score} · thinga ${c.thinga_id || "n/a"}`, canonicalAddr(address));
    const leadId = Number(info.lastInsertRowid);
    db.prepare("UPDATE lead_engine_candidates SET status='promoted', lead_id=? WHERE id=?").run(leadId, c.id);
    try { db.prepare("INSERT INTO activities (lead_id, created_at, type, body) VALUES (?,?,?,?)").run(leadId, now, "note", `🤖 Acquisitions agent promoted from shortlist (score ${c.score})`); } catch { /* activities optional */ }
    store.addTaskOnce(`Review new lead: ${address}`, { leadId, dueDate: todayStart() });
    promoted++;
  } catch (e) {
    console.error(`acquisitions: skipped candidate ${c.id}: ${e.message}`);
  }
}

console.log(`acquisitions: ${candidates.length} candidates ≥${MIN_SCORE} → ${promoted} promoted, ${duped} duplicates linked`);
store.close();

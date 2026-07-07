#!/usr/bin/env node
// ============================================================================
// Agent 3 — Compliant Outreach Drafter: drafts ready, human presses send.
// ============================================================================
// For open leads that have a priced offer (mao/offer_amount) AND a contact
// method already on file, drafts a short seller script into the lead's
// activity feed and files an "Approve & send" task. It NEVER sends anything —
// CLAUDE.md rule 2: compliance gates every contact, and the human is the gate.
// Contact discovery for leads WITHOUT a phone/email stays with
// contact_router.js (free routes first, DNC/consent before outreach_allowed).
//   node focus/agents/outreach.mjs   (MAX_DRAFTS=10)

import { existsSync } from "node:fs";
import { openFocusDb, DB_PATH, todayStart } from "../focus-data.mjs";

if (!existsSync(DB_PATH)) { console.error(`crm.db not found at ${DB_PATH}`); process.exit(1); }
const MAX_DRAFTS = +(process.env.MAX_DRAFTS || 10);
const store = openFocusDb();
const db = store.db;
const now = new Date().toISOString();
const money = (v) => "$" + Math.round(v).toLocaleString("en-US");

let leads = [];
try {
  leads = db.prepare(
    `SELECT l.id, l.address, l.seller_name, l.seller_phone, l.seller_email, l.mao, l.offer_amount
     FROM leads l
     WHERE l.active=1 AND l.stage IN ('New','Contacted')
       AND COALESCE(l.offer_amount, l.mao) > 0
       AND (l.seller_phone IS NOT NULL OR l.seller_email IS NOT NULL)
       AND NOT EXISTS (SELECT 1 FROM activities a WHERE a.lead_id = l.id AND a.body LIKE '🤖 DRAFT outreach%')
     ORDER BY l.updated_at DESC LIMIT ?`).all(MAX_DRAFTS);
} catch { /* fresh db */ }

let drafted = 0;
for (const l of leads) {
  const offer = l.offer_amount || l.mao;
  const name = l.seller_name || "there";
  const channel = l.seller_phone ? `call/text ${l.seller_phone}` : `email ${l.seller_email}`;
  const draft =
    `🤖 DRAFT outreach (${channel}) — review, personalize, confirm DNC/consent, then send:\n` +
    `"Hi ${name}, this is Sonny — I buy houses in your area for cash, as-is, no fees, ` +
    `and I can close on your timeline. For ${l.address} I can offer around ${money(offer)}. ` +
    `If that's in the ballpark, I can get you a written offer today. Is now a bad time?"`;
  try {
    db.prepare("INSERT INTO activities (lead_id, created_at, type, body) VALUES (?,?,?,?)").run(l.id, now, "note", draft);
    store.addTaskOnce(`Approve & send outreach to ${name} — ${l.address || "lead #" + l.id}`, { leadId: l.id, dueDate: todayStart() });
    drafted++;
  } catch (e) { console.error(`outreach: skipped lead ${l.id}: ${e.message}`); }
}

const digest = `${drafted} drafts written to activity feeds (0 sent — approval tasks filed)`;
console.log(`outreach: ${digest}`);
store.recordAgentRun("outreach", digest);
store.close();

#!/usr/bin/env node
// ============================================================================
// Agent 6 — Sonny Emailer: offer emails in Sonny's voice, queued for send.
// ============================================================================
// For offer-ready leads (email on file + a priced offer, none sent yet) it
// merges the right template — realtor vs homeowner, classified per lead —
// and, when the Anthropic key is connected, rewrites the body in Sonny's
// voice (sonny-voice.md, same rules as the inbox reply drafter). Drafts land
// in the `email_queue` table (status 'draft') + an approval task; you review
// and fire them from the Outreach tab's Email Agent panel. The human stays
// the send gate (CLAUDE.md rule 2) unless EMAILER_AUTO_SEND=1, which sends
// each draft through the running CRM (http://127.0.0.1:4000) immediately.
//
//   node focus/agents/emailer.mjs
//   EMAILER_AUDIENCE=homeowner EMAILER_MAX=5 node focus/agents/emailer.mjs
//
// Knobs (env): EMAILER_AUDIENCE both|realtor|homeowner (both) ·
// EMAILER_MAX (8) · EMAILER_TEMPLATE_ID (auto-pick) · EMAILER_AI 1|0 (1) ·
// EMAILER_AUTO_SEND 1|0 (0) · EMAILER_EARNEST (1000) ·
// EMAILER_INSPECT_DAYS (10) · EMAILER_CLOSE_DAYS (30)

import { existsSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { openFocusDb, DB_PATH, todayStart } from "../focus-data.mjs";
import { classifyRecipient, pickTemplate, mergeEmailFields, emailReady } from "../../email_agent.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");

if (!existsSync(DB_PATH)) { console.error(`crm.db not found at ${DB_PATH}`); process.exit(1); }

const AUDIENCE = (process.env.EMAILER_AUDIENCE || "both").toLowerCase();
const MAX = +(process.env.EMAILER_MAX || 8);
const TEMPLATE_ID = +(process.env.EMAILER_TEMPLATE_ID || 0) || null;
const USE_AI = process.env.EMAILER_AI !== "0";
const AUTO_SEND = process.env.EMAILER_AUTO_SEND === "1";
const CRM_URL = process.env.CRM_URL || "http://127.0.0.1:4000";

const store = openFocusDb();
const db = store.db;
const nowIso = () => new Date().toISOString();
const getSetting = (k) => { try { return db.prepare("SELECT value FROM settings WHERE key=?").get(k)?.value ?? null; } catch { return null; } };

db.exec(`CREATE TABLE IF NOT EXISTS email_queue (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT NOT NULL,
  lead_id INTEGER NOT NULL,
  recipient_type TEXT,
  to_addr TEXT NOT NULL,
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  template_id INTEGER,
  offer_amount REAL,
  ai INTEGER DEFAULT 0,
  status TEXT DEFAULT 'draft',
  sent_at TEXT,
  agent TEXT DEFAULT 'emailer'
)`);

// --- Sonny's voice (same file the inbox reply drafter reads) ---------------
let voice = "";
try { voice = readFileSync(join(ROOT, "sonny-voice.md"), "utf8"); } catch { /* template-only mode */ }

const anthropicKey = getSetting("anthropic_api_key") || process.env.ANTHROPIC_API_KEY || null;
let client = null;
if (USE_AI && anthropicKey && voice) {
  try {
    const { default: Anthropic } = await import("@anthropic-ai/sdk");
    client = new Anthropic({ apiKey: anthropicKey });
  } catch (e) { console.error(`emailer: AI unavailable (${e.message}) — sending clean template merges`); }
}

// Rewrite a merged template in Sonny's voice. Numbers/terms are load-bearing
// (this is an offer) so the prompt pins them; on any failure the merged
// template — itself derived from Sonny's emails — goes out unchanged.
async function sonnyize(body, lead, recipientType, offer) {
  if (!client) return { body, ai: 0 };
  try {
    const who = recipientType === "realtor" ? "the listing agent for" : "the homeowner of";
    const r = await client.messages.create(
      {
        model: "claude-opus-4-8",
        max_tokens: 700,
        thinking: { type: "adaptive" },
        system: `You draft outreach emails for Sonny, a Detroit real-estate wholesaler. Follow these style rules exactly:\n\n${voice}\n\nRewrite the email you are given so it sounds like Sonny. CRITICAL: keep every dollar amount, day count, deadline, term and bullet EXACTLY as written — this is a purchase offer. Keep any {{merge_fields}} untouched. Return ONLY the email body text — no subject, no commentary.`,
        messages: [{ role: "user", content: `This email goes to ${who} ${lead.address || "a property"} with a cash offer of $${Math.round(offer).toLocaleString()}. Rewrite in Sonny's voice:\n\n${body}` }],
      },
      { timeout: 30_000, maxRetries: 1 },
    );
    const out = r.content.filter((b) => b.type === "text").map((b) => b.text).join("").trim();
    return out ? { body: out, ai: 1 } : { body, ai: 0 };
  } catch (e) {
    console.error(`emailer: AI polish failed for lead ${lead.id} (${e.message}) — using template`);
    return { body, ai: 0 };
  }
}

// --- Candidates -------------------------------------------------------------
let leads = [];
try {
  leads = db.prepare(
    `SELECT l.* FROM leads l
     WHERE l.active=1 AND l.stage NOT IN ('Dead','Closed','Assigned')
       AND l.seller_email IS NOT NULL AND TRIM(l.seller_email) != ''
       AND l.offer_sent_at IS NULL
       AND COALESCE(l.offer_amount, l.mao) > 0
       AND NOT EXISTS (SELECT 1 FROM email_queue q WHERE q.lead_id = l.id AND q.status='draft')
     ORDER BY COALESCE(l.opportunity_score,-1) DESC, l.updated_at DESC`).all();
} catch (e) { console.error(`emailer: query failed: ${e.message}`); }

leads = leads.filter(emailReady);
if (AUDIENCE !== "both") leads = leads.filter((l) => classifyRecipient(l) === AUDIENCE);
leads = leads.slice(0, MAX);

const templates = db.prepare("SELECT * FROM templates").all();
const cfgBase = {
  myName: getSetting("my_name") || getSetting("from_name") || "Sonny",
  myPhone: getSetting("my_phone") || "",
  earnest: +(process.env.EMAILER_EARNEST || 1000),
  inspectionDays: +(process.env.EMAILER_INSPECT_DAYS || 10),
  closeDays: +(process.env.EMAILER_CLOSE_DAYS || 30),
};

let queued = 0, sent = 0, aiCount = 0;
for (const l of leads) {
  const type = classifyRecipient(l);
  const tmpl = pickTemplate(templates, type, TEMPLATE_ID);
  if (!tmpl) { console.error("emailer: no offer template found — seed one in Outreach → Templates"); break; }
  const offer = Number(l.offer_amount || l.mao);
  const cfg = { ...cfgBase, offer };
  const subject = mergeEmailFields(tmpl.subject, l, cfg);
  const merged = mergeEmailFields(tmpl.body, l, cfg);
  const { body, ai } = await sonnyize(merged, l, type, offer);
  aiCount += ai;
  try {
    const info = db.prepare(
      `INSERT INTO email_queue (created_at, lead_id, recipient_type, to_addr, subject, body, template_id, offer_amount, ai, status)
       VALUES (?,?,?,?,?,?,?,?,?,'draft')`)
      .run(nowIso(), l.id, type, l.seller_email.trim(), subject, body, tmpl.id, offer, ai);
    queued++;
    const label = type === "realtor" ? "realtor" : "homeowner";
    if (AUTO_SEND) {
      try {
        const res = await fetch(`${CRM_URL}/api/email-queue/${info.lastInsertRowid}/send`, { method: "POST" });
        if (res.ok) { sent++; continue; } // sent — no approval task needed
        console.error(`emailer: auto-send failed for lead ${l.id}: ${(await res.json().catch(() => ({}))).error || res.status}`);
      } catch (e) { console.error(`emailer: CRM unreachable for auto-send (${e.message}) — left as draft`); }
    }
    store.addTaskOnce(`Approve offer email (${label}): ${l.address || "lead #" + l.id} — $${Math.round(offer).toLocaleString()}`,
      { leadId: l.id, dueDate: todayStart() });
  } catch (e) { console.error(`emailer: skipped lead ${l.id}: ${e.message}`); }
}

const digest = AUTO_SEND
  ? `${sent} sent, ${queued - sent} queued as drafts (${aiCount} in Sonny's voice via AI)`
  : `${queued} offer emails drafted to queue (${aiCount} in Sonny's voice via AI, 0 sent — approve in Outreach)`;
console.log(`emailer: ${digest}`);
store.recordAgentRun("emailer", digest);
store.close();

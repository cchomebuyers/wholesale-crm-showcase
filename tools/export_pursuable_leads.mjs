// tools/export_pursuable_leads.mjs — export the skip-trace-ready leads to pursuableLeads/.
// "Pursuable" = the spend gate APPROVES it: owner known, distress present, ARV or buyer
// demand — everything free is done and the only missing piece is the seller's phone.
// Writes an upload-ready CSV (for a skip-trace provider), full JSONL, and a README.

import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { skiptraceDecision, summarizeSkiptrace } from "../skiptrace_gate.js";

const dir = dirname(fileURLToPath(import.meta.url));
const repo = join(dir, "..");
const DB = process.env.CRM_DB || join(repo, "crm.db");
const OUT_DIR = join(repo, "pursuableLeads");
mkdirSync(OUT_DIR, { recursive: true });

const db = new DatabaseSync(DB);
const rows = db.prepare(`
  SELECT q.tier, q.priority_score, q.signals_json,
         p.id AS property_id, p.address, p.formatted_address, p.city, p.state, p.zip, p.county,
         p.source, p.owner_name, p.owner_mailing, p.arv, p.mao
  FROM pro_queue q JOIN properties p ON p.id = q.property_id
  WHERE q.tier IN ('call_now','pay_to_unlock') AND p.owner_name IS NOT NULL AND p.owner_name <> ''
  ORDER BY q.priority_score DESC
`).all();

const parse = (j) => { try { return JSON.parse(j || "{}"); } catch { return {}; } };
const pursuable = [];
const decisions = [];
for (const r of rows) {
  const sig = parse(r.signals_json);
  const d = skiptraceDecision(
    { owner_name: r.owner_name, owner_mailing: r.owner_mailing, address: r.address, formatted_address: r.formatted_address },
    { tier: r.tier, signals: sig },
  );
  decisions.push(d);
  if (!d.allowed) continue;
  pursuable.push({
    property_id: r.property_id,
    priority: r.priority_score,
    owner_name: r.owner_name,
    property_address: r.address || r.formatted_address || "",
    city: r.city && r.city !== "1" ? r.city : "",
    state: r.state || "",
    zip: r.zip || "",
    county: r.county || "",
    mailing_address: r.owner_mailing || "",
    arv: r.arv || null,
    mao: r.mao || null,
    absentee_owner: sig.absentee_owner === true,
    entity_owner: sig.entity_owner === true,
    buyer_demand: sig.buyer_demand === true,
    distress: sig.distress || r.source,
    source: r.source,
    skiptrace_max_cost: d.max_cost,
    compliance: "outreach_allowed:false until DNC/consent verified",
  });
}

// CSV (upload-ready for a skip-trace provider)
const csvCols = ["property_id","priority","owner_name","property_address","city","state","zip","county","mailing_address","arv","mao","absentee_owner","entity_owner","buyer_demand","distress"];
const esc = (v) => { const s = v === null || v === undefined ? "" : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
const csv = [csvCols.join(",")].concat(pursuable.map((p) => csvCols.map((c) => esc(p[c])).join(","))).join("\n") + "\n";
writeFileSync(join(OUT_DIR, "skiptrace_targets.csv"), csv);

// JSONL (full records)
writeFileSync(join(OUT_DIR, "skiptrace_targets.jsonl"), pursuable.map((p) => JSON.stringify(p)).join("\n") + (pursuable.length ? "\n" : ""));

const spend = summarizeSkiptrace(decisions);
const readme = `# Pursuable Leads — skip-trace ready

Generated: ${new Date().toISOString()}

These are the leads where everything FREE is already done — owner of record joined,
distress signal present, and ARV or active cash-buyer demand. The ONLY missing piece is
the seller's phone, which needs a paid skip-trace (the spend gate approved each one).

## Counts
- pursuable (skip-trace approved): **${pursuable.length}**
- est. max skip-trace spend: **$${spend.est_max_spend}** (@ $${decisions[0]?.max_cost ?? 0.15}/lookup)
- spend-eligible records evaluated: ${spend.total} (denied ${spend.denied}: still need free owner-join/ARV/demand)

## Files
- \`skiptrace_targets.csv\` — upload-ready: owner_name + property_address + mailing_address (+ ARV/MAO/signals)
- \`skiptrace_targets.jsonl\` — full records

## How to use
1. Fund a skip-trace provider (system is wired for BatchData; key → Settings → Acquisitions, or BATCHDATA_API_KEY).
2. Skip-trace these rows (owner_name + property/mailing address) to get phone/email.
3. **Compliance:** a found number stays outreach_allowed:false until DNC/consent is checked.
   Skip-trace unlocks the number; compliance unlocks the call (cold call = TCPA/DNC; direct mail has no such gate).

## Top targets
${pursuable.slice(0, 15).map((p, i) => `${i + 1}. ${p.owner_name} — ${p.property_address}${p.state ? ", " + p.state : ""} | ARV $${(p.arv || 0).toLocaleString()} → MAO $${(p.mao || 0).toLocaleString()}${p.absentee_owner ? " | absentee" : ""}${p.entity_owner ? " | entity" : ""}`).join("\n")}
`;
writeFileSync(join(OUT_DIR, "README.md"), readme);

console.log(`PURSUABLE LEADS: wrote ${pursuable.length} skip-trace-ready leads to pursuableLeads/`);
console.log(`  est max spend $${spend.est_max_spend} | files: skiptrace_targets.csv, .jsonl, README.md`);

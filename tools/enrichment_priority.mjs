// tools/enrichment_priority.mjs -- enrichment ROI: of the HIGH-GRADE properties (property_score.js),
// how many are blocked from call_now by each single missing field? Answers "where does the next
// dollar/effort convert the most graded leads into callable deals?" READ-ONLY (concurrent-safe;
// never writes crm.db), so it can run while other agents' ticks write the DB.
//
// Run: node tools/enrichment_priority.mjs [--min-grade=55] [--db=crm.db]

import { writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { classifyProQueue } from "../pro_wholesaler_queue.js";
import { buyerMarketDemand } from "../buyer_discovery.js";

const dir = dirname(fileURLToPath(import.meta.url));
const repo = join(dir, "..");
const arg = (k, d) => { const h = process.argv.find((a) => a.startsWith(`--${k}=`)); return h ? h.split("=").slice(1).join("=") : d; };

const DB = join(repo, arg("db", "crm.db"));
const minGrade = Number(arg("min-grade", "55")) || 55;
if (!existsSync(DB)) { console.error(`no db at ${DB}`); process.exit(1); }

const db = new DatabaseSync(DB, { readOnly: true });
const cols = db.prepare("PRAGMA table_info(properties)").all().map((c) => c.name);
if (!cols.includes("property_grade")) { console.error("run tools/apply_property_score.mjs first"); process.exit(1); }

const rows = db.prepare(`SELECT * FROM properties WHERE property_grade >= ${minGrade}`).all();

// Load buyers exactly like tools/build_pro_queue.mjs so buyer_demand is computed accurately
// (otherwise every row falsely looks like it's missing demand).
const loadBuyers = (tbl) => { try { return db.prepare(`SELECT name, areas, property_types, max_price, source_id FROM ${tbl}`).all(); } catch { return []; } };
const allBuyers = [...loadBuyers("buyer_discovery_candidates"), ...loadBuyers("buyers")];

// For each high-grade property, classify it and tally which fields it is missing. A field that
// blocks many high-grade properties is the highest-ROI enrichment target.
const missingTally = {};
const blockedByOnly = {}; // properties whose ONLY missing field is this one
let callNow = 0;
for (const r of rows) {
  const demand = buyerMarketDemand(r, allBuyers);
  if (demand.has_demand) r.buyer_matches = [demand.top_buyer];
  const d = classifyProQueue(r);
  if (d.tier === "call_now") { callNow++; continue; }
  const miss = Array.isArray(d.missing) ? d.missing : [];
  for (const m of miss) missingTally[m] = (missingTally[m] || 0) + 1;
  if (miss.length === 1) blockedByOnly[miss[0]] = (blockedByOnly[miss[0]] || 0) + 1;
}

const rank = (obj) => Object.entries(obj).sort((a, b) => b[1] - a[1]);
const L = [];
L.push("# Enrichment ROI — where the next effort unlocks the most graded leads (CLAUDE-B)");
L.push("");
L.push(`Generated ${new Date().toISOString()} from ${DB}`);
L.push(`High-grade properties (property_grade >= ${minGrade}): ${rows.length}. Already call_now: ${callNow}.`);
L.push("");
L.push("## Missing field across all high-grade non-callable properties");
L.push("| field | blocks N high-grade |");
L.push("|---|---|");
for (const [f, n] of rank(missingTally)) L.push(`| ${f} | ${n} |`);
L.push("");
L.push("## Properties blocked by ONLY one field (fix it -> immediately closer to callable)");
L.push("| sole missing field | count |");
L.push("|---|---|");
for (const [f, n] of rank(blockedByOnly)) L.push(`| ${f} | ${n} |`);
L.push("");

const out = join(repo, "data", "enrichment_priority.md");
writeFileSync(out, L.join("\n") + "\n");
console.log(`wrote ${out}`);
console.log(JSON.stringify({ high_grade: rows.length, already_call_now: callNow, missing_tally: missingTally, blocked_by_only: blockedByOnly }, null, 2));

// tools/export_high_grade_targets.mjs -- the money list. Exports HIGH-GRADE properties
// (property_score.js) whose ONLY remaining blocker to callable is the seller phone -- i.e.
// owner + ARV + buyer demand are already present, so a single skip-trace converts each one.
// Ranked by property_grade with a human WHY (grade_explain.js). READ-ONLY (concurrent-safe).
// Distinct from export_pursuable_leads.mjs (which exports the spend-gate set): this is the
// grade-ranked, phone-only-blocked subset -- the sharpest skip-trace target list.
//
// Run: node tools/export_high_grade_targets.mjs [--min-grade=55] [--db=crm.db]

import { writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { classifyProQueue } from "../pro_wholesaler_queue.js";
import { buyerMarketDemand } from "../buyer_discovery.js";
import { explainGrade, gradeBadge } from "../grade_explain.js";

const dir = dirname(fileURLToPath(import.meta.url));
const repo = join(dir, "..");
const arg = (k, d) => { const h = process.argv.find((a) => a.startsWith(`--${k}=`)); return h ? h.split("=").slice(1).join("=") : d; };

const DB = join(repo, arg("db", "crm.db"));
const minGrade = Number(arg("min-grade", "55")) || 55;
if (!existsSync(DB)) { console.error(`no db at ${DB}`); process.exit(1); }

const db = new DatabaseSync(DB, { readOnly: true });
const cols = db.prepare("PRAGMA table_info(properties)").all().map((c) => c.name);
if (!cols.includes("property_grade")) { console.error("run tools/apply_property_score.mjs first"); process.exit(1); }

const loadBuyers = (tbl) => { try { return db.prepare(`SELECT name, areas, property_types, max_price, source_id FROM ${tbl}`).all(); } catch { return []; } };
const allBuyers = [...loadBuyers("buyer_discovery_candidates"), ...loadBuyers("buyers")];

const rows = db.prepare(`SELECT * FROM properties WHERE property_grade >= ${minGrade} ORDER BY property_grade DESC, arv DESC`).all();

const targets = [];
for (const r of rows) {
  const demand = buyerMarketDemand(r, allBuyers);
  if (demand.has_demand) r.buyer_matches = [demand.top_buyer];
  const d = classifyProQueue(r);
  const miss = Array.isArray(d.missing) ? d.missing : [];
  // phone-only-blocked: the single thing standing between this graded lead and callable.
  if (miss.length === 1 && miss[0] === "seller_phone") {
    targets.push({
      property_id: r.id,
      property_grade: r.property_grade,
      badge: gradeBadge(r.property_grade),
      priority_score: d.priority_score,
      address: r.address || r.formatted_address || "",
      city: r.city && r.city !== "1" ? r.city : "",
      state: r.state || "",
      owner_name: r.owner_name || "",
      owner_mailing: r.owner_mailing || "",
      arv: r.arv || "",
      mao: r.mao || "",
      buyer: demand.top_buyer ? demand.top_buyer.name : "",
      why: explainGrade({ grade: r.property_grade, factors: safeJSON(r.property_grade_factors), reasons: [] }),
      next_action: "skip-trace owner for seller phone (only remaining blocker)",
      outreach_allowed: false, // stays false until DNC/consent verified — compliance, not data
    });
  }
}

function safeJSON(s) { try { return JSON.parse(s || "[]"); } catch { return []; } }

const outDir = join(repo, "pursuableLeads");
mkdirSync(outDir, { recursive: true });

// JSONL (full) + CSV (upload-ready for a skip-trace provider).
writeFileSync(join(outDir, "high_grade_skiptrace_targets.jsonl"), targets.map((t) => JSON.stringify(t)).join("\n") + (targets.length ? "\n" : ""));
const csvCols = ["property_id", "property_grade", "badge", "priority_score", "address", "city", "state", "owner_name", "owner_mailing", "arv", "mao", "buyer", "next_action"];
const esc = (v) => { const s = String(v ?? ""); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
const csv = [csvCols.join(",")].concat(targets.map((t) => csvCols.map((c) => esc(t[c])).join(","))).join("\n") + "\n";
writeFileSync(join(outDir, "high_grade_skiptrace_targets.csv"), csv);

const est = (targets.length * 0.15).toFixed(2);
writeFileSync(join(outDir, "HIGH_GRADE_README.md"),
`# High-grade skip-trace targets (CLAUDE-B)\n\nGenerated ${new Date().toISOString()}\n\n` +
`These ${targets.length} properties have property_grade >= ${minGrade} and their ONLY missing\n` +
`field is the seller phone — owner, ARV, and buyer demand are already present. A single\n` +
`skip-trace per row (~$0.15) converts each toward callable. Est. spend: ~$${est}.\n\n` +
`outreach_allowed stays false until DNC/TCPA/consent is verified — skip-trace unlocks the\n` +
`number; compliance unlocks the call. Files: high_grade_skiptrace_targets.csv / .jsonl\n`);

console.log(JSON.stringify({ min_grade: minGrade, high_grade_rows: rows.length, phone_only_targets: targets.length, est_skiptrace_spend: `$${est}`, top3: targets.slice(0, 3).map((t) => ({ grade: t.property_grade, owner: t.owner_name, addr: t.address, arv: t.arv })) }, null, 2));

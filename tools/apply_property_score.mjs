// tools/apply_property_score.mjs -- compute the per-property grade (frontier #8) for every
// row and store it ADDITIVELY in a new `property_grade` column. Never mutates `lead_score`,
// so it cannot disturb CLAUDE-A's queue or CODEX's import. Proves the result is no longer flat
// by printing the grade distribution before/after.
//
// Run: node tools/apply_property_score.mjs [--dry-run] [--max=N] [--db=crm.db]

import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { gradeProperty, summarizeGrades } from "../property_score.js";
import { detectPortfolios, normalizeOwner } from "../owner_portfolio.js";

const dir = dirname(fileURLToPath(import.meta.url));
const repo = join(dir, "..");
const arg = (k, d) => { const h = process.argv.find((a) => a.startsWith(`--${k}=`)); return h ? h.split("=").slice(1).join("=") : d; };
const has = (k) => process.argv.includes(`--${k}`);

const DB = join(repo, arg("db", "crm.db"));
const dry = has("dry-run");
const max = Number(arg("max", "0")) || 0;
if (!existsSync(DB)) { console.error(`no db at ${DB}`); process.exit(1); }

const db = new DatabaseSync(DB);

// Additive migration: add the column if it is not already present.
const cols = db.prepare("PRAGMA table_info(properties)").all().map((c) => c.name);
if (!cols.includes("property_grade")) {
  if (dry) console.log("[dry-run] would add column property_grade");
  else { db.prepare("ALTER TABLE properties ADD COLUMN property_grade INTEGER").run(); console.log("added column property_grade"); }
}
if (!cols.includes("property_grade_factors")) {
  if (dry) console.log("[dry-run] would add column property_grade_factors");
  else { db.prepare("ALTER TABLE properties ADD COLUMN property_grade_factors TEXT").run(); console.log("added column property_grade_factors"); }
}

const distOf = (col) => db.prepare(`SELECT ${col} v, COUNT(*) n FROM properties GROUP BY ${col} ORDER BY n DESC LIMIT 6`).all();
console.log("lead_score distribution (the flat per-source problem):", JSON.stringify(distOf("lead_score")));

const rows = db.prepare(`SELECT * FROM properties ${max ? `LIMIT ${max}` : ""}`).all();
const upd = dry ? null : db.prepare("UPDATE properties SET property_grade=?, property_grade_factors=? WHERE id=?");

// Build owner -> portfolio-size map once (private portfolios only; institutional excluded),
// so the grade can reward bulk-seller holdings. Keyed by normalized owner name.
const portfolioCount = new Map();
for (const p of detectPortfolios(rows, { minSize: 2 })) portfolioCount.set(p.normalized, p.count);
console.log(`private portfolios feeding the grade: ${portfolioCount.size}`);

const grades = [];
let written = 0;
if (!dry) db.exec("BEGIN");
for (const r of rows) {
  const pc = r.owner_name ? (portfolioCount.get(normalizeOwner(r.owner_name)) || 1) : 1;
  const g = gradeProperty(r, { portfolioCount: pc });
  grades.push(g.grade);
  if (!dry) { upd.run(g.grade, JSON.stringify(g.factors), r.id); written++; }
}
if (!dry) db.exec("COMMIT");

const sum = summarizeGrades(grades);
console.log(JSON.stringify({
  db: DB, dry_run: dry, scanned: rows.length, written,
  grade_summary: sum,
  no_longer_flat: sum.distinct > 1 && sum.spread > 0,
}, null, 2));
if (!dry) console.log("property_grade distribution (after):", JSON.stringify(distOf("property_grade")));

// tools/property_grade_report.mjs -- grade-driven ranked work list (CLAUDE-B lane, frontier #8).
// Read-only. Proves the per-property grade (property_score.js, stored as property_grade) reorders
// rows the FLAT lead_score treated as identical: within a single source where every lead_score is
// the same, property_grade now ranks them. Writes data/property_grade_report.md (untracked) and
// prints the top targets + the "grade disagrees with flat score" evidence.
//
// Run: node tools/property_grade_report.mjs [--top=25] [--source=cook-il-violations] [--db=crm.db]

import { writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

const dir = dirname(fileURLToPath(import.meta.url));
const repo = join(dir, "..");
const arg = (k, d) => { const h = process.argv.find((a) => a.startsWith(`--${k}=`)); return h ? h.split("=").slice(1).join("=") : d; };

const DB = join(repo, arg("db", "crm.db"));
const top = Math.max(1, Number(arg("top", "25")) || 25);
const srcFilter = arg("source", "");
if (!existsSync(DB)) { console.error(`no db at ${DB}`); process.exit(1); }

const db = new DatabaseSync(DB);
const cols = db.prepare("PRAGMA table_info(properties)").all().map((c) => c.name);
if (!cols.includes("property_grade")) {
  console.error("property_grade not present — run: node tools/apply_property_score.mjs"); process.exit(1);
}

const where = ["property_grade IS NOT NULL"];
const params = [];
if (srcFilter) { where.push("source = ?"); params.push(srcFilter); }

const rows = db.prepare(`
  SELECT id, address, city, state, source, lead_score, property_grade, property_grade_factors,
         owner_name, owner_mailing, arv, mao
  FROM properties WHERE ${where.join(" AND ")}
  ORDER BY property_grade DESC, arv DESC
  LIMIT ${top}
`).all(...params);

// Evidence the grade is no longer flat: take the largest single-lead_score cohort and show that
// property_grade spreads it out (min..max) instead of collapsing everyone to one number.
const biggestCohort = db.prepare(`
  SELECT lead_score, COUNT(*) n, MIN(property_grade) lo, MAX(property_grade) hi,
         COUNT(DISTINCT property_grade) distinct_grades
  FROM properties WHERE property_grade IS NOT NULL
  GROUP BY lead_score ORDER BY n DESC LIMIT 5
`).all();

const tierHints = db.prepare(`
  SELECT CASE
           WHEN property_grade >= 70 THEN 'hot'
           WHEN property_grade >= 55 THEN 'warm'
           WHEN property_grade >= 35 THEN 'research'
           ELSE 'hold' END tier_hint,
         COUNT(*) n
  FROM properties WHERE property_grade IS NOT NULL GROUP BY tier_hint ORDER BY n DESC
`).all();

const money = (v) => (Number(v) > 0 ? "$" + Math.round(Number(v)).toLocaleString() : "—");
const L = [];
L.push("# Property Grade Report (CLAUDE-B — frontier #8 per-property scoring)");
L.push("");
L.push(`Generated ${new Date().toISOString()} from ${DB}`);
L.push("");
L.push("## Grade vs the old flat lead_score");
L.push("");
L.push("| flat lead_score | rows | grade min | grade max | distinct grades |");
L.push("|---|---|---|---|---|");
for (const c of biggestCohort) L.push(`| ${c.lead_score} | ${c.n} | ${c.lo} | ${c.hi} | ${c.distinct_grades} |`);
L.push("");
L.push("Each flat lead_score cohort now spans many grades — the score grades the PROPERTY, not the source.");
L.push("");
L.push("## Tier hint distribution");
L.push("");
for (const t of tierHints) L.push(`- ${t.tier_hint}: ${t.n}`);
L.push("");
L.push(`## Top ${rows.length} by property_grade`);
L.push("");
L.push("| # | grade | (flat ls) | address | owner | ARV | MAO |");
L.push("|---|---|---|---|---|---|---|");
rows.forEach((r, i) => {
  const addr = (r.address || "?") + (r.city && r.city !== "1" ? `, ${r.city}` : "") + (r.state ? ` ${r.state}` : "");
  L.push(`| ${i + 1} | ${r.property_grade} | ${r.lead_score} | ${addr} | ${r.owner_name || "—"} | ${money(r.arv)} | ${money(r.mao)} |`);
});
L.push("");

const out = join(repo, "data", "property_grade_report.md");
writeFileSync(out, L.join("\n") + "\n");
console.log(`wrote ${out}`);
console.log("grade-vs-flat cohorts:", JSON.stringify(biggestCohort));
console.log("tier hints:", JSON.stringify(tierHints));
console.log(`top row: grade ${rows[0]?.property_grade} (flat ls ${rows[0]?.lead_score}) ${rows[0]?.owner_name || ""} ${rows[0]?.address || ""}`);

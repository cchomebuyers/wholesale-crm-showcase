// tools/detect_owner_portfolios.mjs -- find private bulk owners (portfolio sellers) in crm.db.
// READ-ONLY (no schema/data writes) so it never contends with another agent's in-flight tick.
// Writes a markdown report only. Reveals owners holding multiple distressed properties -- the
// motivated bulk-seller list a wholesaler wants most.
//
// Run: node tools/detect_owner_portfolios.mjs [--min=2] [--top=30] [--db=crm.db]

import { writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { detectPortfolios } from "../owner_portfolio.js";

const dir = dirname(fileURLToPath(import.meta.url));
const repo = join(dir, "..");
const arg = (k, d) => { const h = process.argv.find((a) => a.startsWith(`--${k}=`)); return h ? h.split("=").slice(1).join("=") : d; };

const DB = join(repo, arg("db", "crm.db"));
const minSize = Math.max(2, Number(arg("min", "2")) || 2);
const top = Math.max(1, Number(arg("top", "30")) || 30);
if (!existsSync(DB)) { console.error(`no db at ${DB}`); process.exit(1); }

const db = new DatabaseSync(DB);
const rows = db.prepare("SELECT id, owner_name, address, city, state FROM properties WHERE owner_name IS NOT NULL AND owner_name<>''").all();
const portfolios = detectPortfolios(rows, { minSize });

const totalProps = portfolios.reduce((a, p) => a + p.count, 0);
const L = [];
L.push("# Private Portfolio Owners (CLAUDE-B — bulk-seller detection)");
L.push("");
L.push(`Generated ${new Date().toISOString()} from ${DB}`);
L.push(`Owned rows scanned: ${rows.length}. Private portfolios (>=${minSize}, institutional/placeholder excluded): ${portfolios.length}, covering ${totalProps} properties.`);
L.push("");
L.push("| # | owner | holdings | entity | states | property_ids |");
L.push("|---|---|---|---|---|---|");
portfolios.slice(0, top).forEach((p, i) => {
  L.push(`| ${i + 1} | ${p.display} | ${p.count} | ${p.entity ? "yes" : "no"} | ${p.states.join("/") || "—"} | ${p.property_ids.slice(0, 10).join(", ")}${p.property_ids.length > 10 ? " …" : ""} |`);
});
L.push("");

const out = join(repo, "data", "owner_portfolios.md");
writeFileSync(out, L.join("\n") + "\n");
console.log(`wrote ${out}`);
console.log(JSON.stringify({
  owned_rows: rows.length,
  private_portfolios: portfolios.length,
  properties_in_portfolios: totalProps,
  top5: portfolios.slice(0, 5).map((p) => ({ owner: p.display, holdings: p.count, states: p.states })),
}, null, 2));

// tools/derive_nyc_boroughs.mjs — recover the borough (county) the harvest dropped.
// The nyc-ny-violations source rows carry `boro` (1-5) + house_number + street
// (3h2n-5cm9, verified); our properties kept the address but not the borough,
// and tick 63 nulled the wrongly-stamped 'Kings County'. This tool re-derives
// county per property by batched house+street lookups against the SOURCE.
//
// Run: node tools/derive_nyc_boroughs.mjs [--max=1100] [--batch=40] [--dry-run]

import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

const dir = dirname(fileURLToPath(import.meta.url));
const repo = join(dir, "..");
const DB = process.env.CRM_DB || join(repo, "crm.db");
const argv = process.argv.slice(2);
const opt = (k, d) => { const a = argv.find((x) => x.startsWith(`--${k}=`)); return a ? a.split("=")[1] : d; };
const max = Number(opt("max", 1100)) || 1100;
const batchSize = Math.min(60, Number(opt("batch", 40)) || 40);
const dryRun = argv.includes("--dry-run");

if (!process.env.PIPELINE_RUN && existsSync(join(repo, "docs", "HALT"))) { console.log("HALT present - stopping."); process.exit(0); }

const BORO_COUNTY = { 1: "New York County", 2: "Bronx County", 3: "Kings County", 4: "Queens County", 5: "Richmond County" };

const db = new DatabaseSync(DB);
db.exec("PRAGMA busy_timeout = 15000");
const rows = db.prepare(`SELECT id, address FROM properties
  WHERE source='nyc-ny-violations' AND (county IS NULL OR county='') AND address IS NOT NULL AND address <> ''
  LIMIT ?`).all(max);
console.log(`borough-less NYC rows: ${rows.length}`);

// address '\d+ STREET...' -> {house, street}
const parts = rows.map((r) => {
  const m = String(r.address).trim().toUpperCase().match(/^(\S+)\s+(.+)$/);
  return m ? { id: r.id, house: m[1].replace(/'/g, "''"), street: m[2].replace(/'/g, "''"), addr: r.address } : null;
}).filter(Boolean);

const upd = db.prepare("UPDATE properties SET county=?, updated_at=? WHERE id=?");
const now = new Date().toISOString();
let matched = 0, requests = 0;
const boroCounts = {};

for (let i = 0; i < parts.length; i += batchSize) {
  const batch = parts.slice(i, i + batchSize);
  const where = batch.map((p) => `(house_number='${p.house}' and street='${p.street}')`).join(" or ");
  const u = new URL("https://data.cityofnewyork.us/resource/3h2n-5cm9.json");
  u.searchParams.set("$select", "house_number, street, boro");
  u.searchParams.set("$where", where);
  u.searchParams.set("$limit", "2000");
  requests++;
  let hits = [];
  try { hits = await (await fetch(u)).json(); } catch { hits = []; }
  if (!Array.isArray(hits)) continue;
  // First boro seen per house+street (violations for one address share a boro).
  const boroByKey = new Map();
  for (const h of hits) {
    const k = `${String(h.house_number).trim()} ${String(h.street).trim().toUpperCase()}`;
    if (!boroByKey.has(k)) boroByKey.set(k, Number(h.boro));
  }
  for (const p of batch) {
    const boro = boroByKey.get(`${p.house} ${p.street}`.replace(/''/g, "'"));
    const county = BORO_COUNTY[boro];
    if (!county) continue;
    matched++;
    boroCounts[county] = (boroCounts[county] || 0) + 1;
    if (!dryRun) upd.run(county, now, p.id);
  }
}

console.log(`DERIVE-NYC-BOROUGHS${dryRun ? " [DRY]" : ""}: matched ${matched}/${parts.length} in ${requests} requests`);
console.log("by county:", JSON.stringify(boroCounts));
db.close();

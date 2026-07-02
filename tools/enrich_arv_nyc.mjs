// tools/enrich_arv_nyc.mjs — ARV/MAO for NYC properties from DOF Rolling Sales.
// Mirrors enrich_arv_cook.mjs: (1) ONE aggregate builds a neighborhood average
// from recent residential sales (usep-8jbt, fields live-verified 2026-07-02);
// (2) per property (bounded --max), an exact house+street sales lookup yields
// that street's neighborhood -> ARV = nbhd average -> MAO via maoFromArv.
//
// KNOWN DATA BUG (flagged, not fixed here): properties.county says 'Kings
// County' for ALL NY rows but addresses include Manhattan streets — the
// harvest hardcoded county. We therefore match WITHOUT a borough filter and
// store the matched sale address in evidence so a wrong-borough hit is
// visible and auditable.
//
// Run: node tools/enrich_arv_nyc.mjs [--max=25] [--since=2025-01-01] [--dry-run]

import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { maoFromArv } from "../wholesale_spread.js";

const dir = dirname(fileURLToPath(import.meta.url));
const repo = join(dir, "..");
const DB = process.env.CRM_DB || join(repo, "crm.db");
const argv = process.argv.slice(2);
const opt = (k, d) => { const a = argv.find((x) => x.startsWith(`--${k}=`)); return a ? a.split("=")[1] : d; };
const max = Number(opt("max", 25)) || 25;
const since = opt("since", "2025-01-01");
const dryRun = argv.includes("--dry-run");
const REPAIR_DEFAULT = Number(opt("repair", 45000));

if (!process.env.PIPELINE_RUN && existsSync(join(repo, "docs", "HALT"))) { console.log("HALT present - stopping."); process.exit(0); }

const BASE = "https://data.cityofnewyork.us/resource/usep-8jbt.json";
// Residential 1-3 family + small multis; ignore $0 deed transfers.
const RES_WHERE = `sale_price > 50000 and sale_date >= '${since}' and (starts_with(building_class_category,'01') or starts_with(building_class_category,'02') or starts_with(building_class_category,'03'))`;

// (1) neighborhood averages — one request.
const au = new URL(BASE);
au.searchParams.set("$select", "neighborhood, avg(sale_price) as avg_price, count(1) as n");
au.searchParams.set("$where", RES_WHERE);
au.searchParams.set("$group", "neighborhood");
au.searchParams.set("$having", "count(1) >= 5");
au.searchParams.set("$limit", "400");
const aggr = await (await fetch(au)).json();
if (!Array.isArray(aggr)) { console.log("aggregate failed:", JSON.stringify(aggr).slice(0, 200)); process.exit(1); }
const nbhdAvg = new Map(aggr.map((r) => [r.neighborhood, Math.round(Number(r.avg_price))]));
console.log(`NYC nbhd comp table: ${nbhdAvg.size} neighborhoods (res sales >= 5 since ${since})`);

// county -> DOF sales borough code (usep-8jbt `borough` field, "1".."5").
// Requires tick-64's borough derivation; rows without a county match un-filtered
// matching and are skipped to avoid the cross-borough trap ('53 SPRING STREET'
// matched Staten Island's Spring St before this filter existed).
const COUNTY_BORO = { "New York County": "1", "Bronx County": "2", "Kings County": "3", "Queens County": "4", "Richmond County": "5" };

const db = new DatabaseSync(DB);
db.exec("PRAGMA busy_timeout = 15000");
const rows = db.prepare(`SELECT id, address, formatted_address, square_footage, county FROM properties
  WHERE state='NY' AND (arv IS NULL OR arv <= 0) AND address IS NOT NULL AND address <> ''
  ORDER BY lead_score DESC LIMIT ?`).all(max);
const updStmt = db.prepare("UPDATE properties SET arv=?, repair_estimate=?, mao=?, updated_at=? WHERE id=?");

let attempted = 0, priced = 0;
const samples = [];
const now = new Date().toISOString();
for (const r of rows) {
  attempted++;
  // (2) FULL-address prefix match. houseStreetKey was too loose here (its
  // first-word street key matched '11 EAST 10 ...' to '11 EAST 125 STREET' in
  // the dry run); the full raw address as a starts_with prefix is exact on
  // house+street while still absorbing suffix growth (PL -> PLACE, unit tails).
  const addr = String(r.address || r.formatted_address || "").toUpperCase().trim().replace(/'/g, "''");
  if (!/^\d+ /.test(addr)) continue;
  const boro = COUNTY_BORO[r.county];
  if (!boro) continue; // no verified borough -> no match (cross-borough trap)
  const su = new URL(BASE);
  su.searchParams.set("$select", "neighborhood, address");
  su.searchParams.set("$where", `borough='${boro}' and starts_with(upper(address),'${addr}')`);
  su.searchParams.set("$limit", "1");
  let hit = null;
  try { hit = (await (await fetch(su)).json())[0] || null; } catch { hit = null; }
  if (!hit || !nbhdAvg.has(hit.neighborhood)) continue;
  const arv = nbhdAvg.get(hit.neighborhood);
  const sqft = Number(r.square_footage) || null;
  const repairs = sqft ? Math.round(sqft * 25) : REPAIR_DEFAULT;
  const mao = maoFromArv(arv, repairs, { minFee: 10000 });
  priced++;
  if (samples.length < 6) samples.push(`${r.address}: [${hit.neighborhood} via ${hit.address}] ARV $${arv} -> MAO $${mao}`);
  if (!dryRun) updStmt.run(arv, repairs, mao, now, r.id);
}

const withArv = db.prepare("SELECT COUNT(*) c FROM properties WHERE arv IS NOT NULL AND arv>0").get().c;
console.log(`ARV-NYC${dryRun ? " [DRY]" : ""}: attempted=${attempted} priced=${priced} | total properties with ARV now: ${withArv}`);
if (samples.length) console.log("samples:\n  " + samples.join("\n  "));
db.close();

// tools/enrich_arv_cook.mjs — ARV + MAO for Cook County properties from neighborhood comps.
// ARV proxy = average recent arms-length sale price in the property's assessor neighborhood
// (what comparable homes actually sell for). Then MAO = ARV*70% - repairs - fee = the offer
// ceiling a wholesaler brings to the seller. Writes arv/repair_estimate/mao to crm.db.
//
// Chain: prop address -> PIN (parcel addresses 3723-97qp) -> nbhd (assessed values uzyt-m557)
//        -> nbhd avg recent sale (parcel sales wvhk-k5uv, precomputed once).
// Run: node tools/enrich_arv_cook.mjs [--tier=pay_to_unlock] [--max=N] [--dry-run]

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
const tier = opt("tier", "pay_to_unlock");
const max = Number(opt("max", 0)) || 0;
const dryRun = argv.includes("--dry-run");
const REPAIR_DEFAULT = Number(opt("repair", 45000)); // flat rehab estimate when sqft unknown

if (existsSync(join(repo, "docs", "HALT"))) { console.log("HALT present - stopping."); process.exit(0); }

const getJson = async (u) => { try { const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 15000); const r = await fetch(u, { signal: ctl.signal }); clearTimeout(t); return r.ok ? await r.json() : []; } catch { return []; } };
const A = "https://datacatalog.cookcountyil.gov/resource";

// 1) precompute nbhd -> avg recent sale (one query)
const nbhdAvg = new Map();
{
  const u = new URL(`${A}/wvhk-k5uv.json`);
  u.searchParams.set("$select", "nbhd, avg(sale_price) as avg, count(1) as n");
  u.searchParams.set("$where", "year>='2023' and sale_price between 20000 and 1000000 and nbhd is not null");
  u.searchParams.set("$group", "nbhd");
  u.searchParams.set("$limit", "5000");
  for (const r of await getJson(u)) if (Number(r.n) >= 10) nbhdAvg.set(String(r.nbhd), Math.round(Number(r.avg)));
}
console.log(`nbhd comp table: ${nbhdAvg.size} neighborhoods`);

const db = new DatabaseSync(DB);
const rows = db.prepare(`
  SELECT p.id, p.address, p.formatted_address, p.square_footage
  FROM properties p JOIN pro_queue q ON q.property_id = p.id
  WHERE q.tier = ? AND p.state='IL' AND (p.arv IS NULL OR p.arv = 0)
        AND p.owner_name IS NOT NULL AND p.owner_name<>''
  ${max ? `LIMIT ${max}` : ""}
`).all(tier);

const upd = db.prepare("UPDATE properties SET arv=?, repair_estimate=COALESCE(repair_estimate,?), mao=?, updated_at=? WHERE id=?");
const now = new Date().toISOString();
let attempted = 0, priced = 0;
const samples = [];

for (const r of rows) {
  attempted++;
  const addr = (r.address || r.formatted_address || "").replace(/'/g, "''");
  if (!addr) continue;
  let u = new URL(`${A}/3723-97qp.json`);
  u.searchParams.set("$select", "pin"); u.searchParams.set("$where", `upper(prop_address_full)=upper('${addr}')`);
  u.searchParams.set("$order", "year DESC"); u.searchParams.set("$limit", "1");
  const pin = (await getJson(u))[0]?.pin;
  if (!pin) continue;
  u = new URL(`${A}/uzyt-m557.json`);
  u.searchParams.set("$select", "nbhd"); u.searchParams.set("$where", `pin='${pin}'`);
  u.searchParams.set("$order", "year DESC"); u.searchParams.set("$limit", "1");
  const nbhd = (await getJson(u))[0]?.nbhd;
  const arv = nbhd ? nbhdAvg.get(String(nbhd)) : null;
  if (!arv) continue;
  const sqft = Number(r.square_footage) || null;
  const repairs = sqft ? Math.round(sqft * 25) : REPAIR_DEFAULT;
  const mao = maoFromArv(arv, repairs, { minFee: 10000 });
  priced++;
  if (samples.length < 6) samples.push(`${r.address}: ARV $${arv} -> MAO $${mao}`);
  if (!dryRun) upd.run(arv, repairs, mao, now, r.id);
}

const withArv = db.prepare("SELECT COUNT(*) c FROM properties WHERE arv IS NOT NULL AND arv>0").get().c;
console.log(`ARV-COOK tier=${tier}${dryRun ? " [DRY]" : ""}: attempted=${attempted} priced=${priced} | total properties with ARV now: ${withArv}`);
if (samples.length) console.log("samples:\n  " + samples.join("\n  "));

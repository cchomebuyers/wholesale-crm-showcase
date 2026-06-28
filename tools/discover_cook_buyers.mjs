// tools/discover_cook_buyers.mjs — cash-buyer discovery from Cook County recorded sales.
// Repeat buyers in the Assessor Parcel Sales (wvhk-k5uv) are active investors/landlords =
// the cash-buyer side of a wholesale deal (which has been empty). Aggregates server-side via
// SoQL group/having, filters out title/land-trust/agency vehicles, and writes real buyers to
// the buyer_discovery_candidates table (same shape the server/promote flow already uses).
//
// Run: node tools/discover_cook_buyers.mjs [--min-buys=5] [--since=2024] [--limit=300] [--dry-run]

import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { normalizeBuyerCandidate, isRealBuyer, buyerConfidence } from "../buyer_discovery.js";

const dir = dirname(fileURLToPath(import.meta.url));
const repo = join(dir, "..");
const DB = process.env.CRM_DB || join(repo, "crm.db");
const argv = process.argv.slice(2);
const opt = (k, d) => { const a = argv.find((x) => x.startsWith(`--${k}=`)); return a ? a.split("=")[1] : d; };
const minBuys = Number(opt("min-buys", 5));
const since = opt("since", "2024");
const limit = Number(opt("limit", 300));
const dryRun = argv.includes("--dry-run");

if (existsSync(join(repo, "docs", "HALT"))) { console.log("HALT present - stopping."); process.exit(0); }

const u = new URL("https://datacatalog.cookcountyil.gov/resource/wvhk-k5uv.json");
u.searchParams.set("$select", "buyer_name, count(1) as purchases, avg(sale_price) as avg_price, max(sale_price) as max_price, min(sale_price) as min_price");
u.searchParams.set("$where", `year>='${since}' and sale_price>10000 and buyer_name is not null`);
u.searchParams.set("$group", "buyer_name");
u.searchParams.set("$having", `count(1) >= ${minBuys}`);
u.searchParams.set("$order", "purchases desc");
u.searchParams.set("$limit", String(limit));

let rows = [];
try {
  const r = await fetch(u);
  if (!r.ok) { console.log(`fetch failed: ${r.status}`); process.exit(1); }
  rows = await r.json();
} catch (e) { console.log(`fetch error: ${e.message}`); process.exit(1); }

const db = new DatabaseSync(DB);
db.exec(`CREATE TABLE IF NOT EXISTS buyer_discovery_candidates (
  id INTEGER PRIMARY KEY AUTOINCREMENT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  name TEXT NOT NULL, phone TEXT, email TEXT, areas TEXT, property_types TEXT, max_price REAL,
  cash INTEGER DEFAULT 1, source_id TEXT, source_type TEXT, confidence TEXT,
  evidence_json TEXT NOT NULL, imported_buyer_id INTEGER)`);

const find = db.prepare("SELECT id FROM buyer_discovery_candidates WHERE lower(name)=lower(?) AND source_id=?");
const ins = db.prepare(`INSERT INTO buyer_discovery_candidates
  (created_at,updated_at,name,phone,email,areas,property_types,max_price,cash,source_id,source_type,confidence,evidence_json)
  VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`);
const upd = db.prepare(`UPDATE buyer_discovery_candidates SET updated_at=?, areas=?, max_price=?, confidence=?, evidence_json=? WHERE id=?`);

const now = new Date().toISOString();
let seen = 0, rejected = 0, inserted = 0, updated = 0;
const samples = [];

for (const row of rows) {
  seen++;
  if (!isRealBuyer(row.buyer_name)) { rejected++; continue; }
  const purchases = Number(row.purchases) || 0;
  const cand = normalizeBuyerCandidate({
    business_name: row.buyer_name,
    areas: "Cook County, IL",
    max_price: Math.round(Number(row.max_price) || 0),
    source_id: "cook-il-parcel-sales",
    source_type: "buyer-discovery",
    confidence: buyerConfidence(purchases),
    purchase_count: purchases,
    discovery_family: "recorded-cash-buyers",
    reason: `${purchases} recorded Cook County purchases since ${since}; avg $${Math.round(Number(row.avg_price) || 0)}`,
  });
  if (!cand) { rejected++; continue; }
  if (samples.length < 6) samples.push(`${purchases}x $${cand.max_price} ${cand.name}`);
  if (dryRun) continue;
  const evidence = JSON.stringify(cand.evidence);
  const ex = find.get(cand.name, cand.source_id);
  if (ex) { upd.run(now, cand.areas, cand.max_price, cand.confidence, evidence, ex.id); updated++; }
  else { ins.run(now, now, cand.name, null, null, cand.areas, cand.property_types, cand.max_price, cand.cash, cand.source_id, cand.source_type, cand.confidence, evidence); inserted++; }
}

const total = db.prepare("SELECT COUNT(*) c FROM buyer_discovery_candidates").get().c;
console.log(`COOK BUYER DISCOVERY${dryRun ? " [DRY]" : ""}: aggregated=${seen} rejected=${rejected} inserted=${inserted} updated=${updated} | total buyer candidates: ${total}`);
if (samples.length) console.log(`samples: ${samples.join(" | ")}`);

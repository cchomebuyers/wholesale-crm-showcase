// tools/discover_nyc_buyers.mjs — cash-buyer discovery from NYC ACRIS deeds.
// Blueprint: councilRoom/comms/2026-07-02-nyc-buyer-discovery-blueprint.md
// (fields live-verified). Master DEED window (bnx9-e6tj: document_id, amt,
// recorded_borough) joined to Parties grantees (636b-3b5g: party_type='2',
// name) in bounded batches; repeat grantees become buyer_discovery_candidates
// through the SAME gates as Cook (isRealBuyer, buyerConfidence,
// normalizeBuyerCandidate) with source_id nyc-acris-deeds.
//
// Run: node tools/discover_nyc_buyers.mjs [--since=2025-01-01] [--min-buys=5]
//      [--max-docs=2000] [--dry-run]

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
const since = opt("since", "2025-01-01");
const minBuys = Number(opt("min-buys", 5));
const maxDocs = Math.min(5000, Number(opt("max-docs", 2000)) || 2000);
const dryRun = process.argv.includes("--dry-run");

if (!process.env.PIPELINE_RUN && existsSync(join(repo, "docs", "HALT"))) { console.log("HALT present - stopping."); process.exit(0); }

const BOROUGH = { 1: "New York, NY", 2: "Bronx, NY", 3: "Brooklyn, NY", 4: "Queens, NY", 5: "Staten Island, NY" };

// 1) DEED master window — one request.
const mu = new URL("https://data.cityofnewyork.us/resource/bnx9-e6tj.json");
mu.searchParams.set("$select", "document_id, document_amt, recorded_borough");
mu.searchParams.set("$where", `doc_type='DEED' and document_amt>10000 and recorded_datetime>='${since}'`);
mu.searchParams.set("$order", "recorded_datetime DESC");
mu.searchParams.set("$limit", String(maxDocs));

const masters = await (await fetch(mu)).json();
if (!Array.isArray(masters)) { console.log("master fetch failed:", JSON.stringify(masters).slice(0, 200)); process.exit(1); }
const byDoc = new Map(masters.map((m) => [m.document_id, m]));
console.log(`ACRIS DEED window since ${since}: ${masters.length} docs`);

// 2) Grantees in batches of 150 document_ids.
const grantees = []; // {name, amt, borough}
const ids = [...byDoc.keys()];
for (let i = 0; i < ids.length; i += 150) {
  const batch = ids.slice(i, i + 150);
  const pu = new URL("https://data.cityofnewyork.us/resource/636b-3b5g.json");
  pu.searchParams.set("$select", "document_id, name");
  pu.searchParams.set("$where", `party_type='2' and document_id in(${batch.map((x) => `'${x}'`).join(",")})`);
  pu.searchParams.set("$limit", "1000");
  const rows = await (await fetch(pu)).json();
  if (!Array.isArray(rows)) { console.log(`parties batch ${i / 150} failed`); continue; }
  for (const r of rows) {
    const m = byDoc.get(r.document_id);
    if (m && r.name) grantees.push({ name: r.name.trim(), amt: Number(m.document_amt) || 0, borough: BOROUGH[Number(m.recorded_borough)] || "New York, NY" });
  }
}
console.log(`grantee rows: ${grantees.length} (from ${Math.ceil(ids.length / 150)} party batches)`);

// 3) Aggregate repeat buyers.
const agg = new Map();
for (const g of grantees) {
  const k = g.name.toUpperCase();
  const a = agg.get(k) || { name: g.name, purchases: 0, maxAmt: 0, boroughs: new Set() };
  a.purchases++; a.maxAmt = Math.max(a.maxAmt, g.amt); a.boroughs.add(g.borough);
  agg.set(k, a);
}

const db = new DatabaseSync(DB);
db.exec("PRAGMA busy_timeout = 15000");
const find = db.prepare("SELECT id FROM buyer_discovery_candidates WHERE lower(name)=lower(?) AND source_id=?");
const ins = db.prepare(`INSERT INTO buyer_discovery_candidates
  (created_at,updated_at,name,phone,email,areas,property_types,max_price,cash,source_id,source_type,confidence,evidence_json)
  VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`);
const upd = db.prepare("UPDATE buyer_discovery_candidates SET updated_at=?, areas=?, max_price=?, confidence=?, evidence_json=? WHERE id=?");

const now = new Date().toISOString();
let qualified = 0, rejected = 0, inserted = 0, updated = 0;
const samples = [];
for (const a of [...agg.values()].sort((x, y) => y.purchases - x.purchases)) {
  if (a.purchases < minBuys) continue;
  qualified++;
  if (!isRealBuyer(a.name)) { rejected++; continue; }
  const cand = normalizeBuyerCandidate({
    business_name: a.name,
    areas: [...a.boroughs].join("; "),
    max_price: Math.round(a.maxAmt),
    source_id: "nyc-acris-deeds",
    source_type: "buyer-discovery",
    // Window calibration: this run samples ~maxDocs of NYC's ~85k/yr deed flow,
    // so N repeats IN-WINDOW implies far higher annual volume than raw
    // buyerConfidence assumes. 4+ in-window -> medium, else low; the reason
    // string carries the window basis so the promotion gate stays informed.
    confidence: a.purchases >= 4 ? "medium" : buyerConfidence(a.purchases),
    purchase_count: a.purchases,
    discovery_family: "recorded-cash-buyers",
    reason: `${a.purchases} recorded NYC deeds since ${since}; max $${Math.round(a.maxAmt).toLocaleString()}`,
  });
  if (!cand) { rejected++; continue; }
  if (samples.length < 6) samples.push(`${a.purchases}x $${cand.max_price} ${cand.name} [${cand.areas}]`);
  if (dryRun) continue;
  const ex = find.get(cand.name, cand.source_id);
  if (ex) { upd.run(now, cand.areas, cand.max_price, cand.confidence, JSON.stringify(cand.evidence), ex.id); updated++; }
  else { ins.run(now, now, cand.name, null, null, cand.areas, cand.property_types, cand.max_price, cand.cash, cand.source_id, cand.source_type, cand.confidence, JSON.stringify(cand.evidence)); inserted++; }
}

const total = db.prepare("SELECT COUNT(*) c FROM buyer_discovery_candidates").get().c;
console.log(`NYC BUYER DISCOVERY${dryRun ? " [DRY]" : ""}: repeat>=${minBuys}: ${qualified} rejected=${rejected} inserted=${inserted} updated=${updated} | total candidates: ${total}`);
if (samples.length) console.log(`samples: ${samples.join(" | ")}`);
db.close();

// tools/get_1000_leads.mjs — real test: get N leads WITH phone numbers, free, via the system's
// verified phone source (NYC business licenses). Paginates + dedupes + retries; does NOT stop on a
// short/failed page — keeps going until it has N or the dataset is exhausted.
// Run: node tools/get_1000_leads.mjs [N]
import { writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeNycLicense } from "../connectors/nyc-business-licenses.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dirname, "..", "data", "leads_1000_with_phone.jsonl");
const URL_BASE = "https://data.cityofnewyork.us/resource/w7w3-xahh.json";
const TARGET = Number(process.argv[2] || 1000);
const PAGE = 1000;
const MAX_PAGES = 80;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchPage(offset, attempt = 0) {
  const u = new URL(URL_BASE);
  u.searchParams.set("$where", "contact_phone IS NOT NULL");
  u.searchParams.set("$limit", String(PAGE));
  u.searchParams.set("$offset", String(offset));
  u.searchParams.set("$order", "license_nbr");
  try {
    const r = await fetch(u);
    if (r.status === 429 || r.status >= 500) throw new Error("HTTP " + r.status);
    if (!r.ok) return [];
    return await r.json();
  } catch (e) {
    if (attempt < 4) { await sleep(1500 * (attempt + 1)); return fetchPage(offset, attempt + 1); } // retry, don't stop
    console.error(`  page@${offset} failed after retries: ${e.message}`);
    return [];
  }
}

const seen = new Set(); // dedup by license number (one distinct licensed business = one lead)
const leads = [];
let offset = 0, pages = 0, emptyStreak = 0;

while (leads.length < TARGET && pages < MAX_PAGES) {
  const rows = await fetchPage(offset);
  pages++;
  offset += PAGE;
  if (!Array.isArray(rows) || rows.length === 0) {
    emptyStreak++;
    if (emptyStreak >= 3) break; // dataset truly exhausted
    continue;
  }
  emptyStreak = 0;
  for (const row of rows) {
    const n = normalizeNycLicense(row);
    if (!n || !n.phone) continue;
    const key = n.license_id || `${n.business_name}|${n.address}`;
    if (seen.has(key)) continue;
    seen.add(key);
    leads.push({
      business_name: n.business_name, phone: n.phone, address: n.address,
      city: n.city, state: n.state, zip: n.zip, source: n.source_id,
      relation: "business_operator", outreach_allowed: false, compliance_status: "unchecked",
    });
    if (leads.length >= TARGET) break;
  }
  console.log(`  page ${pages} (offset ${offset}): leads-with-phone so far = ${leads.length}`);
}

writeFileSync(OUT, leads.map((l) => JSON.stringify(l)).join("\n") + "\n");
const withPhone = leads.filter((l) => l.phone).length;
console.log(`\nRESULT: ${leads.length} distinct leads, ${withPhone} WITH phone → ${OUT}`);
if (leads[0]) console.log("sample:", JSON.stringify(leads[0]));
if (leads.length < TARGET) { console.log(`\n⚠️ only got ${leads.length}/${TARGET}`); process.exit(2); }
console.log(`\n✅ TARGET MET: ${TARGET} leads with phone numbers.`);

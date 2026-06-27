// tools/harvest_leads.mjs — recurring lead harvester. Each run pulls MORE address+phone+owner leads
// from the system's verified free phone source (NYC business licenses connector), dedupes, and
// APPENDS to an accumulating store. State (offset) persists across runs so every 5-min wake grabs
// NEW leads — accumulating toward thousands. Compliance-gated. Run: node tools/harvest_leads.mjs [pages]
import { writeFileSync, readFileSync, existsSync, appendFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeNycLicense } from "../connectors/nyc-business-licenses.js";

const dir = dirname(fileURLToPath(import.meta.url));
const OUT = join(dir, "..", "data", "leads_accumulating.jsonl");
const STATE = join(dir, "..", "data", ".harvest_state.json");
const URL_BASE = "https://data.cityofnewyork.us/resource/w7w3-xahh.json";
const PAGE = 1000;
const BATCH_PAGES = Number(process.argv[2] || 8); // pages per run (8 = up to ~8000 leads/run)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

if (existsSync(join(dir, "..", "docs", "HALT"))) { console.log("HALT present — stopping."); process.exit(0); }

let state = { offset: 0 };
try { if (existsSync(STATE)) state = JSON.parse(readFileSync(STATE, "utf8")); } catch {}

// rebuild the dedup set from what we already have
const seen = new Set();
let existing = 0;
try {
  if (existsSync(OUT)) for (const line of readFileSync(OUT, "utf8").trim().split("\n")) {
    if (!line) continue; existing++; try { const l = JSON.parse(line); if (l.key) seen.add(l.key); } catch {}
  }
} catch {}

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
    if (attempt < 4) { await sleep(1500 * (attempt + 1)); return fetchPage(offset, attempt + 1); }
    console.error(`  page@${offset} failed: ${e.message}`); return [];
  }
}

let added = 0, offset = state.offset, emptyStreak = 0;
for (let p = 0; p < BATCH_PAGES; p++) {
  const rows = await fetchPage(offset);
  if (!Array.isArray(rows) || rows.length === 0) {
    emptyStreak++; offset = 0; // wrap to start when dataset exhausted
    if (emptyStreak >= 2) break;
    continue;
  }
  emptyStreak = 0;
  const batch = [];
  for (const row of rows) {
    const n = normalizeNycLicense(row);
    if (!n || !n.phone) continue;
    const key = n.license_id || `${n.business_name}|${n.address}`;
    if (seen.has(key)) continue;
    seen.add(key);
    batch.push(JSON.stringify({
      key, owner: n.business_name, name: n.business_name, phone: n.phone,
      address: n.address, city: n.city, state: n.state, zip: n.zip,
      source: n.source_id, relation: "business_operator",
      outreach_allowed: false, compliance_status: "unchecked",
      harvested_at: new Date().toISOString(),
    }));
  }
  if (batch.length) { appendFileSync(OUT, batch.join("\n") + "\n"); added += batch.length; }
  offset += PAGE;
}

writeFileSync(STATE, JSON.stringify({ offset, updated_at: new Date().toISOString() }));
const total = existing + added;
console.log(`HARVEST: +${added} new (address+phone+owner) this run | running total = ${total} | next offset=${offset}`);
console.log(`→ data/leads_accumulating.jsonl`);

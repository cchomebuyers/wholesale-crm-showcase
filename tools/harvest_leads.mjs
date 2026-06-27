// tools/harvest_leads.mjs — MULTI-SOURCE recurring lead harvester. Pulls address+phone+owner leads
// from EVERY public-contact connector that exposes harvest() (NYC + nationwide Socrata phone sources),
// dedupes, and APPENDS to an accumulating store. Per-source offsets persist so each run gets NEW leads
// across America. Compliance-gated. Run: node tools/harvest_leads.mjs [pagesPerSource]
import { writeFileSync, readFileSync, existsSync, appendFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { buildRegistry } from "../connectors/index.js";

const dir = dirname(fileURLToPath(import.meta.url));
const OUT = join(dir, "..", "data", "leads_accumulating.jsonl");
const STATE = join(dir, "..", "data", ".harvest_state.json");
const PAGE = 1000;
const PAGES_PER_SOURCE = Number(process.argv[2] || 3);

if (existsSync(join(dir, "..", "docs", "HALT"))) { console.log("HALT present — stopping."); process.exit(0); }

let state = { offsets: {} };
try { if (existsSync(STATE)) { const s = JSON.parse(readFileSync(STATE, "utf8")); state.offsets = s.offsets || (typeof s.offset === "number" ? { "nyc-business-licenses": s.offset } : {}); } } catch {}

const seen = new Set();
let existing = 0;
try { if (existsSync(OUT)) for (const line of readFileSync(OUT, "utf8").trim().split("\n")) { if (!line) continue; existing++; try { const l = JSON.parse(line); if (l.key) seen.add(l.key); } catch {} } } catch {}

const noop = async () => [];
const registry = buildRegistry({ rentcastGet: noop, pullBlightTickets: noop, detroitComps: noop, getSetting: () => null });
const sources = Object.values(registry).filter((c) => c.type === "public-contact" && typeof c.harvest === "function");

let addedTotal = 0;
const perSource = {};
for (const conn of sources) {
  let offset = state.offsets[conn.id] || 0;
  let added = 0, empty = 0;
  for (let p = 0; p < PAGES_PER_SOURCE; p++) {
    let rows = [];
    try { rows = await conn.harvest({ limit: PAGE, offset }); } catch {}
    if (!Array.isArray(rows) || rows.length === 0) { empty++; offset = 0; if (empty >= 2) break; continue; }
    empty = 0;
    const batch = [];
    for (const r of rows) {
      if (!r || !r.phone) continue;
      const key = `${conn.id}:${r.license_id || `${r.name || r.business_name}|${r.address}|${r.phone}`}`;
      if (seen.has(key)) continue; seen.add(key);
      batch.push(JSON.stringify({
        key, source: conn.id, region: conn.region || null,
        owner: r.business_name || r.name || null, name: r.business_name || r.name || null,
        phone: r.phone, address: r.address, city: r.city, state: r.state, zip: r.zip,
        relation: "business_operator", outreach_allowed: false, compliance_status: "unchecked",
        harvested_at: new Date().toISOString(),
      }));
    }
    if (batch.length) { appendFileSync(OUT, batch.join("\n") + "\n"); added += batch.length; }
    offset += PAGE;
  }
  state.offsets[conn.id] = offset;
  perSource[conn.id] = added; addedTotal += added;
}

writeFileSync(STATE, JSON.stringify({ offsets: state.offsets, updated_at: new Date().toISOString() }));
const total = existing + addedTotal;
const breakdown = Object.entries(perSource).filter(([, n]) => n > 0).map(([s, n]) => `${s}+${n}`).join(", ") || "none";
console.log(`HARVEST: +${addedTotal} new across ${sources.length} sources | running total = ${total} | [${breakdown}]`);

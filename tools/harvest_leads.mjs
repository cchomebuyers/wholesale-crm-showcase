// tools/harvest_leads.mjs — MULTI-SOURCE recurring lead harvester (scale-safe rewrite).
// Pulls address+phone+owner leads from every public-contact connector with harvest(), appends to an
// accumulating store. Scale-safe dedup: per-source offsets are MONOTONIC (never reset), and a source
// that returns an empty page is marked EXHAUSTED and skipped thereafter — so we never re-fetch the same
// records and never need to read the (now huge) output file into memory. Compliance-gated.
// Run: node tools/harvest_leads.mjs [pagesPerSource]
import { writeFileSync, readFileSync, existsSync, appendFileSync, createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { buildRegistry } from "../connectors/index.js";

const dir = dirname(fileURLToPath(import.meta.url));
const OUT = join(dir, "..", "data", "leads_accumulating.jsonl");
const STATE = join(dir, "..", "data", ".harvest_state.json");
const PAGE = 1000;
const PAGES_PER_SOURCE = Number(process.argv[2] || 3);

if (existsSync(join(dir, "..", "docs", "HALT"))) { console.log("HALT present — stopping."); process.exit(0); }

let state = { offsets: {}, exhausted: [], total: undefined };
try { if (existsSync(STATE)) { const s = JSON.parse(readFileSync(STATE, "utf8")); state.offsets = s.offsets || {}; state.exhausted = s.exhausted || []; state.total = s.total; } } catch {}
const exhausted = new Set(state.exhausted);

// Seed cumulative total once by STREAMING the file (low memory) — never load it all at once.
async function streamCount(path) {
  if (!existsSync(path)) return 0;
  let n = 0;
  await new Promise((res) => {
    const rl = createInterface({ input: createReadStream(path), crlfDelay: Infinity });
    rl.on("line", () => { if (true) n++; });
    rl.on("close", res);
  });
  return n;
}
if (typeof state.total !== "number") state.total = await streamCount(OUT);

const noop = async () => [];
const registry = buildRegistry({ rentcastGet: noop, pullBlightTickets: noop, detroitComps: noop, getSetting: () => null });
const sources = Object.values(registry).filter((c) => c.type === "public-contact" && typeof c.harvest === "function");

let addedTotal = 0;
const perSource = {};
for (const conn of sources) {
  if (exhausted.has(conn.id)) continue;
  let offset = state.offsets[conn.id] || 0;
  let added = 0;
  const seen = new Set(); // within-source dedup (keys are id-scoped; offsets prevent cross-run repeats)
  for (let p = 0; p < PAGES_PER_SOURCE; p++) {
    let rows = [];
    try { rows = await conn.harvest({ limit: PAGE, offset }); } catch {}
    if (!Array.isArray(rows) || rows.length === 0) { exhausted.add(conn.id); break; } // done — do NOT reset to 0
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
  if (added) perSource[conn.id] = added;
  addedTotal += added;
}

state.total += addedTotal;
state.exhausted = [...exhausted];
writeFileSync(STATE, JSON.stringify({ offsets: state.offsets, exhausted: state.exhausted, total: state.total, updated_at: new Date().toISOString() }));
const live = sources.length - exhausted.size;
const breakdown = Object.entries(perSource).map(([s, n]) => `${s}+${n}`).join(", ") || "none";
console.log(`HARVEST: +${addedTotal} new | running total = ${state.total} | ${live}/${sources.length} sources live | [${breakdown}]`);

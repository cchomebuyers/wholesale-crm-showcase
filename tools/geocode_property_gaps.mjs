// tools/geocode_property_gaps.mjs - bounded Census geocoder evidence for missing city/zip.
// Writes enrichment rows only; it does not rewrite the main property harvest.
import { appendFileSync, createReadStream, existsSync, mkdirSync } from "node:fs";
import { createInterface } from "node:readline";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { geocodeAddress } from "../connectors/census.js";

const dir = dirname(fileURLToPath(import.meta.url));
const repo = join(dir, "..");
const DATA_DIR = process.env.PROPERTY_LEADS_DIR || join(repo, "data");
const IN = process.argv.find((a) => /^--in=/.test(a))?.split("=")[1] || join(DATA_DIR, "properties_context_enriched.jsonl");
const OUT = process.argv.find((a) => /^--out=/.test(a))?.split("=")[1] || join(DATA_DIR, "property_geo_enrichment.jsonl");
const max = Number(process.argv.find((a) => /^--max=/.test(a))?.split("=")[1] || 25);
const dryRun = process.argv.includes("--dry-run");
const delayMs = Number(process.argv.find((a) => /^--delay-ms=/.test(a))?.split("=")[1] || 125);

mkdirSync(dirname(OUT), { recursive: true });

async function existingKeys(path) {
  const keys = new Set();
  if (!existsSync(path)) return keys;
  await new Promise((res) => {
    const rl = createInterface({ input: createReadStream(path), crlfDelay: Infinity });
    rl.on("line", (line) => {
      try {
        const r = JSON.parse(line);
        if (r.addr_key) keys.add(r.addr_key);
      } catch {}
    });
    rl.on("close", res);
  });
  return keys;
}

function defaultCity(row) {
  const source = String(row.source || "").toLowerCase();
  if (source === "cook-il-violations") return "Chicago";
  if (source === "losangeles-ca-violations") return "Los Angeles";
  return null;
}

function geocodeLine(row) {
  return [row.address || row.formatted_address, row.city || defaultCity(row), row.state, row.zip].filter(Boolean).join(", ");
}

const seen = await existingKeys(OUT);
let scanned = 0;
let attempted = 0;
let matched = 0;
let skippedExisting = 0;
const samples = [];

if (!existsSync(IN)) {
  console.log(`GEOCODE GAPS: input missing ${IN}`);
  process.exit(0);
}

const rl = createInterface({ input: createReadStream(IN), crlfDelay: Infinity });
for await (const line of rl) {
  if (attempted >= max) break;
  let row;
  try { row = JSON.parse(line); } catch { continue; }
  scanned++;
  if (row.city && row.zip && row.latitude && row.longitude) continue;
  if (row.addr_key && seen.has(row.addr_key)) {
    skippedExisting++;
    continue;
  }
  const query = geocodeLine(row);
  if (!query) continue;
  attempted++;
  const g = await geocodeAddress(query);
  const out = {
    addr_key: row.addr_key || row.key || null,
    source: row.source || null,
    query,
    matched: Boolean(g.matched),
    formatted_address: g.standardized || g.formatted_address || null,
    city: g.city || null,
    state: g.state || null,
    zip: g.zip || null,
    latitude: g.lat ?? null,
    longitude: g.lon ?? null,
    error: g.error || null,
    legal_status: "public_official_api",
    provider: "us_census_geocoder",
    expected_city: defaultCity(row),
    expected_city_match: defaultCity(row) ? String(g.city || "").toLowerCase() === defaultCity(row).toLowerCase() : null,
    generated_at: new Date().toISOString(),
  };
  if (out.matched) matched++;
  if (samples.length < 5) samples.push(out);
  if (!dryRun) appendFileSync(OUT, JSON.stringify(out) + "\n");
  if (row.addr_key) seen.add(row.addr_key);
  if (delayMs > 0) await new Promise((res) => setTimeout(res, delayMs));
}

console.log(`GEOCODE GAPS: scanned=${scanned} attempted=${attempted} matched=${matched} skipped_existing=${skippedExisting} dryRun=${dryRun}`);
console.log(`SAMPLE: ${JSON.stringify(samples, null, 2)}`);

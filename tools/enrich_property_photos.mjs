// tools/enrich_property_photos.mjs - writes photo candidate metadata only.
// It does not fetch, cache, resize, or redistribute image files.
import { appendFileSync, createReadStream, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { photoMetadataForProperty } from "./photo_candidate_core.mjs";

const dir = dirname(fileURLToPath(import.meta.url));
const repo = join(dir, "..");
const DATA_DIR = process.env.PROPERTY_LEADS_DIR || join(repo, "data");
const IN = process.argv.find((a) => /^--in=/.test(a))?.split("=")[1] || join(DATA_DIR, "properties_accumulating.jsonl");
const OUT = process.argv.find((a) => /^--out=/.test(a))?.split("=")[1] || join(DATA_DIR, "property_photo_candidates.jsonl");
const STATE = join(DATA_DIR, ".property_photo_state.json");
const maxRecords = Number(process.argv.find((a) => /^--max=/.test(a))?.split("=")[1] || 0);
const includeGaps = process.argv.includes("--include-gaps");
const dryRun = process.argv.includes("--dry-run");

mkdirSync(DATA_DIR, { recursive: true });

function loadState() {
  try {
    if (existsSync(STATE)) return JSON.parse(readFileSync(STATE, "utf8"));
  } catch {}
  return { scanned: 0, written: 0, gaps: 0, updated_at: null };
}

function saveState(state) {
  writeFileSync(STATE, JSON.stringify({ ...state, updated_at: new Date().toISOString() }, null, 2));
}

async function streamExistingKeys(path) {
  const keys = new Set();
  if (!existsSync(path)) return keys;
  await new Promise((res) => {
    const rl = createInterface({ input: createReadStream(path), crlfDelay: Infinity });
    rl.on("line", (line) => {
      try {
        const row = JSON.parse(line);
        if (row.addr_key) keys.add(row.addr_key);
      } catch {}
    });
    rl.on("close", res);
  });
  return keys;
}

if (!existsSync(IN)) {
  console.log(`PHOTO ENRICH: input missing ${IN}`);
  process.exit(0);
}

const state = loadState();
const seen = await streamExistingKeys(OUT);
let scanned = 0;
let written = 0;
let gaps = 0;
let skippedExisting = 0;
const samples = [];

const opts = {
  googleStreetViewApiKey: process.env.GOOGLE_STREET_VIEW_API_KEY || process.env.STREET_VIEW_API_KEY || null,
  streetViewDisplayAllowed: process.env.STREET_VIEW_DISPLAY_ALLOWED === "true",
  listingDisplayAllowed: process.env.LISTING_PHOTO_DISPLAY_ALLOWED === "true",
  listingCacheAllowed: process.env.LISTING_PHOTO_CACHE_ALLOWED === "true",
  assessorDisplayAllowed: process.env.ASSESSOR_PHOTO_DISPLAY_ALLOWED === "true",
  assessorCacheAllowed: process.env.ASSESSOR_PHOTO_CACHE_ALLOWED === "true",
};

await new Promise((res) => {
  const rl = createInterface({ input: createReadStream(IN), crlfDelay: Infinity });
  rl.on("line", (line) => {
    if (maxRecords > 0 && scanned >= maxRecords) return;
    let row;
    try { row = JSON.parse(line); } catch { return; }
    scanned++;
    const key = row.addr_key || row.key;
    if (key && seen.has(key)) {
      skippedExisting++;
      return;
    }
    const meta = photoMetadataForProperty(row, opts);
    if (!meta.has_photo_candidate) {
      gaps++;
      if (!includeGaps) return;
    }
    if (samples.length < 5) samples.push(meta);
    if (!dryRun) appendFileSync(OUT, JSON.stringify(meta) + "\n");
    if (key) seen.add(key);
    written++;
  });
  rl.on("close", res);
});

state.scanned += scanned;
state.written += dryRun ? 0 : written;
state.gaps += gaps;
if (!dryRun) saveState(state);

console.log(`PHOTO ENRICH: scanned=${scanned} written=${written} gaps=${gaps} skipped_existing=${skippedExisting} dryRun=${dryRun}`);
console.log(`SAMPLE: ${JSON.stringify(samples, null, 2)}`);

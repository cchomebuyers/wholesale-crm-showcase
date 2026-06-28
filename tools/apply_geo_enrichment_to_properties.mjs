// tools/apply_geo_enrichment_to_properties.mjs - apply verified Census city/zip evidence to staged properties.
import { createReadStream, existsSync } from "node:fs";
import { createInterface } from "node:readline";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

const dir = dirname(fileURLToPath(import.meta.url));
const repo = join(dir, "..");
const DATA_DIR = process.env.PROPERTY_LEADS_DIR || join(repo, "data");
const IN = process.argv.find((a) => /^--in=/.test(a))?.split("=")[1] || join(DATA_DIR, "property_geo_enrichment.v2.jsonl");
const max = Number(process.argv.find((a) => /^--max=/.test(a))?.split("=")[1] || 0);
const dryRun = process.argv.includes("--dry-run");

if (!existsSync(IN)) {
  console.log(`APPLY GEO: input missing ${IN}`);
  process.exit(0);
}

const db = new DatabaseSync(join(repo, "crm.db"));
const get = db.prepare("SELECT id, city, state, zip, latitude, longitude FROM properties WHERE addr_key=?");
const upd = db.prepare(`UPDATE properties SET
  updated_at=?,
  formatted_address=COALESCE(NULLIF(formatted_address, ''), ?),
  city=COALESCE(NULLIF(city, ''), ?),
  state=COALESCE(NULLIF(state, ''), ?),
  zip=COALESCE(NULLIF(zip, ''), ?),
  latitude=COALESCE(latitude, ?),
  longitude=COALESCE(longitude, ?)
  WHERE addr_key=?`);

let scanned = 0;
let eligible = 0;
let matchedDb = 0;
let updated = 0;
let skippedUnsafe = 0;
const samples = [];

const rl = createInterface({ input: createReadStream(IN), crlfDelay: Infinity });
for await (const line of rl) {
  if (max > 0 && eligible >= max) break;
  let row;
  try { row = JSON.parse(line); } catch { continue; }
  scanned++;
  if (!row.addr_key || !row.matched || row.expected_city_match === false) {
    skippedUnsafe++;
    continue;
  }
  eligible++;
  const existing = get.get(row.addr_key);
  if (!existing) continue;
  matchedDb++;
  const needs = !existing.city || !existing.zip || existing.latitude == null || existing.longitude == null;
  if (!needs) continue;
  if (samples.length < 5) samples.push({ id: existing.id, addr_key: row.addr_key, city: row.city, zip: row.zip });
  if (!dryRun) {
    upd.run(new Date().toISOString(), row.formatted_address, row.city, row.state, row.zip, row.latitude, row.longitude, row.addr_key);
  }
  updated++;
}

db.close();
console.log(`APPLY GEO: scanned=${scanned} eligible=${eligible} db_matches=${matchedDb} updated=${updated} skipped_unsafe=${skippedUnsafe} dryRun=${dryRun}`);
console.log(`SAMPLE: ${JSON.stringify(samples, null, 2)}`);

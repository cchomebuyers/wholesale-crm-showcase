// tools/apply_owner_enrichment_to_properties.mjs - apply owner metadata only.
// Phone/email/contact fields are intentionally ignored; outreach remains compliance-gated elsewhere.
import { createReadStream, existsSync } from "node:fs";
import { createInterface } from "node:readline";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

const dir = dirname(fileURLToPath(import.meta.url));
const repo = join(dir, "..");
const DATA_DIR = process.env.PROPERTY_LEADS_DIR || join(repo, "data");
const IN = process.argv.find((a) => /^--in=/.test(a))?.split("=")[1] || join(DATA_DIR, "property_owner_enrichment.jsonl");
const max = Number(process.argv.find((a) => /^--max=/.test(a))?.split("=")[1] || 0);
const dryRun = process.argv.includes("--dry-run");
const overwrite = process.argv.includes("--overwrite");

if (!existsSync(IN)) {
  console.log(`APPLY OWNER: input missing ${IN}`);
  process.exit(0);
}

const db = new DatabaseSync(join(repo, "crm.db"));
const get = db.prepare("SELECT id, owner_name FROM properties WHERE addr_key=?");
const upd = db.prepare(`UPDATE properties SET
  updated_at=?,
  owner_name=?,
  owner_mailing=COALESCE(?, owner_mailing),
  owner_source=?,
  owner_enriched_at=?
  WHERE addr_key=?`);

let scanned = 0;
let eligible = 0;
let matchedDb = 0;
let updated = 0;
let skippedNoOwner = 0;
let skippedExisting = 0;
let contactFieldsSeen = 0;
const samples = [];

const rl = createInterface({ input: createReadStream(IN), crlfDelay: Infinity });
for await (const line of rl) {
  if (max > 0 && eligible >= max) break;
  let row;
  try { row = JSON.parse(line); } catch { continue; }
  scanned++;
  if (row.phone || row.email || row.seller_phone || row.seller_email) contactFieldsSeen++;
  const ownerName = row.owner_name || row.owner || row.ownerName;
  if (!row.addr_key || !ownerName) {
    skippedNoOwner++;
    continue;
  }
  eligible++;
  const existing = get.get(row.addr_key);
  if (!existing) continue;
  matchedDb++;
  if (existing.owner_name && !overwrite) {
    skippedExisting++;
    continue;
  }
  const ownerMailing = row.owner_mailing || row.mailing_address || row.ownerMailing || null;
  const ownerSource = row.owner_source || row.source || "owner_enrichment";
  const at = new Date().toISOString();
  if (samples.length < 5) samples.push({ id: existing.id, addr_key: row.addr_key, owner_name: ownerName, owner_source: ownerSource });
  if (!dryRun) upd.run(at, ownerName, ownerMailing, ownerSource, at, row.addr_key);
  updated++;
}

db.close();
console.log(`APPLY OWNER: scanned=${scanned} eligible=${eligible} db_matches=${matchedDb} updated=${updated} skipped_no_owner=${skippedNoOwner} skipped_existing=${skippedExisting} contact_fields_seen_ignored=${contactFieldsSeen} dryRun=${dryRun}`);
console.log(`SAMPLE: ${JSON.stringify(samples, null, 2)}`);

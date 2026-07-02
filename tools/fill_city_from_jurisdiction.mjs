// fill_city_from_jurisdiction.mjs — fill properties.city from SOURCE JURISDICTION.
//
// Basis (citation law): these sources are CITY-government open-data portals, so
// every record is inside that city by definition (county-source-registry.jsonl):
//   cook-il-violations        -> data.cityofchicago.org   -> CHICAGO
//   nyc-ny-violations         -> data.cityofnewyork.us    -> NEW YORK
//   losangeles-ca-violations  -> data.lacity.org          -> LOS ANGELES
// COUNTY-scoped parcel sources are deliberately NOT here — a county has many
// cities, so filling them would be a guess, not a fact.
//
// Run: node tools/fill_city_from_jurisdiction.mjs [--dry-run]

import { DatabaseSync } from "node:sqlite";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const repo = join(dirname(fileURLToPath(import.meta.url)), "..");
const dryRun = process.argv.includes("--dry-run");

const JURISDICTION_CITY = {
  "cook-il-violations": "CHICAGO",
  "nyc-ny-violations": "NEW YORK",
  "losangeles-ca-violations": "LOS ANGELES",
};

const db = new DatabaseSync(join(repo, "crm.db"));
db.exec("PRAGMA busy_timeout = 15000");

let total = 0;
for (const [source, city] of Object.entries(JURISDICTION_CITY)) {
  const n = db.prepare("SELECT COUNT(*) c FROM properties WHERE source = ? AND (city IS NULL OR city = '' OR city = '1')").get(source).c;
  if (!dryRun && n > 0) {
    db.prepare("UPDATE properties SET city = ?, updated_at = ? WHERE source = ? AND (city IS NULL OR city = '' OR city = '1')")
      .run(city, new Date().toISOString(), source);
  }
  console.log(`${source} -> ${city}: ${n} filled${dryRun ? " [DRY]" : ""}`);
  total += n;
}
const remaining = db.prepare("SELECT COUNT(*) c FROM properties WHERE city IS NULL OR city = '' OR city = '1'").get().c;
console.log(`total filled: ${total}${dryRun ? " [DRY]" : ""} | city still missing: ${remaining} (county-scoped sources need geo/zip work)`);
db.close();

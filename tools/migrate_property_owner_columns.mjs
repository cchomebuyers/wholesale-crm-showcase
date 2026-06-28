// tools/migrate_property_owner_columns.mjs - adds owner metadata columns to properties.
import { join } from "node:path";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

const repo = join(dirname(fileURLToPath(import.meta.url)), "..");
const db = new DatabaseSync(join(repo, "crm.db"));

const cols = [
  "owner_name TEXT",
  "owner_mailing TEXT",
  "owner_source TEXT",
  "owner_enriched_at TEXT",
];

let added = 0;
for (const col of cols) {
  try {
    db.exec(`ALTER TABLE properties ADD COLUMN ${col}`);
    added++;
  } catch {}
}

db.close();
console.log(`OWNER COLUMN MIGRATION: added=${added} already_present=${cols.length - added}`);

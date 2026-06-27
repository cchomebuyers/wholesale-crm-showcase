import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REG = join(__dirname, "..", "data", "source-registry");
const SRC = join(REG, "county-source-registry.jsonl");
const RESULTS = join(REG, "owner-field-reprobe-results.jsonl");
const OUT = join(REG, "county-source-registry.owner-fixed.jsonl");

const results = readFileSync(RESULTS, "utf8").trim().split("\n").map(JSON.parse);
const sources = readFileSync(SRC, "utf8").trim().split("\n").map(JSON.parse);

const fixed = [];
for (const s of sources) {
  const r = results.find(x => x.source_id === s.source_id);
  if (r && r.matched_fields) {
    const fm = { ...s.fieldmap };
    if (r.matched_fields.parcel_id) fm.parcel_id = r.matched_fields.parcel_id;
    if (r.matched_fields.owner) fm.owner = r.matched_fields.owner;
    if (r.matched_fields.owner_mailing_address) fm.owner_mailing = r.matched_fields.owner_mailing_address;
    if (r.matched_fields.land_use) fm.land_use = r.matched_fields.land_use;
    if (r.matched_fields.property_class) fm.property_class = r.matched_fields.property_class;
    if (r.matched_fields.zoning) fm.zoning = r.matched_fields.zoning;
    s.fieldmap = fm;
    s.owner_reprobe_status = r.status;
    s.has_owner = !!r.matched_fields.owner;
    s.has_owner_mailing = !!r.matched_fields.owner_mailing_address;
    s.has_classification = !!(r.matched_fields.land_use || r.matched_fields.property_class || r.matched_fields.zoning);
  }
  fixed.push(s);
}
writeFileSync(OUT, fixed.map(JSON.stringify).join("\n") + "\n");
const hasOwner = fixed.filter(s => s.fieldmap && s.fieldmap.owner);
console.log("Owner-fixed JSONL:", fixed.length, "rows");
console.log("Now have owner field in:", hasOwner.length, "sources");
hasOwner.forEach(s => console.log("  ", s.source_id, "→ owner:", s.fieldmap.owner, "| landuse:", s.fieldmap.land_use || s.fieldmap.property_class || s.fieldmap.zoning || "NONE"));

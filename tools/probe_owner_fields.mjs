// tools/probe_owner_fields.mjs — Batch 5: reprobe all ArcGIS parcel sources for owner fields
// Run: node tools/probe_owner_fields.mjs
// Reads county-source-registry.jsonl, fetches ?f=pjson for each ArcGIS parcel endpoint,
// matches field names against owner/parcel/classification keywords, writes results.

import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = join(__dirname, "..");
const SRC = join(REPO, "data", "source-registry", "county-source-registry.jsonl");
const OUT = join(REPO, "data", "source-registry", "owner-field-reprobe-results.jsonl");
const BATCH5 = join(REPO, "connectors", "counties.add.batch5.owner-fields.json");

const OWNER_KEYS = /\b(OWNER|OWNER_NAME|OWNER1|OWNER_1|OWN_NAME|TAXPAYER|TAXPAYER_NAME|MAIL_NAME|MAILING_NAME|CARE_OF|C_O|ASSESSEE|PRIMARY_OWNER|GRANTEE|DEED_HOLDER|OWNER_FULL|OWN_NAME1|OWN_NAME2)\b/i;
const MAIL_KEYS = /\b(MAIL_ADDR|MAILING_ADDRESS|OWNER_ADDRESS|TAXPAYER_ADDRESS|MAIL_STREET|MAIL_CITY|MAIL_STATE|MAIL_ZIP|MAILING_CITY|MAILING_STATE|MAILING_ZIP|OWN_ADDR|MAILADDR|MAILING|OWNER_MAIL|MAILING_STREET|MAILING_CSZ|OWN_MAIL_STREET|OWN_MAIL_CITY|OWN_MAIL_STATE|OWN_MAIL_ZIP)\b/i;
const PARCEL_KEYS = /\b(APN|PARCEL|PARCEL_ID|PIN|AIN|FOLIO|TAX_ID|ACCOUNT|PROPERTY_ID|PARCEL_NO|TAXPIN|PARCELID|PARID|TAX_ID_NUMBER|PROP_ID|FOLIO_NUMBER)\b/i;
const SITUS_KEYS = /\b(SITUS|SITE_ADDRESS|SITUS_ADDRESS|PROPERTY_ADDRESS|PROP_ADDR|FULLADDR|FULL_ADDRESS|SITUS_ADDR|SITUS_FULL|PHYSICAL_ADDRESS|LOCATION_ADDRESS|STREET_ADDRESS)\b/i;
const CLASS_KEYS = /\b(LAND_USE|LANDUSE|USE_CODE|USECODE|LUCODE|LU_CODE|PROPERTY_CLASS|PROP_CLASS|CLASS|CLASS_CODE|ZONING|ZONE|ZONING_CODE|ZONE_CODE|ZONEDESC|ZONING_DISTRICT|CLASSIFICATION|PCLASS|STATE_CLASS|LAND_USE_CODE|PROPERTY_USE|USE_DESC|USE_DESCRIPTION|LU_DESC|CLASS_DESC)\b/i;
const VALUE_KEYS = /\b(ASSESSED_VALUE|TOTAL_VALUE|MARKET_VALUE|LAND_VALUE|IMPROVEMENT_VALUE|BUILDING_VALUE|BLDG_SQFT|BUILDING_SQFT|LAND_SQFT|ACRES|YEAR_BUILT|TOTAL_VAL|APPRAISED_VALUE|AV_TOTAL|FULL_VALUE|LAND_VAL|IMP_VALUE|BLDG_VAL|SQFT|SQ_FT|GROSS_AREA|LIVING_AREA|LAND_AREA|LOT_SIZE|ACREAGE|YR_BUILT)\b/i;
const LATLON_KEYS = /\b(LAT|LATITUDE|LON|LONGITUDE|Y|Y_COORD|X|X_COORD|GPS_Y|GPS_X)\b/i;

function matchFields(fields, regex) {
  return fields.filter(f => regex.test(f.name));
}

async function probeOne(source) {
  const metaUrl = source.endpoint.replace(/\/query$/, "?f=pjson");
  let meta, sample;
  
  // Fetch metadata
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 12000);
    const r = await fetch(metaUrl, { signal: ctl.signal });
    clearTimeout(t);
    if (!r.ok) return { source_id: source.source_id, status: "metadata_failed", notes: `HTTP ${r.status}` };
    meta = await r.json();
  } catch (e) {
    return { source_id: source.source_id, status: "metadata_failed", notes: String(e.message).slice(0, 100) };
  }
  
  if (!meta.fields || !Array.isArray(meta.fields) || meta.fields.length === 0) {
    return { source_id: source.source_id, status: "metadata_failed", notes: "No fields array in metadata" };
  }
  
  const fields = meta.fields;
  
  // Match fields against keyword groups
  const ownerFields = matchFields(fields, OWNER_KEYS);
  const mailFields = matchFields(fields, MAIL_KEYS);
  const parcelFields = matchFields(fields, PARCEL_KEYS);
  const situsFields = matchFields(fields, SITUS_KEYS);
  const classFields = matchFields(fields, CLASS_KEYS);
  const valueFields = matchFields(fields, VALUE_KEYS);
  const latlonFields = matchFields(fields, LATLON_KEYS);
  
  // Fetch sample
  let sampleOk = false;
  try {
    const sampleUrl = source.endpoint + "?where=1%3D1&outFields=*&resultRecordCount=1&f=json";
    const ctl2 = new AbortController();
    const t2 = setTimeout(() => ctl2.abort(), 12000);
    const r2 = await fetch(sampleUrl, { signal: ctl2.signal });
    clearTimeout(t2);
    if (r2.ok) {
      const j2 = await r2.json();
      sampleOk = !!(j2.features && j2.features.length > 0);
    }
  } catch (e) { /* sample failed, keep false */ }
  
  // Pick best match per category
  const pick = (farr) => {
    if (!farr.length) return null;
    // Prefer shorter names that look like primary fields
    const f = farr.find(x => /^(OWNER_NAME|OWNER|OWNER1|TAXPAYER)$/i.test(x.name));
    if (f) return f.name;
    return farr[0].name;
  };
  
  const matched = {
    parcel_id: pick(parcelFields),
    owner: pick(ownerFields),
    owner_mailing_address: pick(mailFields),
    address: pick(situsFields),
    land_use: pick(classFields.filter(f => /LAND.?USE|USE.?CODE|LUCODE/i.test(f.name))),
    property_class: pick(classFields.filter(f => /PROP.?CLASS|CLASS(?!_)/i.test(f.name) || /STATE_CLASS|PCLASS/i.test(f.name))),
    zoning: pick(classFields.filter(f => /ZONING|ZONE/i.test(f.name))),
    assessed_value: pick(valueFields.filter(f => /ASSESSED|TOTAL.?VAL|APPRAISED|MARKET|FULL/i.test(f.name))),
    building_sqft: pick(valueFields.filter(f => /BLDG|BUILDING|SQFT|SQUARE|GROSS|LIVING/i.test(f.name))),
    land_sqft: pick(valueFields.filter(f => /LAND.?AREA|LOT.?SIZE|LAND.?SQFT/i.test(f.name))),
    acres: pick(valueFields.filter(f => /ACRE/i.test(f.name))),
    year_built: pick(valueFields.filter(f => /YEAR|YR.?BUILT/i.test(f.name))),
    lat: pick(latlonFields.filter(f => /^(LAT|LATITUDE|Y)$/i.test(f.name))),
    lon: pick(latlonFields.filter(f => /^(LON|LONGITUDE|X)$/i.test(f.name))),
  };
  
  // Determine status
  let status = "fixed";
  if (!matched.owner && !matched.owner_mailing_address) status = "no_owner_fields_found";
  else if (!matched.owner && matched.owner_mailing_address) status = "partial_owner";
  else if (matched.owner && !matched.land_use && !matched.property_class && !matched.zoning) status = "partial_classification";
  if (!sampleOk) status = "sample_failed";
  
  return {
    source_id: source.source_id,
    county_fips: source.county_fips,
    state: source.state,
    county: source.county,
    endpoint: source.endpoint,
    metadata_ok: true,
    sample_ok: sampleOk,
    fields_scanned: fields.length,
    matched_fields: matched,
    status,
    confidence: (matched.owner && matched.parcel_id && sampleOk) ? "high" : "medium",
    notes: `${fields.length} fields scanned. Owner: ${matched.owner||'NONE'}. Parcel: ${matched.parcel_id||'NONE'}. LandUse: ${matched.land_use||matched.property_class||matched.zoning||'NONE'}. Sample: ${sampleOk?'OK':'FAILED'}.`
  };
}

async function main() {
  const sources = readFileSync(SRC, "utf8").trim().split("\n").map(JSON.parse);
  const arcgisParcels = sources.filter(s => s.dialect === "arcgis" && s.source_type === "parcels");
  console.log(`Probing ${arcgisParcels.length} ArcGIS parcel sources...`);
  
  const results = [];
  const batchSize = 5;
  for (let i = 0; i < arcgisParcels.length; i += batchSize) {
    const batch = arcgisParcels.slice(i, i + batchSize);
    const batchResults = await Promise.all(batch.map(probeOne));
    results.push(...batchResults);
    const done = Math.min(i + batchSize, arcgisParcels.length);
    process.stderr.write(`\r${done}/${arcgisParcels.length} probed`);
  }
  console.log("");
  
  // Write results
  writeFileSync(OUT, results.map(JSON.stringify).join("\n") + "\n");
  
  // Summary
  const fixed = results.filter(r => r.status === "fixed");
  const partialOwner = results.filter(r => r.status === "partial_owner");
  const partialClass = results.filter(r => r.status === "partial_classification");
  const noOwner = results.filter(r => r.status === "no_owner_fields_found");
  const metaFail = results.filter(r => r.status === "metadata_failed");
  const sampleFail = results.filter(r => r.status === "sample_failed");
  
  console.log(`\nRESULTS:`);
  console.log(`  fixed: ${fixed.length}`);
  console.log(`  partial_owner: ${partialOwner.length}`);
  console.log(`  partial_classification: ${partialClass.length}`);
  console.log(`  no_owner_fields_found: ${noOwner.length}`);
  console.log(`  metadata_failed: ${metaFail.length}`);
  console.log(`  sample_failed: ${sampleFail.length}`);
  
  // Build batch5 config for fixed+partial sources
  const good = results.filter(r => ["fixed", "partial_owner", "partial_classification"].includes(r.status));
  const configs = good.map(r => {
    const fm = {};
    if (r.matched_fields.parcel_id) fm.parcel_id = r.matched_fields.parcel_id;
    if (r.matched_fields.owner) fm.owner = r.matched_fields.owner;
    if (r.matched_fields.owner_mailing_address) fm.owner_mailing = r.matched_fields.owner_mailing_address;
    if (r.matched_fields.address) fm.address = r.matched_fields.address;
    else fm.address = null;
    if (r.matched_fields.land_use) fm.land_use = r.matched_fields.land_use;
    if (r.matched_fields.property_class) fm.land_use = fm.land_use || r.matched_fields.property_class;
    if (r.matched_fields.zoning) fm.zoning = r.matched_fields.zoning;
    if (r.matched_fields.lat) fm.lat = r.matched_fields.lat;
    if (r.matched_fields.lon) fm.lon = r.matched_fields.lon;
    if (r.matched_fields.building_sqft) fm.building_sqft = r.matched_fields.building_sqft;
    if (r.matched_fields.acres) fm.acres = r.matched_fields.acres;
    if (r.matched_fields.assessed_value) fm.assessed_value = r.matched_fields.assessed_value;
    
    return {
      id: r.source_id,
      region: `us-${r.state?.toLowerCase()}-${r.county?.toLowerCase().replace(/\s+/g,'').replace(/county$/,'')}`,
      name: r.county,
      state: r.state,
      type: "parcels",
      dialect: "arcgis",
      endpoint: r.endpoint,
      where: "1=1",
      max: 2000,
      fieldmap: fm,
      verified_at: "2026-06-26",
      note: `Batch 5 owner-field reprobe. ${r.notes}`
    };
  });
  
  writeFileSync(BATCH5, JSON.stringify(configs, null, 2));
  console.log(`\nConfigs written to connectors/counties.add.batch5.owner-fields.json: ${configs.length}`);
  console.log(`Results written to data/source-registry/owner-field-reprobe-results.jsonl`);
}

main().catch(e => { console.error(e); process.exit(1); });

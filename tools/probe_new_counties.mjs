// Quick probe of newly discovered county endpoints
import { writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = join(__dirname, "..");

const ENDPOINTS = [
  { id: "wayne-mi-parcels", fips: "26163", state: "MI", county: "Wayne County",
    url: "https://services1.arcgis.com/b6rkZNtCd6Mx2gvB/ArcGIS/rest/services/Wayne_County_Parcels/FeatureServer/0/query",
    meta: "https://services1.arcgis.com/b6rkZNtCd6Mx2gvB/ArcGIS/rest/services/Wayne_County_Parcels/FeatureServer/0?f=pjson" },
  { id: "duval-fl-parcels", fips: "12031", state: "FL", county: "Duval County",
    url: "https://maps.coj.net/arcgis/rest/services/Property/MapServer/0/query",
    meta: "https://maps.coj.net/arcgis/rest/services/Property/MapServer/0?f=pjson" },
  { id: "hamilton-oh-parcels", fips: "39061", state: "OH", county: "Hamilton County",
    url: "https://cagismaps.hamilton-co.org/cagisportal/rest/services/OPEN_DATA/MapServer/0/query",
    meta: "https://cagismaps.hamilton-co.org/cagisportal/rest/services/OPEN_DATA/MapServer/0?f=pjson" },
  { id: "denver-co-parcels", fips: "08031", state: "CO", county: "Denver County",
    url: "https://services.arcgis.com/aJ16ENn1zwU4Bd40/arcgis/rest/services/Parcels/FeatureServer/0/query",
    meta: "https://services.arcgis.com/aJ16ENn1zwU4Bd40/arcgis/rest/services/Parcels/FeatureServer/0?f=pjson" },
];

async function probe(e) {
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 10000);
    const r = await fetch(e.meta, { signal: ctl.signal });
    clearTimeout(t);
    if (!r.ok) return { ...e, status: "http_error", code: r.status };
    const j = await r.json();
    if (!j.fields) return { ...e, status: "no_fields" };
    
    const fields = j.fields.map(f => f.name);
    const addrCols = fields.filter(f => /addr|situs|street|city|zip|full/i.test(f.toLowerCase()));
    const ownerCols = fields.filter(f => /owner|taxpayer|mail/i.test(f.toLowerCase()));
    const parcelCol = fields.find(f => /apn|parcel|pin|folio/i.test(f.toLowerCase()));
    const classCols = fields.filter(f => /land.use|use.code|zoning|class|lu_code|lucode/i.test(f.toLowerCase()));
    
    // Sample query
    let sampleOk = false;
    try {
      const sq = e.url + "?where=1%3D1&outFields=*&resultRecordCount=1&f=json";
      const s = await fetch(sq, { signal: AbortSignal.timeout(10000) });
      if (s.ok) {
        const sj = await s.json();
        sampleOk = !!(sj.features && sj.features.length > 0);
      }
    } catch {}
    
    return {
      id: e.id, county_fips: e.fips, state: e.state, county: e.county,
      endpoint: e.url, meta_url: e.meta,
      field_count: fields.length,
      address_columns: addrCols.slice(0, 8),
      owner_columns: ownerCols.slice(0, 5),
      parcel_column: parcelCol || null,
      class_columns: classCols.slice(0, 5),
      sample_ok: sampleOk,
      status: "verified",
    };
  } catch (err) {
    return { ...e, status: "fetch_error", error: String(err.message).slice(0, 80) };
  }
}

const results = [];
for (const e of ENDPOINTS) {
  process.stderr.write(`Probing ${e.id}... `);
  const r = await probe(e);
  process.stderr.write(`${r.status}\n`);
  results.push(r);
}

const OUT = join(REPO, "data", "source-registry", "new-county-probes.jsonl");
writeFileSync(OUT, results.map(JSON.stringify).join("\n") + "\n");

const good = results.filter(r => r.status === "verified" && r.sample_ok);
const bad = results.filter(r => r.status !== "verified" || !r.sample_ok);

console.log(`\nVerified: ${good.length}`);
good.forEach(g => console.log(`  ${g.id}: ${g.field_count} fields, addr=${g.address_columns[0]||'NONE'}, parcel=${g.parcel_column||'NONE'}, owner=${g.owner_columns[0]||'NONE'}`));
console.log(`Failed: ${bad.length}`);
bad.forEach(b => console.log(`  ${b.id}: ${b.status} ${b.error||b.code||''}`));

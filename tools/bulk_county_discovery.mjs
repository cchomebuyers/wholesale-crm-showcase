// tools/bulk_county_discovery.mjs — probe ArcGIS/Socrata patterns for top N counties
// Tries known URL patterns per county, verifies which return real address data.
// Writes verified entries to connectors/counties.add.batch9.bulk.json
import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = join(__dirname, "..");

// Domain guess patterns for county ArcGIS servers
function guessUrls(county, state, fips) {
  const slug = county.toLowerCase().replace(/[^a-z0-9]/g, "");
  const st = state.toLowerCase();
  const countyname = county.replace(/ County$/, "").replace(/ Parish$/, "").replace(/ Borough$/, "").trim().toLowerCase().replace(/\s+/g, "");
  
  const patterns = [];
  
  // ArcGIS Online hosted FeatureServer patterns (most common for county parcels)
  // We can't guess the orgId — these we find by web search only
  // BUT we can try known domain-based servers:
  
  // Common county GIS server patterns
  const domains = [
    `gis.${slug}.gov`,
    `gis.${slug}.us`,
    `${slug}.gov`,
    `gis.${countyname}.gov`,
    `maps.${countyname}county.gov`,
    `maps.${slug}.org`,
    `gis.${st}.gov`,
    `data.${slug}.gov`,
    `${countyname}county.gov`,
  ];
  
  for (const domain of domains) {
    patterns.push({
      url: `https://${domain}/arcgis/rest/services/Parcels/MapServer/0/query`,
      meta: `https://${domain}/arcgis/rest/services/Parcels/MapServer/0?f=pjson`,
      pattern: `domain_${domain.replace(/[^a-z0-9]/g,'_')}`,
    });
  }
  
  // State-specific known patterns
  if (st === "fl") {
    patterns.push({
      url: `https://maps.${countyname}countyfl.gov/arcgis/rest/services/`,
      meta: null,
      pattern: "fl_known",
    });
  }
  if (st === "tx") {
    patterns.push({
      url: `https://gis.${countyname}cad.org/arcgis/rest/services/`,
      meta: null,
      pattern: "tx_cad",
    });
  }
  
  // Socrata patterns
  const socrataDomains = [
    `data.${countyname}county.gov`,
    `data.${slug}.gov`,
    `data.${countyname}.gov`,
    `${countyname}county.data.socrata.com`,
    `${slug}.data.socrata.com`,
  ];
  
  for (const d of socrataDomains) {
    patterns.push({
      url: `https://${d}/`,
      meta: null,
      pattern: `socrata_${d.replace(/[^a-z0-9]/g,'_')}`,
    });
  }
  
  return patterns;
}

async function probeArcGIS(metaUrl, queryUrl, timeout = 8) {
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), timeout * 1000);
    const r = await fetch(metaUrl, { signal: ctl.signal });
    clearTimeout(t);
    if (!r.ok) return null;
    const j = await r.json();
    if (!j.fields || !j.fields.length) return null;
    
    const fields = j.fields.map(f => f.name);
    const hasAddr = fields.some(f => /address|situs|addr|street|full/i.test(f));
    if (!hasAddr) return null;
    
    // Sample query
    let sampleOk = false;
    try {
      const sq = queryUrl + "?where=1%3D1&outFields=*&resultRecordCount=1&f=json";
      const s = await fetch(sq, { signal: AbortSignal.timeout(timeout * 1000) });
      if (s.ok) {
        const sj = await s.json();
        sampleOk = !!(sj.features && sj.features.length > 0);
      }
    } catch {}
    
    return { fields, field_count: fields.length, sample_ok: sampleOk };
  } catch {
    return null;
  }
}

async function main() {
  const csv = readFileSync(join(REPO, "data", "source-registry", "us-counties-ranked.csv"), "utf8")
    .trim().split("\n").slice(1).map(l => {
      const [fips, sfips, state, county, pop, rank] = l.split(",");
      return { fips, state, county, pop: Number(pop), rank: Number(rank) };
    });
  
  // Get already-covered FIPS
  const existing = JSON.parse(readFileSync(join(REPO, "data", "source-registry", "county-source-registry.jsonl"), "utf8")
    .trim().split("\n").map(JSON.parse).map(s => s.county_fips));
  const rejected = JSON.parse(readFileSync(join(REPO, "data", "source-registry", "rejected-sources.jsonl"), "utf8")
    .trim().split("\n").map(JSON.parse).map(r => r.county_fips));
  const covered = new Set([...existing, ...rejected]);
  
  const uncovered = csv.filter(c => !covered.has(c.fips));
  console.log(`Uncovered counties: ${uncovered.length} of ${csv.length}`);
  console.log(`Probing top ${Math.min(50, uncovered.length)} uncovered by population...`);
  
  const results = [];
  const batch = uncovered.slice(0, 50);
  
  for (const c of batch) {
    const patterns = guessUrls(c.county, c.state, c.fips);
    let found = false;
    
    for (const p of patterns) {
      if (found) break;
      if (!p.meta) continue; // skip non-ArcGIS patterns for now
      
      process.stderr.write(`\r${c.rank}: ${c.county} (${c.state}) — trying ${p.pattern}...`);
      const result = await probeArcGIS(p.meta, p.url, 8);
      
      if (result && result.sample_ok) {
        found = true;
        const entry = {
          county_fips: c.fips, state: c.state, county: c.county, population_rank: c.rank,
          source_id: `${c.state.toLowerCase()}-${c.county.toLowerCase().replace(/[^a-z]/g,'')}-parcels`,
          source_type: "parcels", dialect: "arcgis",
          endpoint: p.url, layer: 0, where: "1=1", max: 2000, enabled: true,
          confidence: "high", legal_status: "public_official_api",
          fieldmap: { address: null, city: null, zip: null, owner: null },
          has_parcel_id: false, has_owner: false, has_classification: false,
          validation: { last_verified: "2026-06-26", method: "arcgis_pjson_and_limit_1_query", sample_record_returned: true },
          notes: `Bulk discovery batch 9 — ${p.pattern}. ${result.field_count} fields.`
        };
        results.push(entry);
        process.stderr.write(" FOUND\n");
      }
    }
    if (!found) process.stderr.write(" none\n");
  }
  
  console.log(`\n\nFound: ${results.length} of ${batch.length}`);
  
  if (results.length) {
    // Write batch config
    const configs = results.map(r => ({
      id: r.source_id, region: `us-${r.state.toLowerCase()}-${r.county.toLowerCase().replace(/[^a-z]/g,'')}`,
      name: r.county, state: r.state,
      type: "parcels", dialect: "arcgis", endpoint: r.endpoint,
      where: "1=1", max: 2000,
      fieldmap: { address: null, city: null, zip: null, owner: null, lat: null, lon: null },
      verified_at: "2026-06-26",
      note: r.notes,
    }));
    writeFileSync(join(REPO, "connectors", "counties.add.batch9.bulk.json"), JSON.stringify(configs, null, 2));
    
    // Append to JSONL
    let jl = readFileSync(join(REPO, "data", "source-registry", "county-source-registry.jsonl"), "utf8");
    for (const r of results) jl += JSON.stringify(r) + "\n";
    writeFileSync(join(REPO, "data", "source-registry", "county-source-registry.jsonl"), jl);
    
    // Write results log
    writeFileSync(join(REPO, "data", "source-registry", "bulk-discovery-results.jsonl"), 
      results.map(JSON.stringify).join("\n") + "\n");
  }
  
  console.log(`Files written. Total registry: ${existing.length + results.length} sources.`);
  console.log(`Remaining uncovered: ${uncovered.length - results.length}`);
}

main().catch(e => { console.error(e); process.exit(1); });

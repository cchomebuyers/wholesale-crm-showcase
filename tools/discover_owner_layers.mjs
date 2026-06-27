// tools/discover_owner_layers.mjs — Batch 6: walk MapServer roots to find tax roll layers
import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = join(__dirname, "..");
const RESULTS_IN = join(REPO, "data", "source-registry", "owner-field-reprobe-results.jsonl");
const OUT = join(REPO, "data", "source-registry", "layer-discovery-results.jsonl");
const BATCH6 = join(REPO, "connectors", "counties.add.batch6.taxroll-layers.json");

const OWNER_RE = /\b(OWNER|OWNER_NAME|OWNER1|TAXPAYER|ASSESSEE|GRANTEE|DEED_HOLDER|OWN_NAME|PRIMARY_OWNER)\b/i;
const MAIL_RE = /\b(MAIL|MAILING|OWNER_ADDR|TAXPAYER_ADDR)\b/i;
const VALUE_RE = /\b(ASSESSED|TOTAL_VALUE|MARKET_VALUE|APPRAISED|LAND_VALUE|IMPROVEMENT|TAXABLE)\b/i;

async function fetchJson(url, timeout = 10) {
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), timeout * 1000);
    const r = await fetch(url, { signal: ctl.signal });
    clearTimeout(t);
    if (!r.ok) return null;
    return await r.json();
  } catch { return null; }
}

async function probeService(source) {
  const endpoint = source.endpoint;
  // Determine if MapServer or FeatureServer, and strip to root
  const isMapServer = endpoint.includes("/MapServer/");
  const parts = endpoint.replace(/\/query$/, "").split("/");
  const layerIdx = parts.findIndex(p => p === "MapServer" || p === "FeatureServer");
  if (layerIdx < 0) return { source_id: source.source_id, status: "parse_failed" };
  
  const serviceRoot = parts.slice(0, layerIdx + 1).join("/");
  const serviceType = parts[layerIdx]; // "MapServer" or "FeatureServer"
  
  // Fetch service root
  const svc = await fetchJson(serviceRoot + "?f=pjson");
  if (!svc) return { source_id: source.source_id, service_root: serviceRoot, status: "service_fetch_failed" };
  
  const layers = svc.layers || [];
  if (!layers.length) {
    // FeatureServer — only one layer. Check if ANY layer in the parent folder has owner data.
    return { source_id: source.source_id, service_root: serviceRoot, layer_count: 0, status: "no_layers" };
  }
  
  // Probe each layer for owner/value fields
  const results = [];
  for (const layer of layers) {
    const layerUrl = serviceRoot + "/" + layer.id;
    const meta = await fetchJson(layerUrl + "?f=pjson");
    if (!meta || !meta.fields) continue;
    
    const fields = meta.fields;
    const hasOwner = fields.some(f => OWNER_RE.test(f.name));
    const hasMail = fields.some(f => MAIL_RE.test(f.name));
    const hasValue = fields.some(f => VALUE_RE.test(f.name));
    
    results.push({
      layer_id: layer.id,
      layer_name: layer.name,
      field_count: fields.length,
      has_owner: hasOwner,
      has_mailing: hasMail,
      has_value: hasValue,
      owner_fields: hasOwner ? fields.filter(f => OWNER_RE.test(f.name)).map(f => f.name) : [],
      sample_query_ok: null,
    });
    
    if (hasOwner) {
      // Do a tiny sample query to confirm data
      try {
        const q = layerUrl + "/query?where=1%3D1&outFields=*&resultRecordCount=1&f=json";
        const sample = await fetchJson(q);
        results[results.length-1].sample_query_ok = !!(sample && sample.features && sample.features.length > 0);
      } catch { results[results.length-1].sample_query_ok = false; }
    }
  }
  
  const bestOwner = results.find(r => r.has_owner && r.sample_query_ok);
  const anyOwner = results.find(r => r.has_owner);
  
  return {
    source_id: source.source_id,
    service_root: serviceRoot,
    service_type: serviceType,
    layer_count: layers.length,
    layers: results,
    best_owner_layer: bestOwner ? { id: bestOwner.layer_id, name: bestOwner.layer_name, owner_fields: bestOwner.owner_fields } : null,
    any_owner_layer: anyOwner ? { id: anyOwner.layer_id, name: anyOwner.layer_name } : null,
    status: bestOwner ? "owner_layer_found" : (anyOwner ? "owner_layer_sample_failed" : "no_owner_in_any_layer"),
  };
}

async function main() {
  const results = readFileSync(RESULTS_IN, "utf8").trim().split("\n").map(JSON.parse);
  const noOwner = results.filter(r => r.status === "no_owner_fields_found");
  console.log(`Probing ${noOwner.length} services for owner layers...`);
  
  const out = [];
  for (let i = 0; i < noOwner.length; i++) {
    process.stderr.write(`\r${i+1}/${noOwner.length} ${noOwner[i].source_id}`);
    const r = await probeService(noOwner[i]);
    out.push(r);
  }
  console.log("");
  
  writeFileSync(OUT, out.map(JSON.stringify).join("\n") + "\n");
  
  const found = out.filter(r => r.status === "owner_layer_found");
  const anyOwner = out.filter(r => r.status === "owner_layer_sample_failed");
  const none = out.filter(r => r.status === "no_owner_in_any_layer");
  const fail = out.filter(r => r.status.includes("failed"));
  
  console.log(`\nowner_layer_found: ${found.length}`);
  console.log(`owner_layer_sample_failed: ${anyOwner.length}`);
  console.log(`no_owner_in_any_layer: ${none.length}`);
  console.log(`service_failed: ${fail.length}`);
  
  // Build batch6 configs for found owner layers
  const configs = [];
  for (const r of out) {
    if (!r.best_owner_layer) continue;
    // Find the source id to get its county info
    const src = results.find(s => s.source_id === r.source_id);
    if (!src) continue;
    
    const endpoint = r.service_root + "/" + r.best_owner_layer.id + "/query";
    configs.push({
      id: src.source_id.replace("-parcels", "-taxroll"),
      region: `us-${(src.state||"").toLowerCase()}-${(src.county||"").toLowerCase().replace(/\s+/g,"").replace(/county$/,"")}`,
      name: src.county,
      state: src.state,
      type: "parcels",
      dialect: "arcgis",
      endpoint,
      where: "1=1",
      max: 2000,
      fieldmap: {
        owner: r.best_owner_layer.owner_fields[0] || null,
        address: null,
        city: null,
        zip: null,
      },
      verified_at: "2026-06-26",
      note: `Batch 6 layer discovery. Owner data found in layer ${r.best_owner_layer.id} ("${r.best_owner_layer.name}") of ${r.layer_count} total layers.`
    });
  }
  
  writeFileSync(BATCH6, JSON.stringify(configs, null, 2));
  console.log(`\nBatch6 configs written: ${configs.length}`);
}

main().catch(e => { console.error(e); process.exit(1); });

// connectors/index.js — the connector registry.
// One interface for every source: search(target) → [normalizedLead]. The three archetypes
// (REST+key, ArcGIS, RESO/OData) cover ~all of rulesreg/_scraping/sources-to-use.md.
// Dependencies (rentcastGet/pullBlightTickets/detroitComps/getSetting) are injected by server.js so
// the actual fetch logic stays in one place. See dev/plans/6-26-26/02-CONNECTORS.md.

import { readFileSync, existsSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { rentcastConnector } from "./rentcast.js";
import { resoConnector } from "./reso.js";
import { detroitBlightConnector, detroitCompsConnector } from "./detroit.js";
import { censusConnector } from "./census.js";
import { buildCountyConnectors } from "./county.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Load verified county configs from counties.data.json + any counties.add.*.json (one per agent,
// so parallel background agents never write the same file). Returns a flat verified-config array.
export function loadCountyConfigs() {
  const out = [];
  try {
    const main = join(__dirname, "counties.data.json");
    if (existsSync(main)) out.push(...(JSON.parse(readFileSync(main, "utf8")).verified || []));
    for (const f of readdirSync(__dirname)) {
      if (/^counties\.add\..*\.json$/.test(f)) {
        try { const a = JSON.parse(readFileSync(join(__dirname, f), "utf8")); out.push(...(Array.isArray(a) ? a : a.verified || [])); } catch {}
      }
    }
  } catch (e) { console.error("county config load:", e.message); }
  // de-dupe by id (a later agent file wins)
  const byId = {}; for (const c of out) if (c && c.id && c.endpoint) byId[c.id] = c;
  return Object.values(byId);
}

export function buildRegistry(deps) {
  const list = [
    rentcastConnector(deps),       // listings (on-market) — the current default
    resoConnector(deps),           // listings (on-market) — scaffolded, gated on a RESO token
    detroitBlightConnector(deps),  // violations (off-market) — free ArcGIS
    detroitCompsConnector(deps),   // comps (ARV) — free ArcGIS recorded sales
    censusConnector(),             // geocode — free, no key (dedup + lat/lng)
    ...buildCountyConnectors(loadCountyConfigs()), // every verified free county endpoint
  ];
  const registry = {};
  for (const c of list) registry[c.id] = c;
  return registry;
}

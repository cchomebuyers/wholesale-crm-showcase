// connectors/index.js — the connector registry.
// One interface for every source: search(target) → [normalizedLead]. The three archetypes
// (REST+key, ArcGIS, RESO/OData) cover ~all of rulesreg/_scraping/sources-to-use.md.
// Dependencies (rentcastGet/pullBlightTickets/detroitComps/getSetting) are injected by server.js so
// the actual fetch logic stays in one place. See dev/plans/6-26-26/02-CONNECTORS.md.

import { rentcastConnector } from "./rentcast.js";
import { resoConnector } from "./reso.js";
import { detroitBlightConnector, detroitCompsConnector } from "./detroit.js";
import { censusConnector } from "./census.js";

export function buildRegistry(deps) {
  const list = [
    rentcastConnector(deps),       // listings (on-market) — the current default
    resoConnector(deps),           // listings (on-market) — scaffolded, gated on a RESO token
    detroitBlightConnector(deps),  // violations (off-market) — free ArcGIS
    detroitCompsConnector(deps),   // comps (ARV) — free ArcGIS recorded sales
    censusConnector(),             // geocode — free, no key (dedup + lat/lng)
  ];
  const registry = {};
  for (const c of list) registry[c.id] = c;
  return registry;
}

// packs/lead_harvest.js — lead-harvest workflow, built ON our system (route_engine + connector registry).
//
// This is a CHAIN: each step's output is the next step's input (the route engine threads vars).
//   harvest_contacts(source) → harvested
//   dedupe_leads(harvested)  → deduped     (influenced by step 1)
//   compliance_gate(deduped) → gated       (influenced by step 2)
//
// Swap the sourceId / add capabilities → new workflow, same kernel. Connectors that expose a bulk
// harvest() are paginated; others fall back to search().

import { createRouteEngine } from "../route_engine.js";

export function buildHarvestEngine({ registry = {} } = {}) {
  const e = createRouteEngine();

  // STEP 1 — pull raw leads-with-phone from a registered connector (calls the API we already built).
  e.registerCapability({
    id: "harvest_contacts",
    cost: { money: 0, latency_ms: 1000 },
    policy: { legal_status: "public_official_api", risk: 0 },
    run: async (_ctx, { sourceId, count = 1000, pageSize = 1000 } = {}) => {
      const conn = registry[sourceId];
      if (!conn) throw new Error(`no source "${sourceId}"`);
      const canHarvest = typeof conn.harvest === "function";
      const leads = [];
      let offset = 0, pages = 0;
      while (leads.length < count && pages < 200) {
        const rows = canHarvest ? await conn.harvest({ limit: pageSize, offset }) : await conn.search({});
        pages++; offset += pageSize;
        if (!rows || !rows.length) break;
        for (const r of rows) { if (r && r.phone) leads.push(r); if (leads.length >= count) break; }
        if (!canHarvest) break; // search() isn't paginated — one shot
      }
      return { source: sourceId, raw_count: leads.length, leads };
    },
  });

  // STEP 2 — dedupe (output depends entirely on step 1's output).
  e.registerCapability({
    id: "dedupe_leads",
    cost: { money: 0, latency_ms: 1 }, policy: { legal_status: "n/a", risk: 0 },
    run: async (_ctx, harvested) => {
      const seen = new Set(); const leads = [];
      for (const r of (harvested && harvested.leads) || []) {
        const key = r.license_id || `${r.business_name || r.name}|${r.address}`;
        if (seen.has(key)) continue; seen.add(key);
        leads.push({ owner: r.business_name || r.name || null, name: r.business_name || r.name || null,
          phone: r.phone, address: r.address, city: r.city, state: r.state, zip: r.zip, source: r.source_id });
      }
      return { ...harvested, count: leads.length, leads };
    },
  });

  // STEP 3 — compliance gate (output depends on step 2's output). Never auto-callable.
  e.registerCapability({
    id: "compliance_gate",
    cost: { money: 0, latency_ms: 1 }, policy: { legal_status: "policy", risk: 0 },
    run: async (_ctx, deduped) => {
      const leads = ((deduped && deduped.leads) || []).map((l) => ({
        ...l, outreach_allowed: false, compliance_status: "unchecked",
        compliance_note: "DNC/consent not verified — check before any call/SMS.",
      }));
      return { ...deduped, leads, gated: true };
    },
  });

  // the chain.
  e.registerRoute({
    id: "harvest_leads", goal: "harvest_contacts", domain: "lead_harvest", output: "gated",
    confidence: 0.9, value: 0.9,
    steps: [
      { capability: "harvest_contacts", input: "target", output: "harvested", required: true },
      { capability: "dedupe_leads", input: "harvested", output: "deduped" },
      { capability: "compliance_gate", input: "deduped", output: "gated" },
    ],
  });

  return e;
}

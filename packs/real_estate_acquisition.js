// packs/real_estate_acquisition.js — domain pack #1 for the route engine.
//
// Proves the pack pattern: the kernel (route_engine.js) has zero domain logic; a PACK registers
// capabilities (wrapping real connectors) + route templates. Swap the pack → different product.
// This one wires the real-estate owner-contact pipeline end-to-end:
//   target.address → geocode → find_contact (free sources first) → compliance gate → result
//
// Capabilities are injected (geocode/registry) so this is testable without network.

import { createRouteEngine } from "../route_engine.js";
import { findContact } from "../contact_router.js";
import { geocodeAddress } from "../connectors/census.js";

export function buildRealEstateEngine({ registry = {}, batchdataKey = false, geocode = geocodeAddress } = {}) {
  const e = createRouteEngine();

  // geocode_address — free US Census geocoder; returns standardized address + lat/lon for the map.
  e.registerCapability({
    id: "geocode_address",
    cost: { money: 0, latency_ms: 300 },
    policy: { legal_status: "public_official_api", risk: 0 },
    run: async (_ctx, address) => {
      const g = await geocode(address);
      return g && g.matched
        ? { address: g.standardized, lat: g.lat, lon: g.lon, matched: true }
        : { address: address || null, matched: false };
    },
  });

  // find_contact — the multi-route contact finder (free public-contact sources first, then escalate).
  e.registerCapability({
    id: "find_contact",
    cost: { money: 0, latency_ms: 500 },
    policy: { legal_status: "public_official_api", risk: 1 },
    run: async (_ctx, subject) => findContact(registry, subject || {}, { batchdataKey }),
  });

  // compliance_gate — every candidate stays non-callable until DNC/consent is checked (TCPA/CASL).
  e.registerCapability({
    id: "compliance_gate",
    cost: { money: 0, latency_ms: 1 },
    policy: { legal_status: "policy", risk: 0 },
    run: async (_ctx, contactResult) => {
      const r = contactResult || { candidates: [] };
      const candidates = (r.candidates || []).map((c) => ({
        ...c, outreach_allowed: false, compliance_status: "unchecked",
        compliance_note: "DNC/consent not verified — check before any call/SMS.",
      }));
      return { ...r, candidates, gated: true };
    },
  });

  // route: address → geocode → contact → gate. (real estate is just THIS config.)
  e.registerRoute({
    id: "address_to_contact", goal: "find_contact", domain: "real_estate",
    confidence: 0.8, value: 0.9, output: "gated",
    steps: [
      { capability: "geocode_address", input: "target.address", output: "geo" },
      { capability: "find_contact", input: "target", output: "contacts" },
      { capability: "compliance_gate", input: "contacts", output: "gated" },
    ],
  });

  return e;
}

// buyer_discovery.js -- future-facing buyer demand pipeline.
//
// A wholesale deal is only real if someone can buy it above the seller price.
// Existing CRM buyers are one source. Future sources should add buyer candidates:
// recent cash purchasers, repeat landlords, permit-active flippers, LLC owners,
// rental-license holders, agents with matching inventory, and public B2B contacts.

import { rankBuyersForProperty } from "./buyer_matching.js";

export const BUYER_DISCOVERY_SOURCE_FAMILIES = [
  {
    id: "recorded-cash-buyers",
    source_type: "buyer-discovery",
    inputs: ["county", "zip", "property_type", "price_band"],
    outputs: ["name", "mailing_address", "purchase_count", "max_price_estimate"],
    legal_status: "public_official_api",
    confidence: "high",
  },
  {
    id: "repeat-landlords",
    source_type: "buyer-discovery",
    inputs: ["rental_registry", "parcel_owner_repeats", "eviction_landlord_records"],
    outputs: ["name", "areas", "property_types", "portfolio_count"],
    legal_status: "public_official_api",
    confidence: "medium",
  },
  {
    id: "permit-active-flippers",
    source_type: "buyer-discovery",
    inputs: ["building_permits", "contractor_permits", "rehab_clusters"],
    outputs: ["name", "phone", "email", "areas", "property_types"],
    legal_status: "public_official_api",
    confidence: "medium",
  },
  {
    id: "business-license-investors",
    source_type: "buyer-discovery",
    inputs: ["business_license", "public_contact_phone", "registered_agent"],
    outputs: ["name", "phone", "email", "areas"],
    legal_status: "public_official_api",
    confidence: "medium",
  },
  {
    id: "agent-inventory-buyers",
    source_type: "buyer-discovery",
    inputs: ["active_listing_agent", "sold_listing_agent", "brokerage_inventory"],
    outputs: ["name", "phone", "email", "areas", "property_types"],
    legal_status: "licensed_or_public",
    confidence: "low",
  },
];

const clean = (v) => String(v || "").trim();
const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
};

export function normalizeBuyerCandidate(input = {}) {
  const name = clean(input.name || input.buyer_name || input.business_name || input.owner_name);
  if (!name) return null;
  const evidence = input.evidence || {};
  return {
    name,
    phone: clean(input.phone) || null,
    email: clean(input.email) || null,
    areas: clean(input.areas || input.zip || input.city || input.county),
    property_types: clean(input.property_types || input.property_type),
    max_price: num(input.max_price || input.max_price_estimate || input.buyer_max_price),
    cash: input.cash === false || input.cash === 0 ? 0 : 1,
    source_id: clean(input.source_id || input.source || "unknown-buyer-source"),
    source_type: clean(input.source_type || "buyer-discovery"),
    confidence: clean(input.confidence || "low"),
    evidence: {
      ...evidence,
      discovery_family: input.discovery_family || input.source_id || input.source || null,
      reason: input.reason || evidence.reason || null,
      purchase_count: num(input.purchase_count),
      portfolio_count: num(input.portfolio_count),
    },
  };
}

export function buyerDiscoveryGaps(property = {}, { existingMatches = [], discoveredMatches = [] } = {}) {
  const gaps = [];
  if (!existingMatches.some((m) => m.score >= 70)) gaps.push("no strong buyer in CRM buyer table");
  if (!discoveredMatches.some((m) => m.score >= 70)) gaps.push("no strong discovered buyer candidate yet");
  if (!property.city && !property.zip && !property.county) gaps.push("property missing market fields for buyer discovery");
  if (!property.property_type) gaps.push("property type unknown for buyer buy-box matching");
  return gaps;
}

export function rankBuyerDemand({ property = {}, crmBuyers = [], discoveredCandidates = [], limit = 10 } = {}) {
  const existing = rankBuyersForProperty(crmBuyers, property, { limit })
    .map((m) => ({ ...m, demand_source: "crm_buyer" }));
  const discovered = rankBuyersForProperty(discoveredCandidates, property, { limit })
    .map((m) => ({ ...m, demand_source: "discovered_candidate" }));
  return {
    existing,
    discovered,
    all: [...existing, ...discovered].sort((a, b) => b.score - a.score).slice(0, limit),
    discovery_paths: BUYER_DISCOVERY_SOURCE_FAMILIES,
    gaps: buyerDiscoveryGaps(property, { existingMatches: existing, discoveredMatches: discovered }),
  };
}

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

// A recorded "buyer" from county sales is only a real cash-buyer candidate if it is an
// actual purchaser — not a title/escrow vehicle, land-trust holder, lender, or public agency.
const NOT_A_BUYER_RX = /\b(LAND TRUST|TRUST COMPANY|TITLE|ESCROW|AUTHORITY|CITY OF|COUNTY OF|STATE OF|AGENCY|HABITAT|FANNIE MAE|FREDDIE MAC|\bHUD\b|DEPARTMENT|SECRETARY OF|REDEVELOPMENT|HOUSING AUTH|\bBANK\b|BANCORP|TRUSTEE|NATIONAL ASSOCIATION|\bN\.?A\.?\b$|MORTGAGE|\bFHLMC\b|\bFNMA\b|\bGNMA\b|CREDIT UNION)\b/i;
export function isRealBuyer(name) {
  const s = clean(name);
  return s.length > 2 && !NOT_A_BUYER_RX.test(s);
}
// Confidence from purchase volume: more recorded buys = more reliably an active cash buyer.
export function buyerConfidence(purchases) {
  const n = Number(purchases) || 0;
  return n >= 20 ? "high" : n >= 10 ? "medium" : "low";
}

// Quality gate for BULK promotion into the active buyers list (audit P5:
// "Promote qualified buyer candidates into active buyers"). Pure — the
// endpoint loops candidates through this and skips anything that fails.
export function qualifiesForPromotion(candidate = {}, opts = {}) {
  const minConfidence = opts.minConfidence || "high"; // high | medium | low
  const order = { low: 0, medium: 1, high: 2 };
  if (!isRealBuyer(candidate.name)) return { ok: false, reason: "not a real buyer (trust/title/agency)" };
  if (candidate.imported_buyer_id) return { ok: false, reason: "already promoted" };
  if (opts.requireCash !== false && !candidate.cash) return { ok: false, reason: "not a cash buyer" };
  if ((order[String(candidate.confidence || "low")] ?? 0) < (order[minConfidence] ?? 2)) {
    return { ok: false, reason: `confidence ${candidate.confidence || "low"} < ${minConfidence}` };
  }
  if (!String(candidate.areas || "").trim()) return { ok: false, reason: "no buy-box area" };
  return { ok: true, reason: "qualified" };
}

const tok = (v) => String(v || "").toLowerCase().split(/[,;|/]+/).map((s) => s.trim()).filter(Boolean);

// Market demand = active cash investors whose stated buy-box AREA covers this property.
// Contact-independent on purpose: a thriving investor market IS demand; reaching a specific
// buyer is a separate skip-trace step (same as the seller side). Price is only applied as a
// filter when the property's value is actually known.
export function buyerMarketDemand(property = {}, buyers = []) {
  const propAreas = [property.county, property.city, property.state]
    .map((v) => String(v || "").toLowerCase().trim()).filter(Boolean);
  const val = Number(property.mao || property.arv || property.price || property.asking_price) || 0;
  let demand_count = 0;
  let top = null;
  for (const b of buyers) {
    const areas = tok(b.areas);
    const areaHit = !areas.length || areas.some((a) => propAreas.some((h) => h.includes(a) || a.includes(h)));
    if (!areaHit) continue;
    const max = Number(b.max_price) || 0;
    if (val > 0 && max > 0 && val > max * 1.15) continue; // property too pricey for this buyer
    demand_count++;
    if (!top || max > (Number(top.max_price) || 0)) top = b;
  }
  return {
    demand_count,
    has_demand: demand_count > 0,
    top_buyer: top ? { name: top.name, max_price: top.max_price ?? null, source_id: top.source_id || null } : null,
  };
}

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

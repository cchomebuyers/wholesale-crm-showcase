// buyer_matching.js -- rank cash buyers against a property.
//
// This starts with the CRM's existing buyer table, then leaves a clean place for
// future discovered buyers: nearby landlords, recent cash purchasers, permit-
// active flippers, LLC owners, and agents with matching inventory.

const norm = (v) => String(v || "").toLowerCase().trim();
const tokens = (v) => norm(v).split(/[,;|/]+/).map((s) => s.trim()).filter(Boolean);

function areaScore(buyer, property) {
  const areas = tokens(buyer.areas);
  if (!areas.length) return { score: 10, reason: "no area restriction" };
  const hay = [property.zip, property.city, property.state, property.county].map(norm).filter(Boolean);
  for (const a of areas) {
    if (hay.includes(a) || hay.some((h) => h.includes(a) || a.includes(h))) {
      return { score: 35, reason: `matches area "${a}"` };
    }
  }
  return { score: -25, reason: "outside stated area" };
}

function typeScore(buyer, property) {
  const types = tokens(buyer.property_types);
  if (!types.length) return { score: 8, reason: "no type restriction" };
  const pt = norm(property.property_type);
  if (!pt) return { score: 0, reason: "property type unknown" };
  for (const t of types) {
    if (pt.includes(t) || t.includes(pt)) return { score: 20, reason: `matches type "${t}"` };
    if (/single|sfr/.test(t) && /single|sfr/.test(pt)) return { score: 20, reason: "single-family match" };
    if (/multi|duplex|triplex|quad/.test(t) && /multi|duplex|triplex|quad/.test(pt)) return { score: 20, reason: "small multi-family match" };
  }
  return { score: -10, reason: "type mismatch" };
}

function priceScore(buyer, property) {
  const max = Number(buyer.max_price);
  const ask = Number(property.mao || property.price || property.asking_price);
  if (!Number.isFinite(max) || max <= 0) return { score: 8, reason: "no max price set" };
  if (!Number.isFinite(ask) || ask <= 0) return { score: 0, reason: "property price unknown" };
  if (ask <= max) return { score: 22, reason: `price within buy box (${Math.round(ask)} <= ${Math.round(max)})` };
  const over = (ask - max) / max;
  if (over <= 0.15) return { score: 5, reason: "slightly above max price" };
  return { score: -20, reason: "above max price" };
}

function contactScore(buyer) {
  const phone = Boolean(String(buyer.phone || "").trim());
  const email = Boolean(String(buyer.email || "").trim());
  if (phone && email) return { score: 15, reason: "phone and email available" };
  if (phone || email) return { score: 8, reason: "one contact channel available" };
  return { score: -30, reason: "no contact info" };
}

export function scoreBuyerForProperty(buyer = {}, property = {}) {
  const parts = [areaScore(buyer, property), typeScore(buyer, property), priceScore(buyer, property), contactScore(buyer)];
  if (Number(buyer.cash) === 1 || buyer.cash === true) parts.push({ score: 10, reason: "cash buyer" });
  const raw = parts.reduce((s, p) => s + p.score, 0);
  const score = Math.max(0, Math.min(100, Math.round(raw)));
  return {
    buyer_id: buyer.id,
    name: buyer.name,
    phone: buyer.phone || null,
    email: buyer.email || null,
    max_price: buyer.max_price ?? null,
    score,
    fit: score >= 70 ? "strong" : score >= 45 ? "possible" : "weak",
    reasons: parts.map((p) => p.reason),
  };
}

export function rankBuyersForProperty(buyers = [], property = {}, { limit = 20 } = {}) {
  return buyers
    .map((b) => scoreBuyerForProperty(b, property))
    .sort((a, b) => b.score - a.score || String(a.name || "").localeCompare(String(b.name || "")))
    .slice(0, limit);
}

export const BUYER_DISCOVERY_PATHS = [
  "county_recorded_sales_cash_buyers",
  "recent_llc_grantees_nearby",
  "landlord_rental_registry",
  "building_permit_applicants",
  "fix_and_flip_permit_clusters",
  "nearby_multifamily_owners",
  "eviction_filing_landlords",
  "section8_landlord_lists",
  "tax_mailing_repeat_owners",
  "agent_inventory_match",
];

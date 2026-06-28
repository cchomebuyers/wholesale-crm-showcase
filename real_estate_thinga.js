// real_estate_thinga.js -- real-estate domain Thingas.
//
// Ankhor says every entity is the same recursive type. This file makes the CRM's
// real-estate records obey that rule without forcing every connector to know the
// whole schema. A connector can keep returning its local shape; this builder
// wraps it as kind:"realEstate" with direct facts separated from inferred facts.

import { createHash } from "node:crypto";
import { canonical } from "./thinga.js";
import { canonicalAddr } from "./connectors/census.js";

export const REAL_ESTATE_SCHEMA = "ankhor.v1.realEstate";

export const RECORD_TYPES = [
  "listing",
  "property_signal",
  "public_contact",
  "comps",
  "geocode",
  "skiptrace",
  "workflow",
  "architecture",
];

export const CONTACT_RELATIONS = [
  "owner",
  "agent",
  "tenant",
  "operator",
  "registered_agent",
  "responsible_party",
  "unknown",
];

export function realEstateId(seed) {
  const hash = createHash("sha256").update(canonical(seed)).digest("hex").slice(0, 32);
  return `thinga:realestate-${hash}`;
}

export function canonicalAddress(input = {}) {
  const address = input.formatted_address || input.address || input.facility_address || input.location_address || null;
  if (!address) return null;
  return canonicalAddr(address);
}

export function inferOwnerType(name) {
  const n = String(name || "").toLowerCase();
  if (!n) return "unknown";
  if (/\b(llc|inc|corp|co\.?|company|holdings|properties|trustee|lp|llp|ltd)\b/.test(n)) return "business";
  if (/\btrust\b/.test(n)) return "trust";
  if (/\b(city of|county of|state of|united states|housing authority)\b/.test(n)) return "government";
  return "individual";
}

export function inferSaleStatus(input = {}) {
  const status = String(input.status || input.property_status || "").toLowerCase();
  const sourceType = String(input.source_type || input.type || "").toLowerCase();
  const recordType = input.record_type || null;
  if (recordType === "comps" || sourceType === "comps" || /\b(sold|closed)\b/.test(status)) return "sold";
  if (recordType === "listing" || /\b(active|for sale|coming soon|back on market)\b/.test(status)) return "active";
  return "unknown";
}

export function inferContactRelation(input = {}) {
  if (input.listing_agent_phone || input.listing_agent_email || input.listing_agent_name) return "agent";
  if (input.facility_name || input.source_type === "public_industrial_facility") return "operator";
  if (input.business_name || input.dba_name) return "operator";
  if (input.registered_agent) return "registered_agent";
  if (input.seller_name || input.owner_name) return "owner";
  return "unknown";
}

export function directFacts(input = {}) {
  return {
    source_id: input.source_id || input.source || null,
    source_type: input.source_type || input.type || null,
    legal_status: input.legal_status || null,
    record_type: input.record_type || input.kind || input.type || "property_signal",

    address: input.formatted_address || input.address || input.facility_address || input.location_address || null,
    addr_key: input.addr_key || canonicalAddress(input),
    parcel_id: input.parcel_id || input.apn || input.assessor_parcel_number || null,
    city: input.city || null,
    state: input.state || null,
    zip: input.zip || input.postal_code || null,
    county: input.county || null,
    latitude: input.latitude ?? input.lat ?? null,
    longitude: input.longitude ?? input.lon ?? null,

    property_status: input.status || input.property_status || null,
    price: input.price ?? input.sale_price ?? null,
    listed_date: input.listed_date || null,
    sale_date: input.sale_date || null,
    days_on_market: input.days_on_market ?? null,

    owner_name: input.owner_name || input.seller_name || null,
    owner_mailing_address: input.owner_mailing_address || input.owner_mailing || null,
    contact_name: input.contact_name || input.listing_agent_name || input.business_name || input.facility_name || input.name || null,
    phone: input.phone || input.seller_phone || input.listing_agent_phone || null,
    email: input.email || input.seller_email || input.listing_agent_email || null,

    distress: input.distress || input.motivation || input.ordinance || null,
    confidence: input.confidence || null,
  };
}

export function inferredFacts(input = {}) {
  const direct = directFacts(input);
  const notes = [];
  const sale_status = inferSaleStatus(input);
  const contact_relation = inferContactRelation(input);
  const owner_type = inferOwnerType(direct.owner_name);

  if (direct.phone && contact_relation !== "owner") {
    notes.push("phone is contactable evidence, not proof of owner phone");
  }
  if (direct.distress) {
    notes.push("distress signal suggests motivation but does not prove willingness to sell");
  }
  if (input.price_history) {
    notes.push("price_history must be parsed before treating it as a price-drop signal");
  }
  if (direct.owner_mailing_address && direct.address &&
      canonicalAddress({ address: direct.owner_mailing_address }) !== canonicalAddress({ address: direct.address })) {
    notes.push("owner mailing differs from situs address; absentee ownership is likely");
  }
  if (sale_status === "sold") {
    notes.push("sold records are comps/ARV fuel, not live leads");
  }

  return {
    sale_status,
    owner_type,
    contact_relation,
    contactability: direct.phone || direct.email ? "has_contact" : "needs_enrichment",
    inference_notes: notes,
  };
}

export function toRealEstateThinga(input = {}, overrides = {}) {
  const direct = directFacts(input);
  const inferred = inferredFacts(input);
  const recordType = direct.record_type || "property_signal";
  const idSeed = {
    schema: REAL_ESTATE_SCHEMA,
    record_type: recordType,
    source_id: direct.source_id,
    address: direct.addr_key,
    parcel_id: direct.parcel_id,
    source_row_id: input.id || input.source_row_id || null,
  };

  return {
    id: overrides.id || realEstateId(idSeed),
    kind: "realEstate",
    name: overrides.name || direct.address || direct.contact_name || recordType,
    version: overrides.version || 0,
    content: {
      record_type: recordType,
      direct,
      inferred,
      economics: {
        arv: input.arv ?? null,
        mao: input.mao ?? null,
        repair_estimate: input.repair_estimate ?? null,
        rent_estimate: input.rent_estimate ?? null,
        spread: input.spread ?? null,
      },
      raw: overrides.includeRaw ? input : undefined,
    },
    tags: [
      "realEstate",
      recordType,
      inferred.sale_status,
      inferred.contactability,
      ...(overrides.tags || []),
    ].filter(Boolean),
    schema: REAL_ESTATE_SCHEMA,
    color: overrides.color || null,
    icon: overrides.icon || "home",
    category_path: overrides.category_path || `RealEstate/${recordType}/${inferred.sale_status}`,
    children: overrides.children || [],
    parents: overrides.parents || [],
    links: overrides.links || [],
    subworld: overrides.subworld || null,
    due_date: overrides.due_date || null,
    due_time: overrides.due_time || null,
    recurrence: overrides.recurrence || null,
    ttl_seconds: overrides.ttl_seconds || 0,
    code: overrides.code || null,
    interaction_script: overrides.interaction_script || null,
    physics_profile: overrides.physics_profile || null,
    permissions: overrides.permissions || "private",
    owner: overrides.owner || null,
    origin: overrides.origin || "real_estate_thinga.js",
  };
}

export function makeRealEstateArchitectureThinga() {
  return toRealEstateThinga({
    record_type: "architecture",
    source_id: "crm-real-estate-operating-model",
    address: "Real estate lead acquisition system",
    confidence: "high",
  }, {
    id: "thinga:realestate-architecture-v1",
    name: "Real Estate Lead Acquisition Architecture",
    category_path: "RealEstate/Architecture",
    tags: ["architecture", "workflow", "lead_acquisition", "contact_resolution"],
    children: [
      "thinga:realestate-current-crm-state-2026-06-28",
      "thinga:realestate-property-workflows-100",
      "thinga:realestate-identity-workflows-50",
      "thinga:realestate-cost-model",
      "thinga:realestate-searcher-struct",
    ],
  });
}

// real_estate_facets.js -- faceted parser family for kind:"realEstate".
//
// This is the CRM-specific version of ankhor88/FACETED_THINGA_ARCHITECTURE.md:
// one Thinga, many facets, explicit parser registration, partial success when a
// source is weak, and strict validation when the pipeline needs a hard gate.

import { createFacetRegistry, makeThinga, parseThinga } from "./faceted_thinga.js";
import {
  canonicalAddress,
  inferContactRelation,
  inferOwnerType,
  inferSaleStatus,
} from "./real_estate_thinga.js";

export const REAL_ESTATE_FACET_CONFIG = {
  kind: "realEstate",
  version: "realEstate.facets.v1",
  required: ["source", "property", "inference"],
  optional: [
    "listing",
    "owner",
    "contact",
    "distress",
    "valuation",
    "imagery",
    "buyerDemand",
    "workflow",
    "compliance",
    "audit",
    "raw",
  ],
  relationKinds: [
    "same_property_as",
    "derived_from",
    "owned_by",
    "contacted_via",
    "comp_for",
    "routed_to",
    "requires",
    "supersedes",
  ],
};

const ok = (data, warnings = []) => ({ success: true, data, warnings });
const bad = (error) => ({ success: false, error });
const nil = (v) => v === undefined || v === null || v === "";
const str = (v) => (nil(v) ? null : String(v).trim());
const num = (v) => {
  if (nil(v)) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const arr = (v) => Array.isArray(v) ? v.filter((x) => !nil(x)) : [];

function phone(v) {
  if (nil(v)) return null;
  let p = String(v).replace(/[^0-9]/g, "");
  if (p.length === 11 && p.startsWith("1")) p = p.slice(1);
  return p.length === 10 && !/^(\d)\1{9}$/.test(p) ? p : null;
}

function enumOr(v, allowed, fallback) {
  const s = str(v);
  return allowed.includes(s) ? s : fallback;
}

export const realEstateFacetParsers = [
  {
    id: "source",
    name: "Source Provenance",
    required: true,
    validate(data = {}) {
      const source_id = str(data.source_id || data.source);
      if (!source_id) return bad("source.source_id required");
      return ok({
        source_id,
        source_type: str(data.source_type || data.type) || "unknown",
        connector_id: str(data.connector_id || source_id),
        legal_status: str(data.legal_status) || "unknown",
        raw_status: str(data.raw_status || data.status),
        fetched_at: str(data.fetched_at),
        source_row_id: str(data.source_row_id || data.id),
      });
    },
  },
  {
    id: "property",
    name: "Property Identity",
    required: true,
    validate(data = {}) {
      const address = str(data.address || data.formatted_address || data.facility_address || data.location_address);
      const parcel_id = str(data.parcel_id || data.apn || data.assessor_parcel_number);
      if (!address && !parcel_id) return bad("property.address or property.parcel_id required");
      return ok({
        address,
        addr_key: str(data.addr_key) || canonicalAddress({ address }),
        parcel_id,
        city: str(data.city),
        state: str(data.state),
        zip: str(data.zip || data.postal_code),
        county: str(data.county),
        latitude: num(data.latitude ?? data.lat),
        longitude: num(data.longitude ?? data.lon),
        property_type: str(data.property_type),
        bedrooms: num(data.bedrooms),
        bathrooms: num(data.bathrooms),
        square_footage: num(data.square_footage),
        lot_size: num(data.lot_size),
        year_built: num(data.year_built),
      });
    },
  },
  {
    id: "listing",
    name: "For-Sale Listing",
    validate(data = {}) {
      const status = str(data.status || data.property_status);
      const sale_status = enumOr(data.sale_status || inferSaleStatus(data), ["active", "sold", "unknown"], "unknown");
      const warnings = [];
      if (sale_status === "active" && !status) warnings.push("active sale_status inferred without source status");
      return ok({
        sale_status,
        status,
        price: num(data.price),
        listed_date: str(data.listed_date),
        removed_date: str(data.removed_date),
        days_on_market: num(data.days_on_market),
        price_history: data.price_history ?? null,
        listing_agent_name: str(data.listing_agent_name),
        listing_agent_phone: phone(data.listing_agent_phone),
        listing_agent_email: str(data.listing_agent_email),
      }, warnings);
    },
  },
  {
    id: "owner",
    name: "Owner Identity",
    validate(data = {}) {
      const owner_name = str(data.owner_name || data.seller_name);
      const owner_type = enumOr(data.owner_type || inferOwnerType(owner_name), ["individual", "business", "trust", "government", "unknown"], "unknown");
      return ok({
        owner_name,
        owner_type,
        owner_mailing_address: str(data.owner_mailing_address || data.owner_mailing),
        owner_source: str(data.owner_source),
        absentee_likely: Boolean(data.absentee_likely),
      });
    },
  },
  {
    id: "contact",
    name: "Contact Evidence",
    validate(data = {}) {
      const normalizedPhone = phone(data.phone || data.seller_phone || data.listing_agent_phone);
      const email = str(data.email || data.seller_email || data.listing_agent_email);
      const relation = enumOr(data.contact_relation || inferContactRelation(data), [
        "owner",
        "agent",
        "tenant",
        "operator",
        "registered_agent",
        "responsible_party",
        "unknown",
      ], "unknown");
      const warnings = [];
      if (normalizedPhone && relation !== "owner") warnings.push("phone is not proven owner phone");
      return ok({
        contact_name: str(data.contact_name || data.listing_agent_name || data.business_name || data.facility_name || data.name),
        contact_relation: relation,
        phone: normalizedPhone,
        email,
        candidates: Array.isArray(data.candidates) ? data.candidates : [],
        dnc_status: str(data.dnc_status),
        phone_source: str(data.phone_source || data.source_id || data.source),
        contactability: normalizedPhone || email ? "has_contact" : "needs_enrichment",
      }, warnings);
    },
  },
  {
    id: "distress",
    name: "Distress Signal",
    validate(data = {}) {
      return ok({
        signals: arr(data.signals).concat(arr(data.distress_signals)),
        primary: str(data.primary || data.distress || data.motivation || data.ordinance),
        ordinance: str(data.ordinance),
        severity: enumOr(data.severity, ["low", "medium", "high", "unknown"], "unknown"),
        issued_at: str(data.issued_at || data.ticket_issued_date),
        balance_due: num(data.balance_due || data.amt_balance_due),
      });
    },
  },
  {
    id: "valuation",
    name: "Valuation / Deal Math",
    validate(data = {}) {
      return ok({
        arv: num(data.arv),
        mao: num(data.mao),
        price: num(data.price ?? data.sale_price),
        assessed_value: num(data.assessed_value),
        last_sale_price: num(data.last_sale_price),
        repair_estimate: num(data.repair_estimate),
        rent_estimate: num(data.rent_estimate),
        spread: num(data.spread),
        assignment_fee: num(data.assignment_fee),
        acquisition_offer_price: num(data.acquisition_offer_price),
        target_acquisition_price: num(data.target_acquisition_price),
        buyer_assignment_price: num(data.buyer_assignment_price || data.assignment_price),
        seller_acceptable_price: num(data.seller_acceptable_price),
        seller_min_price: num(data.seller_min_price),
        contract_price: num(data.contract_price),
        offer_amount: num(data.offer_amount),
        buyer_offer_price: num(data.buyer_offer_price),
        buyer_max_price: num(data.buyer_max_price),
        cap_rate: num(data.cap_rate),
        comps_count: num(data.comps_count || data.count),
        comps: Array.isArray(data.comps) ? data.comps : [],
      });
    },
  },
  {
    id: "imagery",
    name: "Property Imagery Evidence",
    validate(data = {}) {
      return ok({
        provider: str(data.provider || "google_maps"),
        street_view_available: data.street_view_available === true || data.street_view?.available === true,
        street_view_url: str(data.street_view_url || data.street_view?.image_url),
        satellite_url: str(data.satellite_url || data.satellite?.image_url),
        parcel_overlay_url: str(data.parcel_overlay_url || data.parcel_overlay?.image_url),
        parcel_overlay_status: str(data.parcel_overlay_status || data.parcel_overlay?.status),
        captured_at: str(data.captured_at || data.generated_at),
        notes: arr(data.notes),
      });
    },
  },
  {
    id: "buyerDemand",
    name: "Motivated Buyer Demand",
    validate(data = {}) {
      const matches = Array.isArray(data.matches) ? data.matches : [];
      const best = matches.length ? matches[0] : null;
      return ok({
        matches,
        best_buyer_id: best?.buyer_id ?? data.best_buyer_id ?? null,
        best_score: num(best?.score ?? data.best_score),
        strong_count: matches.filter((m) => Number(m.score) >= 70).length,
        discovery_paths: arr(data.discovery_paths),
        next_step: str(data.next_step),
      });
    },
  },
  {
    id: "workflow",
    name: "Acquisition Workflow",
    validate(data = {}) {
      return ok({
        stage: str(data.stage) || "research",
        next_step: str(data.next_step),
        route: str(data.route),
        priority: enumOr(data.priority, ["low", "normal", "high", "urgent"], "normal"),
        assigned_to: str(data.assigned_to),
        due_date: str(data.due_date),
        tasks: Array.isArray(data.tasks) ? data.tasks : [],
      });
    },
  },
  {
    id: "compliance",
    name: "Compliance Gate",
    validate(data = {}) {
      return ok({
        allowed_to_call: data.allowed_to_call === true,
        allowed_to_text: data.allowed_to_text === true,
        allowed_to_email: data.allowed_to_email === true,
        disclosure_required: data.disclosure_required !== false,
        legal_basis: str(data.legal_basis || data.legal_status),
        notes: arr(data.notes),
      });
    },
  },
  {
    id: "inference",
    name: "Derived Evidence",
    required: true,
    validate(data = {}) {
      const confidence = enumOr(data.confidence, ["high", "medium", "low", "unknown"], "unknown");
      return ok({
        sale_status: enumOr(data.sale_status, ["active", "sold", "unknown"], "unknown"),
        owner_type: enumOr(data.owner_type, ["individual", "business", "trust", "government", "unknown"], "unknown"),
        contact_relation: enumOr(data.contact_relation, [
          "owner",
          "agent",
          "tenant",
          "operator",
          "registered_agent",
          "responsible_party",
          "unknown",
        ], "unknown"),
        contactability: enumOr(data.contactability, ["has_contact", "needs_enrichment", "unknown"], "unknown"),
        confidence,
        notes: arr(data.notes || data.inference_notes),
      });
    },
  },
  {
    id: "audit",
    name: "Run Audit",
    validate(data = {}) {
      return ok({
        run_id: str(data.run_id),
        ok: data.ok !== false,
        latency_ms: num(data.latency_ms),
        error_kind: str(data.error_kind),
        error: str(data.error),
        sampled: data.sampled === true,
      });
    },
  },
  {
    id: "raw",
    name: "Raw Payload",
    validate(data = {}) {
      return ok(data);
    },
  },
];

export function createRealEstateFacetRegistry() {
  return createFacetRegistry().initialize(realEstateFacetParsers);
}

export function realEstateFacetsFromRecord(input = {}, options = {}) {
  const sale_status = inferSaleStatus(input);
  const owner_name = input.owner_name || input.seller_name || null;
  const owner_type = inferOwnerType(owner_name);
  const contact_relation = inferContactRelation(input);
  const contactValue = input.phone || input.seller_phone || input.listing_agent_phone || input.email || input.seller_email || input.listing_agent_email;
  const notes = [];

  if (contactValue && contact_relation !== "owner") notes.push("contact exists but relation is not owner");
  if (input.ordinance || input.distress || input.motivation) notes.push("distress is signal, not proof of seller intent");
  if (sale_status === "sold") notes.push("sold record routes to comps, not leads");

  const facets = {
    source: input,
    property: input,
    inference: {
      sale_status,
      owner_type,
      contact_relation,
      contactability: contactValue ? "has_contact" : "needs_enrichment",
      confidence: input.confidence || "unknown",
      notes,
    },
  };

  if (sale_status !== "unknown" || input.price || input.listed_date || input.listing_agent_name) facets.listing = input;
  if (owner_name || input.owner_mailing || input.owner_mailing_address) facets.owner = input;
  if (contactValue || input.business_name || input.facility_name || input.contact_name) facets.contact = input;
  if (input.ordinance || input.distress || input.motivation || input.distress_signals) facets.distress = input;
  if (input.arv || input.mao || input.repair_estimate || input.rent_estimate || input.comps || input.sale_price ||
      input.assignment_fee || input.acquisition_offer_price || input.target_acquisition_price ||
      input.buyer_assignment_price || input.assignment_price || input.seller_acceptable_price ||
      input.seller_min_price || input.contract_price || input.offer_amount || input.buyer_offer_price ||
      input.buyer_max_price) facets.valuation = input;
  if (input.stage || input.next_step || input.route) facets.workflow = input;
  if (input.legal_status || input.dnc_status || input.allowed_to_call !== undefined) facets.compliance = input;
  if (input.run_id || input.latency_ms || input.error_kind) facets.audit = input;
  if (options.includeRaw) facets.raw = input;

  return facets;
}

export function makeRealEstateFacetedThinga(input = {}, options = {}) {
  const facets = realEstateFacetsFromRecord(input, options);
  const address = input.formatted_address || input.address || input.facility_address || input.location_address;
  const recordType = input.record_type || input.kind || input.type || "property_signal";
  const t = makeThinga({
    kind: "realEstate",
    type: recordType,
    name: options.name || address || input.business_name || input.facility_name || recordType,
    content: {
      record_type: recordType,
      category_path: `RealEstate/${recordType}/${facets.inference.sale_status}`,
      config_version: REAL_ESTATE_FACET_CONFIG.version,
    },
    facets,
    parents: options.parents || [],
    children: options.children || [],
  });
  t.$header.schema = REAL_ESTATE_FACET_CONFIG.version;
  t.$header.category_path = t.content.category_path;
  return t;
}

function compactObject(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj || {})) {
    if (v !== undefined && v !== null && v !== "") out[k] = v;
  }
  return out;
}

function mergeArrays(a, b) {
  return [...new Set([...(Array.isArray(a) ? a : []), ...(Array.isArray(b) ? b : [])])];
}

function mergeFacet(a = {}, b = {}) {
  const out = { ...compactObject(a), ...compactObject(b) };
  if (Array.isArray(a.notes) || Array.isArray(b.notes)) out.notes = mergeArrays(a.notes, b.notes);
  if (Array.isArray(a.signals) || Array.isArray(b.signals)) out.signals = mergeArrays(a.signals, b.signals);
  if (Array.isArray(a.comps) || Array.isArray(b.comps)) out.comps = mergeArrays(a.comps, b.comps);
  return out;
}

function contactRank(c = {}) {
  const relationScore = {
    owner: 100,
    registered_agent: 85,
    responsible_party: 75,
    operator: 65,
    tenant: 50,
    agent: 45,
    unknown: 0,
  };
  return (relationScore[c.contact_relation] ?? 0) + (c.phone ? 10 : 0) + (c.email ? 5 : 0);
}

function mergeContactFacet(a = {}, b = {}) {
  const candidates = [a, b, ...(Array.isArray(a.candidates) ? a.candidates : []), ...(Array.isArray(b.candidates) ? b.candidates : [])]
    .filter((c) => c && (c.phone || c.email || c.contact_name));
  const best = [...candidates].sort((x, y) => contactRank(y) - contactRank(x))[0] || {};
  return {
    ...mergeFacet(a, b),
    ...compactObject(best),
    candidates: candidates.map((c) => compactObject({
      contact_name: c.contact_name,
      contact_relation: c.contact_relation,
      phone: c.phone,
      email: c.email,
      phone_source: c.phone_source,
    })),
  };
}

export function realEstateIdentityKeys(thingaOrRecord = {}) {
  const facets = thingaOrRecord.facets || realEstateFacetsFromRecord(thingaOrRecord);
  const property = facets.property || {};
  const source = facets.source || {};
  const keys = [];

  const parcel = property.parcel_id || thingaOrRecord.parcel_id || thingaOrRecord.apn;
  if (parcel && property.state) keys.push(`parcel:${String(property.state).toUpperCase()}:${String(parcel).toUpperCase()}`);

  const addr = property.addr_key || canonicalAddress(property);
  if (addr) {
    const city = property.city ? String(property.city).toUpperCase() : "";
    const state = property.state ? String(property.state).toUpperCase() : "";
    const zip = property.zip ? String(property.zip).slice(0, 5) : "";
    keys.push(`address:${addr}|${city}|${state}|${zip}`);
  }

  if (source.source_id && source.source_row_id) {
    keys.push(`source:${source.source_id}:${source.source_row_id}`);
  }

  const lat = property.latitude == null ? null : Number(property.latitude).toFixed(5);
  const lon = property.longitude == null ? null : Number(property.longitude).toFixed(5);
  if (lat && lon) keys.push(`geo:${lat},${lon}`);

  return [...new Set(keys.filter(Boolean))];
}

export function sameRealEstateProperty(a, b) {
  const ak = realEstateIdentityKeys(a);
  const bk = new Set(realEstateIdentityKeys(b));
  const matches = ak.filter((k) => bk.has(k));
  return {
    same: matches.some((k) => k.startsWith("parcel:") || k.startsWith("address:") || k.startsWith("geo:")),
    matches,
  };
}

export function mergeRealEstateThingas(a, b, options = {}) {
  const same = sameRealEstateProperty(a, b);
  if (!same.same && options.requireSame !== false) {
    throw new Error("Cannot merge realEstate Thingas without a shared parcel/address/geo identity key");
  }

  const af = a.facets || {};
  const bf = b.facets || {};
  const facets = {};
  for (const key of new Set([...Object.keys(af), ...Object.keys(bf)])) {
    facets[key] = key === "contact" ? mergeContactFacet(af[key], bf[key]) : mergeFacet(af[key], bf[key]);
  }

  facets.audit = mergeFacet(facets.audit, {
    merged_from: mergeArrays(facets.audit && facets.audit.merged_from, [a.$header?.id || a.id, b.$header?.id || b.id]),
    merge_keys: same.matches,
  });

  const children = mergeArrays(a.$header?.children, b.$header?.children)
    .concat([a.$header?.id || a.id, b.$header?.id || b.id])
    .filter(Boolean);

  const merged = makeThinga({
    kind: "realEstate",
    type: options.type || a.$header?.type || b.$header?.type || "property",
    name: options.name || facets.property?.address || a.$header?.name || b.$header?.name || "Merged realEstate property",
    content: {
      record_type: options.type || "merged_property",
      category_path: options.category_path || "RealEstate/merged_property",
      config_version: REAL_ESTATE_FACET_CONFIG.version,
      identity_keys: realEstateIdentityKeys({ facets }),
    },
    facets,
    parents: mergeArrays(a.$header?.parents, b.$header?.parents),
    children,
  });
  merged.$header.schema = REAL_ESTATE_FACET_CONFIG.version;
  merged.$header.merge_keys = same.matches;
  return merged;
}

export function parseRealEstateThinga(thinga, options = {}) {
  const registry = options.registry || createRealEstateFacetRegistry();
  return parseThinga(thinga, registry, { mode: options.mode || "lenient" });
}

export function makeRealEstateSystemThinga() {
  return makeThinga({
    kind: "realEstate",
    type: "system",
    name: "Wholesale CRM Real Estate Acquisition System",
    content: {
      purpose: "Find property signals, resolve identity/contact, score deal quality, route compliant outreach.",
      config_version: REAL_ESTATE_FACET_CONFIG.version,
    },
    facets: {
      source: {
        source_id: "wholesale-crm-local-architecture",
        source_type: "architecture",
        legal_status: "internal",
      },
      property: {
        address: "system://real-estate-acquisition",
      },
      workflow: {
        stage: "architecture",
        route: "source -> property -> owner -> contact -> valuation -> compliance -> outreach",
        priority: "high",
      },
      inference: {
        sale_status: "unknown",
        owner_type: "unknown",
        contact_relation: "unknown",
        contactability: "unknown",
        confidence: "high",
        notes: [
          "All future property/search/contact records should enter as kind realEstate with facets.",
          "Direct facts stay in source/property/listing/owner/contact facets.",
          "Read-between-lines logic stays in inference facet.",
        ],
      },
    },
    children: [
      "facet:source",
      "facet:property",
      "facet:listing",
      "facet:owner",
      "facet:contact",
      "facet:distress",
      "facet:valuation",
      "facet:workflow",
      "facet:compliance",
      "facet:inference",
      "facet:audit",
      "facet:raw",
    ],
  });
}

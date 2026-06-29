// packs/real_estate_identity_graph.js -- field-expansion pack for real-estate Thingas.
//
// This is the bridge from bespoke property rows to the North Star substrate:
// nodes expose fields, fields propose candidate edges, evidence validates later.
// It does not assert a match is true; it creates scored, provenance-bearing
// candidate edges that a route planner/compliance gate can accept, reject, or defer.

import { createRouteEngine } from "../route_engine.js";
import { canonicalAddress, directFacts } from "../real_estate_thinga.js";

const clean = (v) => {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s ? s : null;
};

const digits = (v) => {
  const s = clean(v);
  if (!s) return null;
  const d = s.replace(/\D/g, "");
  return d.length >= 10 ? d.slice(-10) : null;
};

const normName = (v) => clean(v)?.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim() || null;

const ownerKind = (name) => {
  const n = String(name || "").toLowerCase();
  if (/\b(llc|inc|corp|co|company|holdings|properties|lp|llp|ltd)\b/.test(n)) return "business";
  if (/\btrust\b/.test(n)) return "trust";
  return "person";
};

function inputFacts(input = {}) {
  if (input.content?.direct) return input.content.direct;
  if (input.kind === "realEstate" && input.content) return input.content.direct || {};
  return directFacts(input);
}

function sourceId(facts = {}) {
  return clean(facts.source_id) || clean(facts.source_type) || "unknown_source";
}

function field(name, value, normalizedValue, extra = {}) {
  if (!clean(value)) return null;
  return {
    name,
    value,
    normalized_value: normalizedValue ?? clean(value),
    possible_node_types: extra.possible_node_types || [],
    possible_sources: extra.possible_sources || [],
    confidence_rules: extra.confidence_rules || [],
    permission_rules: extra.permission_rules || [],
  };
}

export function extractJoinableFields(input = {}) {
  const facts = inputFacts(input);
  const addressKey = facts.addr_key || canonicalAddress({ address: facts.address });
  return [
    field("address", facts.address, addressKey, {
      possible_node_types: ["address", "parcel", "property", "business", "permit", "license"],
      possible_sources: ["county_assessor", "business_license", "permits"],
      confidence_rules: ["canonical address match", "parcel/address cross-check", "bidirectional source agreement"],
      permission_rules: ["official/public source only", "no outreach from address alone"],
    }),
    field("parcel_id", facts.parcel_id, clean(facts.parcel_id)?.toUpperCase(), {
      possible_node_types: ["parcel", "property", "tax_roll", "deed"],
      possible_sources: ["county_assessor", "county_recorder_deed"],
      confidence_rules: ["exact APN/parcel match", "same county/state"],
      permission_rules: ["official public-record source"],
    }),
    field("owner_name", facts.owner_name, normName(facts.owner_name), {
      possible_node_types: [ownerKind(facts.owner_name), "property_owner", "officer", "registered_agent"],
      possible_sources: ["county_assessor", "county_recorder_deed", "secretary_of_state"],
      confidence_rules: ["owner appears on deed/tax roll", "name plus mailing address", "name plus parcel"],
      permission_rules: ["identity candidate only", "contact route must pass compliance gate"],
    }),
    field("owner_mailing_address", facts.owner_mailing_address, canonicalAddress({ address: facts.owner_mailing_address }), {
      possible_node_types: ["address", "mailing_record", "owner", "business"],
      possible_sources: ["county_assessor", "tax_bill"],
      confidence_rules: ["mailing address paired with same owner on official roll"],
      permission_rules: ["mail channel only until consent/DNC checks for phone/SMS"],
    }),
    field("contact_name", facts.contact_name, normName(facts.contact_name), {
      possible_node_types: ["person", "business", "operator", "agent"],
      possible_sources: ["business_license", "permits", "listing"],
      confidence_rules: ["source declares role", "matched to address or parcel"],
      permission_rules: ["role may not be owner; mark relation honestly"],
    }),
    field("phone", facts.phone, digits(facts.phone), {
      possible_node_types: ["phone", "contact_candidate"],
      possible_sources: ["business_license", "permits", "paid_skiptrace", "first_party"],
      confidence_rules: ["source provenance", "reverse match to owner/entity"],
      permission_rules: ["DNC/TCPA/CASL gate required", "outreach_allowed false until checked"],
    }),
    field("email", facts.email, clean(facts.email)?.toLowerCase(), {
      possible_node_types: ["email", "contact_candidate", "domain"],
      possible_sources: ["business_license", "permits", "first_party"],
      confidence_rules: ["domain/entity match", "source provenance"],
      permission_rules: ["consent/opt-out gate required"],
    }),
  ].filter(Boolean);
}

function candidateEdge({ from, field, toKind, relation, confidence, direction = "out", reversible = false, source, legality, freshness }) {
  return {
    from,
    to: { kind: toKind, key: field.normalized_value },
    relation,
    field: field.name,
    direction,
    evidence: [{ field: field.name, value: field.value, normalized_value: field.normalized_value, source }],
    confidence,
    source,
    freshness,
    legality,
    reversibility: reversible ? "double_link_candidate" : "single_link_candidate",
  };
}

export function proposeIdentityEdges(input = {}) {
  const facts = inputFacts(input);
  const fields = extractJoinableFields(input);
  const source = sourceId(facts);
  const from = {
    kind: "realEstate",
    key: facts.parcel_id || facts.addr_key || canonicalAddress({ address: facts.address }) || source,
    source,
  };
  const byName = new Map(fields.map((f) => [f.name, f]));
  const edges = [];

  const address = byName.get("address");
  if (address) {
    edges.push(candidateEdge({ from, field: address, toKind: "address", relation: "has_situs_address", confidence: 0.78, reversible: true, source, legality: "GREEN", freshness: "source_record" }));
    edges.push(candidateEdge({ from, field: address, toKind: "business", relation: "business_may_operate_at_address", confidence: 0.46, source, legality: "GREEN", freshness: "source_record" }));
    edges.push(candidateEdge({ from, field: address, toKind: "permit", relation: "permit_may_reference_address", confidence: 0.52, source, legality: "GREEN", freshness: "source_record" }));
  }

  const parcel = byName.get("parcel_id");
  if (parcel) edges.push(candidateEdge({ from, field: parcel, toKind: "parcel", relation: "has_parcel_id", confidence: 0.92, reversible: true, source, legality: "GREEN", freshness: "source_record" }));

  const owner = byName.get("owner_name");
  if (owner) {
    const kind = ownerKind(owner.value);
    edges.push(candidateEdge({ from, field: owner, toKind: kind, relation: "owner_candidate", confidence: parcel ? 0.86 : 0.68, reversible: Boolean(parcel), source, legality: "GREEN", freshness: "source_record" }));
    if (kind === "business") edges.push(candidateEdge({ from, field: owner, toKind: "business", relation: "business_owner_candidate", confidence: parcel ? 0.82 : 0.64, reversible: Boolean(parcel), source, legality: "GREEN", freshness: "source_record" }));
  }

  const mailing = byName.get("owner_mailing_address");
  if (mailing) edges.push(candidateEdge({ from, field: mailing, toKind: "mailing_record", relation: "owner_mailing_address_candidate", confidence: owner ? 0.76 : 0.55, reversible: Boolean(owner), source, legality: "GREEN", freshness: "source_record" }));

  const contact = byName.get("contact_name");
  if (contact) edges.push(candidateEdge({ from, field: contact, toKind: "contact_candidate", relation: "named_contact_candidate", confidence: address ? 0.60 : 0.44, source, legality: "GREEN", freshness: "source_record" }));

  const phone = byName.get("phone");
  if (phone) edges.push(candidateEdge({ from, field: phone, toKind: "phone", relation: "contact_phone_candidate_requires_gate", confidence: contact || owner ? 0.66 : 0.45, source, legality: "GREEN", freshness: "source_record" }));

  const email = byName.get("email");
  if (email) edges.push(candidateEdge({ from, field: email, toKind: "email", relation: "contact_email_candidate_requires_gate", confidence: contact || owner ? 0.64 : 0.43, source, legality: "GREEN", freshness: "source_record" }));

  return { node: from, fields, edges };
}

export function registerRealEstateIdentityGraphPack(engine) {
  engine.registerCapability({
    id: "extract_joinable_fields",
    cost: { money: 0, latency_ms: 1 },
    policy: { legal_status: "local_transform", risk: 0 },
    run: async (_ctx, target) => extractJoinableFields(target),
  });
  engine.registerCapability({
    id: "propose_identity_edges",
    cost: { money: 0, latency_ms: 1 },
    policy: { legal_status: "local_transform", risk: 0 },
    run: async (_ctx, target) => proposeIdentityEdges(target),
  });
  engine.registerRoute({
    id: "real_estate_fields_to_edges",
    goal: "identity_edges",
    domain: "real_estate",
    confidence: 0.82,
    value: 0.9,
    output: "graph",
    steps: [
      { capability: "extract_joinable_fields", input: "target", output: "fields" },
      { capability: "propose_identity_edges", input: "target", output: "graph" },
    ],
  });
  return engine;
}

export function buildRealEstateIdentityGraphEngine() {
  return registerRealEstateIdentityGraphPack(createRouteEngine());
}

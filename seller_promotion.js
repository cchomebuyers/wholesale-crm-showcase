// seller_promotion.js -- promote first-party consent leads into the proof/queue workflow.
//
// This is an operator-facing read model. It may include seller-provided contact
// because it stays inside the seller-intake workflow; buyer marketplace views
// must continue to redact seller contact.

const str = (v) => (v === null || v === undefined ? "" : String(v).trim());

const parseChannels = (v) => {
  if (Array.isArray(v)) return v.map((c) => str(c).toLowerCase()).filter(Boolean);
  if (!str(v)) return [];
  try {
    const parsed = JSON.parse(v);
    if (Array.isArray(parsed)) return parsed.map((c) => str(c).toLowerCase()).filter(Boolean);
  } catch {
    // Fall through to comma parsing.
  }
  return str(v).split(",").map((c) => c.trim().toLowerCase()).filter(Boolean);
};

const clampLimit = (v, fallback = 50, max = 500) => {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(1, Math.min(max, Math.trunc(n)));
};

export function normalizeAddressKey(v) {
  return str(v)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\b(street)\b/g, "st")
    .replace(/\b(avenue)\b/g, "ave")
    .replace(/\b(road)\b/g, "rd")
    .replace(/\b(drive)\b/g, "dr")
    .replace(/\b(lane)\b/g, "ln")
    .replace(/\s+/g, " ")
    .trim();
}

export function buildSellerPromotionWorkflow({ consentRecords = [], properties = [], limit = 50 } = {}) {
  const propertyByAddress = new Map();
  for (const property of properties) {
    for (const value of [property.address, property.formatted_address]) {
      const key = normalizeAddressKey(value);
      if (key && !propertyByAddress.has(key)) propertyByAddress.set(key, property);
    }
  }

  const items = consentRecords
    .map((record) => promotionItem(record, propertyByAddress.get(normalizeAddressKey(record.address))))
    .sort(comparePromotions);
  const visible = items.slice(0, clampLimit(limit));
  const statusCounts = {};
  for (const item of items) statusCounts[item.status] = (statusCounts[item.status] || 0) + 1;

  return {
    built_at: new Date().toISOString(),
    summary: {
      consent_records: consentRecords.length,
      matched_properties: items.filter((i) => i.property.matched).length,
      ready_for_proof: items.filter((i) => i.workflow.proof_url).length,
      needs_address: items.filter((i) => i.status === "needs_address").length,
      returned: visible.length,
      status_counts: statusCounts,
    },
    items: visible,
    marketplace_safety: {
      seller_contact_redacted_from_buyer_marketplace: true,
      buyer_marketplace_route: "/api/investor-marketplace/deals",
      reason: "promotion is internal; marketplace deal cards keep seller contact redacted",
    },
    citations: [
      { claim: "first-party consent source", module: "consent.js#makeConsentRecord" },
      { claim: "seller intake source records", module: "seller_intake.js#buildSellerIntakeQueue" },
      { claim: "proof workflow target", module: "proof_stack.js#buildProofStack" },
      { claim: "buyer marketplace redaction boundary", module: "investor_marketplace.js#marketplaceDeal" },
    ],
  };
}

function promotionItem(record = {}, property = null) {
  const channels = parseChannels(record.channels);
  const hasAddress = Boolean(normalizeAddressKey(record.address));
  const contactable = channels.length > 0;
  const status = !hasAddress ? "needs_address" : property ? "matched_property" : "create_workflow_record";
  return {
    consent_id: record.id ?? null,
    created_at: record.created_at || null,
    status,
    seller: {
      name: str(record.name) || null,
      phone: str(record.phone) || null,
      email: str(record.email) || null,
      address: str(record.address) || null,
      allowed_channels: channels,
      outreach_allowed: contactable,
      consent_basis: str(record.legal_basis) || "first_party_express_consent",
    },
    property: property ? {
      matched: true,
      id: property.id ?? null,
      address: str(property.formatted_address) || str(property.address) || null,
      city: str(property.city) || null,
      state: str(property.state) || null,
      zip: str(property.zip) || null,
      source: str(property.source) || null,
      score: Number(property.wholesale_score ?? property.lead_score ?? property.distress_score ?? 0) || 0,
    } : {
      matched: false,
      id: null,
      address: str(record.address) || null,
    },
    workflow: workflowFor({ status, property, contactable }),
  };
}

function workflowFor({ status, property, contactable }) {
  if (status === "needs_address") {
    return {
      next_action: "contact seller on the consented channel and confirm the property address",
      proof_url: null,
      route_url: null,
      queue_target: "seller_intake",
    };
  }
  if (!property) {
    return {
      next_action: "create or match a property record, then build proof stack",
      proof_url: null,
      route_url: null,
      queue_target: contactable ? "first_party_research" : "seller_intake_review",
    };
  }
  return {
    next_action: contactable ? "open proof stack and promote to seller follow-up" : "review consent before outreach",
    proof_url: `/api/proof-stack/${property.id}`,
    route_url: `/api/resolve/contact-route`,
    queue_target: "proof_stack",
  };
}

function comparePromotions(a, b) {
  const rank = { matched_property: 0, create_workflow_record: 1, needs_address: 2 };
  const rankDelta = (rank[a.status] ?? 9) - (rank[b.status] ?? 9);
  if (rankDelta) return rankDelta;
  return String(b.created_at || "").localeCompare(String(a.created_at || ""));
}

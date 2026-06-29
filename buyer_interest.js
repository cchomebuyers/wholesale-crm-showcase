// buyer_interest.js -- buyer interest workflow for marketplace deals.
//
// Buyers may ask for follow-up on a marketplace deal, but the workflow never
// publishes seller contact. It records buyer-provided contact for internal
// follow-up and links back to the proof/evidence routes.

const str = (v) => (v === null || v === undefined ? "" : String(v).trim());

export function buildBuyerInterestRequest({
  deal = null,
  property = null,
  buyer = {},
  message = "",
  createdAt = new Date().toISOString(),
} = {}) {
  const propertyId = Number(deal?.property_id ?? property?.id ?? property?.property_id);
  if (!Number.isFinite(propertyId) || propertyId <= 0) {
    return { ok: false, error: "valid property_id is required" };
  }

  const buyerName = str(buyer.name);
  const buyerEmail = str(buyer.email);
  const buyerPhone = str(buyer.phone);
  if (!buyerName && !buyerEmail && !buyerPhone) {
    return { ok: false, error: "buyer name, email, or phone is required" };
  }

  const address = str(deal?.title) || str(property?.formatted_address) || str(property?.address) || null;
  const market = str(deal?.market) || [property?.city, property?.state, property?.zip].map(str).filter(Boolean).join(", ") || null;
  const proofUrl = deal?.proof?.proof_url || `/api/proof-stack/${propertyId}`;
  const kgEvidenceUrl = deal?.proof?.kg_evidence_url || `/api/kg/properties/${propertyId}/evidence`;

  return {
    ok: true,
    request: {
      created_at: createdAt,
      property_id: propertyId,
      deal: {
        title: address,
        market,
        proof_url: proofUrl,
        kg_evidence_url: kgEvidenceUrl,
        projected_spread: deal?.economics?.projected_spread ?? null,
        buyer_acceptance_score: deal?.economics?.buyer_acceptance?.score ?? null,
      },
      buyer: {
        name: buyerName || null,
        email: buyerEmail || null,
        phone: buyerPhone || null,
        buy_box: str(buyer.buy_box) || null,
      },
      message: str(message) || null,
      workflow: {
        status: "new_interest",
        next_action: "verify buyer fit, then share proof package without seller contact",
        proof_url: proofUrl,
        kg_evidence_url: kgEvidenceUrl,
      },
      marketplace_safety: {
        seller_contact_redacted: true,
        seller_contact_shared: false,
        reason: "buyer interest is an internal follow-up request; seller contact remains behind compliance-gated workflows",
      },
    },
  };
}

export function buildBuyerInterestQueue({ requests = [], limit = 100 } = {}) {
  const capped = Math.max(1, Math.min(500, Number(limit) || 100));
  const items = requests.map(queueItem).sort(compareItems);
  const status_counts = {};
  for (const item of items) status_counts[item.workflow.status] = (status_counts[item.workflow.status] || 0) + 1;
  return {
    built_at: new Date().toISOString(),
    summary: {
      total_interest: requests.length,
      returned: Math.min(items.length, capped),
      status_counts,
    },
    items: items.slice(0, capped),
    marketplace_safety: {
      seller_contact_redacted: true,
      buyer_marketplace_route: "/api/investor-marketplace/deals",
    },
    citations: [
      { claim: "marketplace deal redaction boundary", module: "investor_marketplace.js#buildInvestorMarketplace" },
      { claim: "buyer interest workflow", module: "buyer_interest.js#buildBuyerInterestRequest" },
      { claim: "proof package target", module: "proof_stack.js#buildProofStack" },
    ],
  };
}

function queueItem(row = {}) {
  const propertyId = Number(row.property_id);
  return {
    id: row.id ?? null,
    created_at: row.created_at || null,
    property_id: Number.isFinite(propertyId) ? propertyId : null,
    deal: {
      title: str(row.deal_title) || null,
      market: str(row.market) || null,
      proof_url: row.proof_url || (Number.isFinite(propertyId) ? `/api/proof-stack/${propertyId}` : null),
      kg_evidence_url: row.kg_evidence_url || (Number.isFinite(propertyId) ? `/api/kg/properties/${propertyId}/evidence` : null),
    },
    buyer: {
      name: str(row.buyer_name) || null,
      email: str(row.buyer_email) || null,
      phone: str(row.buyer_phone) || null,
      buy_box: str(row.buyer_buy_box) || null,
    },
    message: str(row.message) || null,
    workflow: {
      status: str(row.status) || "new_interest",
      next_action: "verify buyer fit, then share proof package without seller contact",
    },
    marketplace_safety: {
      seller_contact_redacted: true,
      seller_contact_shared: false,
    },
  };
}

function compareItems(a, b) {
  const rank = { new_interest: 0, contacted: 1, closed: 2 };
  const rankDelta = (rank[a.workflow.status] ?? 9) - (rank[b.workflow.status] ?? 9);
  if (rankDelta) return rankDelta;
  return String(b.created_at || "").localeCompare(String(a.created_at || ""));
}

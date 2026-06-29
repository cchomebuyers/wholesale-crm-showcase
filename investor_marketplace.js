// investor_marketplace.js -- buyer-facing deal read model.
//
// The marketplace should expose deals matched to buyer buy-boxes, not raw seller
// contact data. It is pure so the API route can gather rows from crm.db and keep
// this module testable without a server or database.

import { rankBuyerDemand } from "./buyer_discovery.js";
import { evaluateWholesaleSpread } from "./wholesale_spread.js";
import { buildProofStack } from "./proof_stack.js";

const num = (v) => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const str = (v) => (v === null || v === undefined ? "" : String(v).trim());
const clampLimit = (v, fallback = 25, max = 200) => {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(1, Math.min(max, Math.trunc(n)));
};

export function buildInvestorMarketplace({
  properties = [],
  crmBuyers = [],
  discoveredCandidates = [],
  sellerEvidenceByPropertyId = {},
  spreadOptions = {},
  limit = 25,
  minBuyerScore = 45,
  includeUnmatched = false,
} = {}) {
  const cappedLimit = clampLimit(limit);
  const threshold = Math.max(0, Math.min(100, Number(minBuyerScore) || 0));
  const deals = [];
  const gaps = {};

  for (const property of properties) {
    const sellerEvidence = sellerEvidenceByPropertyId[property.id] || null;
    const demand = rankBuyerDemand({
      property,
      crmBuyers,
      discoveredCandidates,
      limit: 8,
    });
    const buyerMatches = demand.all.filter((b) => Number(b.score) >= threshold);
    for (const gap of demand.gaps || []) gaps[gap] = (gaps[gap] || 0) + 1;
    if (!includeUnmatched && buyerMatches.length === 0) continue;

    const enriched = {
      ...property,
      buyer_matches: buyerMatches.length ? buyerMatches : demand.all,
      seller_acceptable_price: sellerEvidence?.price,
      seller_price_source: sellerEvidence?.source,
      seller_price_evidence: sellerEvidence,
    };
    const spread = evaluateWholesaleSpread(enriched, spreadOptions);
    const proof = buildProofStack(property, {
      spread,
      buyerMatches,
      sellerEvidence,
      spreadOptions,
    });
    deals.push(marketplaceDeal(property, {
      buyerMatches,
      demand,
      spread,
      proof,
      sellerEvidence,
    }));
  }

  deals.sort(compareDeals);
  const visible = deals.slice(0, cappedLimit);
  return {
    built_at: new Date().toISOString(),
    summary: {
      scanned_properties: properties.length,
      crm_buyers: crmBuyers.length,
      discovered_candidates: discoveredCandidates.length,
      matched_deals: deals.length,
      returned: visible.length,
      min_buyer_score: threshold,
    },
    deals: visible,
    gaps,
    citations: [
      { claim: "buyer buy-box matching", module: "buyer_discovery.js#rankBuyerDemand" },
      { claim: "assignment economics", module: "wholesale_spread.js#evaluateWholesaleSpread" },
      { claim: "proof stack", module: "proof_stack.js#buildProofStack" },
    ],
  };
}

function marketplaceDeal(property, { buyerMatches, demand, spread, proof, sellerEvidence }) {
  const address = str(property.formatted_address) || str(property.address) || null;
  return {
    property_id: property.id ?? null,
    title: address || `Property ${property.id ?? ""}`.trim(),
    market: [property.city, property.state, property.zip].map(str).filter(Boolean).join(", "),
    county: str(property.county) || null,
    property_type: str(property.property_type) || null,
    source: str(property.source) || null,
    score: num(property.wholesale_score) ?? num(property.lead_score) ?? null,
    economics: {
      status: spread.status,
      projected_spread: spread.projectedSpread,
      target_fee: spread.targetFee,
      buyer_assignment_price: spread.inputs?.buyerAssignmentPrice ?? null,
      acquisition_offer_price: spread.inputs?.acquisitionOfferPrice ?? null,
      arv: spread.inputs?.arv ?? num(property.arv),
      repairs: spread.inputs?.repairs ?? num(property.repair_estimate),
      best_negotiation_path: spread.bestNegotiationPath
        ? {
            name: spread.bestNegotiationPath.name,
            spread: spread.bestNegotiationPath.spread,
            works: spread.bestNegotiationPath.works,
          }
        : null,
      buyer_acceptance: spread.buyerAcceptance,
      next_needed: spread.nextNeeded,
    },
    buyer_demand: {
      top_buyer: buyerMatches[0] || null,
      matches: buyerMatches,
      discovery_paths: (demand.discovery_paths || []).map((p) => p.id),
      gaps: demand.gaps || [],
    },
    proof: {
      completeness: proof.completeness,
      deal_ready: proof.completeness?.deal_ready || false,
      proof_url: property.id ? `/api/proof-stack/${property.id}` : null,
      kg_evidence_url: property.id ? `/api/kg/properties/${property.id}/evidence` : null,
    },
    seller_price: {
      present: Boolean(sellerEvidence?.price),
      confidence: sellerEvidence?.confidence || null,
      source: sellerEvidence?.source || null,
    },
    compliance: {
      seller_contact_redacted: true,
      outreach_allowed: false,
      reason: "marketplace read model never publishes seller contact; contact routes remain compliance-gated",
    },
  };
}

function compareDeals(a, b) {
  const buyerDelta = scoreOf(b.buyer_demand.top_buyer) - scoreOf(a.buyer_demand.top_buyer);
  if (buyerDelta) return buyerDelta;
  const acceptanceDelta = acceptanceScore(b) - acceptanceScore(a);
  if (acceptanceDelta) return acceptanceDelta;
  const proofDelta = (b.proof.completeness?.score || 0) - (a.proof.completeness?.score || 0);
  if (proofDelta) return proofDelta;
  return (b.score || 0) - (a.score || 0);
}

function scoreOf(match) {
  return Number(match?.score) || 0;
}

function acceptanceScore(deal) {
  const score = Number(deal.economics.buyer_acceptance?.score);
  return Number.isFinite(score) ? score : -1;
}

// proof_stack.js -- assemble ONE property's full evidence into a single object.
//
// NORTH_STAR_VISION.md #5 ("Proof stack per property") + #3 module list
// ("Evidence Ledger"): a wholesaler — or a buyer on the future investor
// marketplace — should be able to see *why* a property is (or is not) a deal in
// one place: the distress signal, the owner identity, the valuation (ARV/MAO),
// the buyer demand, the seller's price evidence, the assignment spread (incl.
// buyer-acceptance), and the queue decision — each tagged with the module/source
// that produced it (CLAUDE.md "THE CITATION LAW").
//
// This module is PURE: it takes one property record plus already-gathered
// evidence (seller price, buyer matches) and returns a structured proof object.
// No I/O, no DB. The server route (GET /api/proof-stack/:id) owns gathering from
// crm.db; tools own persistence. It reuses, never re-implements, the existing
// engines: property_signals.deriveSignals, pro_wholesaler_queue (distressSignal +
// classifyProQueue), wholesale_spread.evaluateWholesaleSpread + maoFromArv.

import { deriveSignals } from "./property_signals.js";
import { distressSignal, classifyProQueue } from "./pro_wholesaler_queue.js";
import { evaluateWholesaleSpread, maoFromArv } from "./wholesale_spread.js";

const num = (v) => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const str = (v) => (v === null || v === undefined ? "" : String(v).trim());
const has = (v) => str(v).length > 0;

// The seven evidence pillars the vision names. `present` drives completeness so a
// buyer/wholesaler can see at a glance how proven a property is.
const PILLARS = ["signal", "owner", "valuation", "buyer_demand", "seller_price", "spread"];

/**
 * Build a property's proof stack.
 * @param {object} record - a crm.db `properties` row or normalized property
 * @param {object} [opts]
 *   @param {object} [opts.spread]         - precomputed evaluateWholesaleSpread() result
 *   @param {object} [opts.queue]          - precomputed classifyProQueue() result
 *   @param {Array}  [opts.buyerMatches]   - ranked buyer matches (buyer_discovery.rankBuyerDemand().all)
 *   @param {object} [opts.sellerEvidence] - best seller-price evidence ({price, source, confidence, ...})
 *   @param {object} [opts.spreadOptions]  - config for the spread engine (acqConfig())
 *   @param {number} [opts.minScore] @param {number} [opts.hotScore]
 * @returns {object} proof stack with identity, evidence{...7 pillars}, decision,
 *                   completeness, citations, built_at.
 */
export function buildProofStack(record = {}, opts = {}) {
  const buyerMatches = Array.isArray(opts.buyerMatches) ? opts.buyerMatches : [];
  const sellerEvidence = opts.sellerEvidence || null;

  // Fold the gathered evidence onto the record so the engines see one coherent
  // input (mirrors server.js /api/wholesale-spread/audit).
  const enriched = {
    ...record,
    buyer_matches: buyerMatches.length ? buyerMatches : record.buyer_matches,
    seller_acceptable_price: sellerEvidence?.price ?? record.seller_acceptable_price,
    seller_price_source: sellerEvidence?.source ?? record.seller_price_source,
    seller_price_evidence: sellerEvidence ?? record.seller_price_evidence,
  };

  const sig = deriveSignals(enriched);
  const dist = distressSignal(enriched);
  const spread = opts.spread ?? safe(() => evaluateWholesaleSpread(enriched, opts.spreadOptions || {}));
  const decision = opts.queue ?? safe(() => classifyProQueue(enriched, {
    spread,
    minScore: opts.minScore,
    hotScore: opts.hotScore,
    spreadOptions: opts.spreadOptions,
  }));

  const arv = num(record.arv);
  const repairs = num(record.repair_estimate) ?? spread?.inputs?.repairs ?? null;
  const mao = num(record.mao) ?? (arv != null
    ? maoFromArv(arv, repairs, { ...(opts.spreadOptions || {}), sqft: num(record.square_footage) })
    : null);

  const evidence = {
    signal: {
      present: dist.present,
      label: dist.label,
      from_source: dist.fromSource,
      parcel_only: dist.parcelOnly,
      distress_score: dist.distressScore,
      motivation_score: dist.motivation,
      source: str(record.source) || str(record.source_id) || null,
    },
    owner: {
      present: sig.owner_known,
      owner_name: str(record.owner_name) || null,
      owner_mailing: str(record.owner_mailing) || null,
      owner_source: str(record.owner_source) || null,
      absentee: sig.absentee_owner,
      owner_occupied: sig.owner_occupied,
      entity_owner: sig.entity_owner,
      institutional_owner: sig.institutional_owner,
      signal_score: sig.signal_score,
      reasons: sig.reasons,
    },
    valuation: {
      present: arv != null && arv > 0,
      arv,
      mao,
      repairs,
      buyer_pct: spread?.inputs?.buyerPct ?? null,
    },
    buyer_demand: {
      present: buyerMatches.length > 0,
      count: buyerMatches.length,
      top: buyerMatches.slice(0, 5).map((b) => ({
        name: b.name || b.buyer_name || null,
        max_price: num(b.max_price) ?? num(b.buyer_max_price),
        areas: b.areas || b.area || null,
        source: b.source || null,
      })),
    },
    seller_price: {
      present: !!sellerEvidence?.price || has(record.seller_acceptable_price) ||
        has(record.contract_price) || has(record.asking_price) || has(record.price),
      best: sellerEvidence || null,
      anchor_price: spread?.inputs?.sellerAnchorPrice ?? null,
      anchor_source: spread?.inputs?.sellerPriceSource ?? null,
      is_hard_floor: spread?.inputs?.sellerIsHardFloor ?? null,
    },
    spread: spread ? {
      present: spread.status !== "unproven",
      status: spread.status,
      projected_spread: spread.projectedSpread,
      anchor_spread: spread.anchorSpread,
      target_fee: spread.targetFee,
      buyer_assignment_price: spread.inputs?.buyerAssignmentPrice ?? null,
      acquisition_offer_price: spread.inputs?.acquisitionOfferPrice ?? null,
      best_negotiation_path: spread.bestNegotiationPath
        ? { name: spread.bestNegotiationPath.name, spread: spread.bestNegotiationPath.spread, works: spread.bestNegotiationPath.works }
        : null,
      buyer_acceptance: spread.buyerAcceptance || null,
      reasons: spread.reasons || [],
      next_needed: spread.nextNeeded || [],
    } : { present: false, status: "unproven", reasons: ["spread engine unavailable"] },
  };

  const completeness = scoreCompleteness(evidence);

  return {
    property_id: record.id ?? null,
    identity: {
      address: str(record.formatted_address) || str(record.address) || null,
      city: str(record.city) || null,
      state: str(record.state) || null,
      zip: str(record.zip) || null,
      county: str(record.county) || null,
      property_type: str(record.property_type) || null,
      source: str(record.source) || null,
      source_id: str(record.source_id) || null,
    },
    evidence,
    decision: decision ? {
      tier: decision.tier,
      priority_score: decision.priority_score,
      next_action: decision.next_action,
      spend_allowed: decision.spend_allowed,
      missing: decision.missing,
      reasons: decision.reasons,
    } : null,
    completeness,
    // Citation law: every pillar names the module/source that proved it.
    citations: [
      { claim: "distress signal", module: "pro_wholesaler_queue.js#distressSignal", source: evidence.signal.source },
      { claim: "owner identity", module: "property_signals.js#deriveSignals", source: evidence.owner.owner_source },
      { claim: "valuation (ARV/MAO)", module: "wholesale_spread.js#maoFromArv", source: "record.arv / comps" },
      { claim: "buyer demand", module: "buyer_discovery.js#rankBuyerDemand", source: "crm buyers + discovered candidates" },
      { claim: "seller price", module: "seller_price_evidence.js", source: evidence.seller_price.anchor_source },
      { claim: "assignment spread + buyer-acceptance", module: "wholesale_spread.js#evaluateWholesaleSpread", source: "projected_spread = buyer_assignment_price - acquisition_offer_price" },
      { claim: "queue decision", module: "pro_wholesaler_queue.js#classifyProQueue", source: "tier ladder" },
    ],
    built_at: new Date().toISOString(),
  };
}

function scoreCompleteness(evidence) {
  const present = PILLARS.filter((p) => evidence[p]?.present);
  const missing = PILLARS.filter((p) => !evidence[p]?.present);
  return {
    score: Math.round((present.length / PILLARS.length) * 100) / 100,
    present,
    missing,
    // A proof stack is "deal-ready" when every pillar is proven, the spread holds,
    // and the owner is an actual seller — an institutional/govt/lender owner is
    // never a seller lead (property_signals.deriveSignals), so it can't be ready.
    deal_ready: missing.length === 0 && evidence.spread.status !== "fails" &&
      !evidence.owner.institutional_owner,
  };
}

function safe(fn) {
  try { return fn(); } catch { return null; }
}

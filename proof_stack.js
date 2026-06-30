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
import { proposeEdges, groupByTarget } from "./field_edges.js";

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
  const graph = graphContext(record);

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
    // Identity-graph context (NORTH_STAR_VISION #2 "fields propose edges"): the
    // candidate links this property's fields propose to owner/parcel/business/
    // contact nodes — candidates, never auto-confirmed. Via field_edges.proposeEdges.
    graph,
    // Citation law: every pillar names the module/source that proved it.
    citations: [
      { claim: "distress signal", module: "pro_wholesaler_queue.js#distressSignal", source: evidence.signal.source },
      { claim: "owner identity", module: "property_signals.js#deriveSignals", source: evidence.owner.owner_source },
      { claim: "valuation (ARV/MAO)", module: "wholesale_spread.js#maoFromArv", source: "record.arv / comps" },
      { claim: "buyer demand", module: "buyer_discovery.js#rankBuyerDemand", source: "crm buyers + discovered candidates" },
      { claim: "seller price", module: "seller_price_evidence.js", source: evidence.seller_price.anchor_source },
      { claim: "assignment spread + buyer-acceptance", module: "wholesale_spread.js#evaluateWholesaleSpread", source: "projected_spread = buyer_assignment_price - acquisition_offer_price" },
      { claim: "queue decision", module: "pro_wholesaler_queue.js#classifyProQueue", source: "tier ladder" },
      { claim: "candidate identity edges", module: "field_edges.js#proposeEdges", source: "fields propose edges (kind=schema→parser registry)" },
    ],
    built_at: new Date().toISOString(),
  };
}

// Map a property record onto the field_edges node shape and propose its candidate
// identity edges — the doorways from this property to owner/person/business/contact
// nodes. Pure read-only consume of field_edges; candidates are never auto-confirmed.
function graphContext(record = {}) {
  const node = {
    id: record.id ?? null,
    kind: "property",
    source: record.owner_source || record.source || null,
    observed_at: record.owner_enriched_at || record.updated_at || null,
    fields: {
      address: record.formatted_address || record.address || null,
      parcel_id: record.parcel_id || record.apn || record.pin || null,
      owner_name: record.owner_name || null,
      mailing_address: record.owner_mailing || null,
      phone: record.listing_agent_phone || record.seller_phone || record.phone || null,
      email: record.listing_agent_email || record.seller_email || record.email || null,
    },
  };
  const edges = safe(() => proposeEdges(node)) || [];
  const targets = safe(() => groupByTarget(edges)) || [];
  const reachableKinds = [...new Set(edges.map((e) => e.to_kind))];
  return {
    candidate_edges: edges,
    join_targets: targets,
    reachable_kinds: reachableKinds,
    edge_count: edges.length,
    double_links: edges.filter((e) => e.reversible).length,
    single_links: edges.filter((e) => !e.reversible).length,
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

// ---------------------------------------------------------------------------
// Buyer-safe view: what an EXTERNAL investor on the marketplace may see.
//
// NORTH_STAR_VISION.md #3 (investor marketplace — "buyers see deals matched to
// their buy-box") + CLAUDE.md ground rule 2 / LOOP_PROMPT hard rules: seller
// identity and contact are internal-only; our acquisition cost and fee are our
// negotiating position. A buyer is sold on the DEAL (value + their profit), never
// on the seller's name, exact address, or how little we're paying. This is the
// deal-safe boundary the marketplace UI/API must call before exposing a property.

// Public opportunity label — keeps the buyer informed of the distress *type*
// without leaking the internal source id (which reveals the locale/dataset).
const OPP_TYPES = [
  [/violation|code[_-]?enforce|nuisance|unsafe/i, "Code violation"],
  [/vacant|abandon/i, "Vacant / abandoned"],
  [/condemn|demol|blight/i, "Condemned / blighted"],
  [/delinquen|tax/i, "Tax-delinquent"],
  [/forecl/i, "Pre-foreclosure"],
  [/probate/i, "Probate"],
  [/lien/i, "Lien"],
];
function opportunityType(label) {
  const s = str(label);
  for (const [rx, name] of OPP_TYPES) if (rx.test(s)) return name;
  return "Distressed opportunity";
}

// Fields a buyer must never see, asserted by tests so a future refactor can't
// silently leak them back in.
export const INTERNAL_ONLY_FIELDS = [
  "owner_name", "owner_mailing", "owner_source",
  "address", "seller_anchor_price", "acquisition_offer_price",
  "projected_spread", "anchor_spread", "best", "reasons",
];

/**
 * Redact a full proof stack into the marketplace-safe view.
 * @param {object} proof - result of buildProofStack()
 * @returns {object} deal-safe object (no seller identity/contact, no exact
 *                   address, no acquisition cost/margin, no competing buyer names)
 */
export function buyerSafeProofStack(proof = {}) {
  const e = proof.evidence || {};
  const acc = e.spread?.buyer_acceptance || {};
  return {
    opportunity_id: proof.property_id != null ? `OPP-${proof.property_id}` : null,
    location: {
      // city/state/zip/county only — never the street address (protects the
      // lead from being poached and the seller from being identified).
      city: proof.identity?.city ?? null,
      state: proof.identity?.state ?? null,
      zip: proof.identity?.zip ?? null,
      county: proof.identity?.county ?? null,
      property_type: proof.identity?.property_type ?? null,
    },
    opportunity_type: opportunityType(e.signal?.label),
    valuation: {
      arv: e.valuation?.arv ?? null,
      mao: e.valuation?.mao ?? null,
      estimated_repairs: e.valuation?.repairs ?? null,
    },
    // The buyer-facing economics: THEIR price and THEIR upside — never our cost
    // basis (seller anchor / acquisition offer) or our fee (projected_spread).
    economics: {
      buyer_assignment_price: e.spread?.buyer_assignment_price ?? null,
      projected_buyer_profit: acc.profit ?? null,
      buyer_acceptance_score: acc.score ?? null,
      buyer_acceptance_rating: acc.rating ?? "unknown",
    },
    demand: {
      // count only — never the names of competing buyers.
      interested_investors: e.buyer_demand?.count ?? 0,
    },
    confidence: {
      completeness_score: proof.completeness?.score ?? null,
      deal_ready: proof.completeness?.deal_ready ?? false,
    },
    // Graph reach as a count + target kinds only — never the candidate edge values
    // (which carry owner name / mailing). Shows a buyer the identity graph is rich
    // without exposing who the seller is.
    graph_summary: {
      candidate_links: proof.graph?.edge_count ?? 0,
      reachable_kinds: proof.graph?.reachable_kinds ?? [],
    },
    disclosures: [
      "Assignment of contract: the buyer pays the assignment price shown.",
      "Seller identity and contact are withheld until a contract is in place.",
      "Figures are estimates from public-record evidence; verify before closing.",
    ],
    redacted: ["seller identity", "seller contact", "exact street address", "acquisition cost & margin", "competing buyer identities"],
    built_at: proof.built_at || new Date().toISOString(),
  };
}

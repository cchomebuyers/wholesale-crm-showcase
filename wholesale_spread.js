// wholesale_spread.js -- evaluate whether a record can make wholesale money.
//
// The business model is not "find any distressed address." It is:
// buyer assignment price - acquisition offer = projected fee/spread.
// A seller's stated number is usually an anchor/counter, not a hard floor. This
// module therefore tracks both sides: what the seller said and what we can
// offer while still preserving assignment spread.

const num = (v) => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
};

const firstNum = (...vals) => {
  for (const v of vals) {
    const n = num(v);
    if (n !== null) return n;
  }
  return null;
};

const sellerSourceKind = (source) => {
  const s = String(source || "").toLowerCase();
  if (/contract|accepted|agreed|seller_min|minimum|bottom|lowest/.test(s)) return "hard";
  if (/ask|list|price|counter|wants|take|note|email|activity|seller_acceptable/.test(s)) return "anchor";
  return "anchor";
};

const offerFromAnchor = (anchor, { negotiationDiscountPct = 12, offerRoundTo = 100 } = {}) => {
  const a = num(anchor);
  if (!a) return null;
  const raw = a * (1 - (Number(negotiationDiscountPct) || 0) / 100);
  const step = Number(offerRoundTo) > 0 ? Number(offerRoundTo) : 1;
  return Math.round(raw / step) * step;
};

export function spreadInputsFromRecord(record = {}, {
  buyerPct = 70,
  minFee = 10000,
  rehabPerSqft = 25,
  negotiationDiscountPct = 12,
  buyerFlexPct = 8,
  offerRoundTo = 100,
} = {}) {
  const property = record.property || record.facets?.property || {};
  const listing = record.listing || record.facets?.listing || {};
  const valuation = record.valuation || record.facets?.valuation || {};
  const buyerDemand = record.buyerDemand || record.facets?.buyerDemand || {};
  const content = record.content || {};

  const arv = firstNum(record.arv, valuation.arv, content.arv);
  const sqft = firstNum(record.square_footage, property.square_footage, content.square_footage);
  const repairs = firstNum(record.repair_estimate, valuation.repair_estimate, content.repair_estimate) ??
    (sqft ? Math.round(sqft * rehabPerSqft) : null);

  const assignmentPrice = firstNum(record.assignment_price, record.buyer_assignment_price, valuation.assignment_price, valuation.buyer_assignment_price);
  const acquisitionOfferForAssignment = firstNum(record.acquisition_offer_price, record.target_acquisition_price, record.seller_offer_price, record.offer_amount);
  const assignmentFee = firstNum(record.assignment_fee, valuation.assignment_fee);
  const impliedBuyerAssignment = assignmentPrice ?? (acquisitionOfferForAssignment && assignmentFee
    ? acquisitionOfferForAssignment + assignmentFee
    : null);
  const explicitBuyer = firstNum(record.buyer_offer_price, record.buyer_max_price, valuation.buyer_offer_price, valuation.buyer_max_price);
  const formulaBuyer = arv && repairs != null ? Math.round(arv * (buyerPct / 100) - repairs) : null;
  const bestBuyer = Array.isArray(record.buyer_matches) ? record.buyer_matches[0] :
    Array.isArray(buyerDemand.matches) ? buyerDemand.matches[0] : null;
  const bestBuyerMax = firstNum(bestBuyer?.max_price, bestBuyer?.buyer_max_price);
  const buyerAssignmentPrice = impliedBuyerAssignment ?? explicitBuyer ??
    (formulaBuyer && bestBuyerMax ? Math.min(formulaBuyer, bestBuyerMax) : (formulaBuyer ?? bestBuyerMax));
  const explicitBuyerStretch = firstNum(
    record.buyer_stretch_price,
    record.buyer_counter_price,
    record.buyer_max_price,
    valuation.buyer_stretch_price,
    valuation.buyer_counter_price,
    valuation.buyer_max_price,
  );
  const modeledBuyerStretch = buyerAssignmentPrice
    ? Math.round(buyerAssignmentPrice * (1 + (Number(buyerFlexPct) || 0) / 100) / (Number(offerRoundTo) || 1)) * (Number(offerRoundTo) || 1)
    : null;
  const buyerStretchPrice = explicitBuyerStretch ?? (bestBuyerMax && buyerAssignmentPrice
    ? Math.max(buyerAssignmentPrice, Math.min(bestBuyerMax, modeledBuyerStretch || bestBuyerMax))
    : modeledBuyerStretch);

  const sellerAnchorPrice = firstNum(
    record.seller_anchor_price,
    record.seller_acceptable_price,
    record.seller_min_price,
    record.contract_price,
    record.asking_price,
    record.price,
    listing.price,
    valuation.seller_acceptable_price,
    valuation.seller_min_price,
  );
  const explicitAcquisitionOffer = firstNum(
    record.acquisition_offer_price,
    record.target_acquisition_price,
    record.seller_offer_price,
    record.offer_amount,
    valuation.acquisition_offer_price,
    valuation.target_acquisition_price,
    valuation.offer_amount,
  );
  const sellerPriceSource = record.seller_price_source || record.seller_source || record.seller_price_evidence?.source ||
    (sellerAnchorPrice === firstNum(record.contract_price) ? "contract_price" :
      sellerAnchorPrice === firstNum(record.seller_min_price, valuation.seller_min_price) ? "seller_min_price" :
      sellerAnchorPrice === firstNum(record.asking_price, record.price, listing.price) ? "asking_or_list_price" :
      sellerAnchorPrice ? "seller_anchor_price" : null);
  const sellerIsHardFloor = sellerSourceKind(sellerPriceSource) === "hard";
  const anchorOffer = sellerAnchorPrice && !sellerIsHardFloor
    ? offerFromAnchor(sellerAnchorPrice, { negotiationDiscountPct, offerRoundTo })
    : sellerAnchorPrice;
  const maxSellerOfferForTarget = buyerAssignmentPrice ? Math.max(0, buyerAssignmentPrice - (num(minFee) ?? 10000)) : null;
  const acquisitionOfferPrice = explicitAcquisitionOffer ?? anchorOffer;

  return {
    arv,
    repairs,
    buyerPct,
    minFee,
    formulaBuyer,
    bestBuyerMax,
    buyerAssignmentPrice,
    sellerAcceptablePrice: sellerAnchorPrice,
    sellerAnchorPrice,
    sellerPriceSource,
    sellerIsHardFloor,
    acquisitionOfferPrice,
    acquisitionOfferSource: explicitAcquisitionOffer ? "explicit_acquisition_offer" :
      sellerIsHardFloor ? "hard_seller_floor" : "anchor_discount_model",
    maxSellerOfferForTarget,
    requiredBuyerAtSellerAnchor: sellerAnchorPrice ? sellerAnchorPrice + (num(minFee) ?? 10000) : null,
    negotiationDiscountPct,
    buyerFlexPct,
    buyerStretchPrice,
  };
}

function scenario(name, buyerPrice, sellerPrice, targetFee, notes = []) {
  const spread = buyerPrice && sellerPrice ? Math.round(buyerPrice - sellerPrice) : null;
  return {
    name,
    buyer_price: buyerPrice,
    seller_price: sellerPrice,
    spread,
    works: spread != null && spread >= targetFee,
    thin: spread != null && spread > 0 && spread < targetFee,
    fails: spread != null && spread <= 0,
    notes,
  };
}

export function evaluateWholesaleSpread(record = {}, options = {}) {
  const i = spreadInputsFromRecord(record, options);
  const blockers = [];
  if (!i.buyerAssignmentPrice) blockers.push("missing buyer assignment price or ARV-based buyer max");
  if (!i.sellerAnchorPrice) blockers.push("missing seller anchor / contract price / asking price");
  if (!i.acquisitionOfferPrice) blockers.push("missing acquisition offer model");
  if (!i.arv && !i.buyerAssignmentPrice) blockers.push("missing ARV");
  if (i.repairs == null && i.arv) blockers.push("missing repair estimate");

  const projectedSpread = i.buyerAssignmentPrice && i.acquisitionOfferPrice
    ? Math.round(i.buyerAssignmentPrice - i.acquisitionOfferPrice)
    : null;
  const anchorSpread = i.buyerAssignmentPrice && i.sellerAnchorPrice
    ? Math.round(i.buyerAssignmentPrice - i.sellerAnchorPrice)
    : null;
  const feeTarget = num(options.minFee) ?? i.minFee ?? 10000;
  const negotiation = {
    noMove: scenario("no_move", i.buyerAssignmentPrice, i.sellerAnchorPrice, feeTarget, ["seller anchor and current buyer price"]),
    sellerMoves: scenario("seller_moves", i.buyerAssignmentPrice, i.acquisitionOfferPrice, feeTarget, ["acquisition offer below seller anchor"]),
    buyerMoves: scenario("buyer_moves", i.buyerStretchPrice, i.sellerAnchorPrice, feeTarget, ["buyer counter/stretch while seller holds anchor"]),
    bothMove: scenario("both_move", i.buyerStretchPrice, i.acquisitionOfferPrice, feeTarget, ["buyer stretches and seller accepts lower offer"]),
  };
  const bestNegotiationPath = Object.values(negotiation)
    .filter((x) => x.spread != null)
    .sort((a, b) => b.spread - a.spread)[0] || null;
  const profitable = projectedSpread != null && projectedSpread >= feeTarget;
  const marginal = projectedSpread != null && projectedSpread > 0 && projectedSpread < feeTarget;
  const negative = projectedSpread != null && projectedSpread <= 0;

  const status = blockers.length ? "unproven" : profitable ? "works" : marginal ? "thin" : "fails";
  const reasons = [...blockers];
  if (!blockers.length) {
    if (profitable) reasons.push(`projected spread ${projectedSpread} >= target fee ${feeTarget}`);
    if (marginal) reasons.push(`spread ${projectedSpread} is positive but below target fee ${feeTarget}`);
    if (negative) reasons.push(`buyer price does not beat modeled acquisition offer (${projectedSpread})`);
    if (i.sellerAnchorPrice && i.acquisitionOfferPrice && i.acquisitionOfferPrice < i.sellerAnchorPrice) {
      reasons.push(`seller anchor ${i.sellerAnchorPrice}; modeled offer ${i.acquisitionOfferPrice}`);
    }
    if (anchorSpread != null && anchorSpread < 0 && projectedSpread > 0) {
      reasons.push(`opportunity needs negotiation: anchor spread ${anchorSpread}, modeled offer spread ${projectedSpread}`);
    }
    if (bestNegotiationPath && bestNegotiationPath.name === "both_move" && bestNegotiationPath.works && !profitable) {
      reasons.push(`both sides can move: best path spread ${bestNegotiationPath.spread}`);
    }
  }

  // Will the end buyer accept our fee? Uses the realized fee (projectedSpread) when known.
  const acceptance = buyerAcceptance(i.arv, i.repairs, i.buyerAssignmentPrice, projectedSpread);

  return {
    status,
    projectedSpread,
    anchorSpread,
    targetFee: feeTarget,
    profitable,
    marginal,
    negotiation,
    bestNegotiationPath,
    buyerAcceptance: acceptance,
    buyer_acceptance_score: acceptance.score,
    buyer_acceptance_rating: acceptance.rating,
    buyer_projected_profit: acceptance.profit,
    inputs: i,
    reasons,
    nextNeeded: blockers.map((b) => {
      if (b.includes("buyer")) return "find buyer max: buyer buy-box, ARV rule, or buyer offer";
      if (b.includes("seller")) return "find seller anchor/contract/ask, then model our acquisition offer";
      if (b.includes("ARV")) return "estimate ARV from comps/AVM";
      if (b.includes("repair")) return "estimate repairs from sqft/condition/photos";
      return b;
    }),
  };
}

// Buyer-acceptance: will the END BUYER say yes to our fee? A property signal is not a deal,
// and neither is a fat spread if it eats the buyer's whole upside. The rule a pro lives by:
//   buyer_acceptance_score = buyer_projected_profit / assignment_fee
// >=5x excellent, 3-5x good, 2-3x possible, 1-2x buyer annoyed, <1x dead. Aim profit >= 3x fee.
// buyer_projected_profit ~= ARV - repairs - what the buyer pays us (buyer assignment price).
export function buyerAcceptance(arv, repairs, buyerAssignmentPrice, fee) {
  const a = num(arv); const bp = num(buyerAssignmentPrice); const f = num(fee);
  const r = num(repairs) ?? 0;
  if (!a || !bp || !f) return { profit: null, score: null, rating: "unknown", reason: "need ARV, buyer assignment price, and fee" };
  const profit = Math.round(a - r - bp);
  if (profit <= 0) return { profit, score: 0, rating: "dead", reason: "no buyer profit after our price" };
  const score = Math.round((profit / f) * 100) / 100;
  const rating = score >= 5 ? "excellent" : score >= 3 ? "good" : score >= 2 ? "possible" : score >= 1 ? "annoyed" : "dead";
  return { profit, score, rating, reason: `buyer profit ${profit} is ${score}x our fee ${f}` };
}

// Max Allowable Offer: the wholesaler's offer ceiling to the seller given an ARV.
// MAO = ARV*buyerPct - repairs - target fee. repairs falls back to sqft*rehabPerSqft, else 0.
export function maoFromArv(arv, repairs = null, { buyerPct = 70, minFee = 10000, rehabPerSqft = 25, sqft = null } = {}) {
  const a = num(arv);
  if (!a) return null;
  const rep = repairs != null ? (num(repairs) ?? 0) : (num(sqft) ? Math.round(num(sqft) * rehabPerSqft) : 0);
  const mao = Math.round(a * (buyerPct / 100) - rep - (num(minFee) ?? 10000));
  return mao > 0 ? mao : 0;
}

export function summarizeSpreadAudits(audits = []) {
  const counts = { total: audits.length, works: 0, thin: 0, fails: 0, unproven: 0 };
  for (const a of audits) counts[a.status] = (counts[a.status] || 0) + 1;
  return counts;
}

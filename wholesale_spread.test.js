import { test } from "node:test";
import assert from "node:assert/strict";
import { evaluateWholesaleSpread, summarizeSpreadAudits, maoFromArv } from "./wholesale_spread.js";

test("maoFromArv = ARV*70% - repairs - fee, with sqft fallback for repairs", () => {
  assert.equal(maoFromArv(200000, 30000, { minFee: 10000 }), 100000); // 140k-30k-10k
  assert.equal(maoFromArv(200000, null, { sqft: 1000, rehabPerSqft: 25, minFee: 10000 }), 105000); // repairs 25k
  assert.equal(maoFromArv(50000, 60000, { minFee: 10000 }), 0); // never negative
  assert.equal(maoFromArv(null), null);
});

test("profitable wholesale spread requires buyer price above seller acceptable price", () => {
  const r = evaluateWholesaleSpread({
    arv: 180000,
    repair_estimate: 25000,
    seller_acceptable_price: 85000,
  }, { buyerPct: 70, minFee: 10000 });
  assert.equal(r.status, "works");
  assert.equal(r.inputs.buyerAssignmentPrice, 101000);
  assert.equal(r.anchorSpread, 16000);
  assert.equal(r.projectedSpread, 26200);
  assert.equal(r.profitable, true);
});

test("seller anchor does not kill a middleman deal if a lower acquisition offer can work", () => {
  const r = evaluateWholesaleSpread({
    buyer_offer_price: 80000,
    seller_acceptable_price: 85000,
  }, { minFee: 10000, negotiationDiscountPct: 12 });
  assert.equal(r.status, "thin");
  assert.equal(r.anchorSpread, -5000);
  assert.equal(r.inputs.sellerAnchorPrice, 85000);
  assert.equal(r.inputs.acquisitionOfferPrice, 74800);
  assert.equal(r.projectedSpread, 5200);
  assert.ok(r.reasons.some((x) => x.includes("needs negotiation")));
});

test("explicit 75k acquisition offer is evaluated against buyer side, not seller anchor", () => {
  const r = evaluateWholesaleSpread({
    seller_acceptable_price: 85000,
    offer_amount: 75000,
    assignment_fee: 5000,
  }, { minFee: 10000 });
  assert.equal(r.status, "thin");
  assert.equal(r.anchorSpread, -5000);
  assert.equal(r.projectedSpread, 5000);
  assert.equal(r.inputs.buyerAssignmentPrice, 80000);
  assert.equal(r.inputs.acquisitionOfferPrice, 75000);
  assert.equal(r.inputs.acquisitionOfferSource, "explicit_acquisition_offer");
});

test("negotiation scenarios model seller move, buyer move, and both move", () => {
  const r = evaluateWholesaleSpread({
    buyer_offer_price: 80000,
    buyer_stretch_price: 90000,
    seller_acceptable_price: 85000,
    offer_amount: 75000,
  }, { minFee: 10000 });
  assert.equal(r.negotiation.noMove.spread, -5000);
  assert.equal(r.negotiation.sellerMoves.spread, 5000);
  assert.equal(r.negotiation.buyerMoves.spread, 5000);
  assert.equal(r.negotiation.bothMove.spread, 15000);
  assert.equal(r.negotiation.bothMove.works, true);
  assert.equal(r.bestNegotiationPath.name, "both_move");
});

test("positive but small spread is thin, not a real target-fee deal", () => {
  const r = evaluateWholesaleSpread({
    buyer_offer_price: 95000,
    contract_price: 90000,
  }, { minFee: 10000 });
  assert.equal(r.status, "thin");
  assert.equal(r.projectedSpread, 5000);
});

test("missing seller price makes the deal unproven even with ARV", () => {
  const r = evaluateWholesaleSpread({ arv: 200000, repair_estimate: 30000 }, { minFee: 10000 });
  assert.equal(r.status, "unproven");
  assert.ok(r.reasons.some((x) => x.includes("seller anchor")));
});

test("audit summary counts statuses", () => {
  const audits = [
    evaluateWholesaleSpread({ buyer_offer_price: 120000, seller_acceptable_price: 100000 }),
    evaluateWholesaleSpread({ buyer_offer_price: 95000, seller_acceptable_price: 90000 }),
    evaluateWholesaleSpread({ buyer_offer_price: 80000, contract_price: 90000 }),
    evaluateWholesaleSpread({ arv: 100000 }),
  ];
  assert.deepEqual(summarizeSpreadAudits(audits), { total: 4, works: 2, thin: 0, fails: 1, unproven: 1 });
});

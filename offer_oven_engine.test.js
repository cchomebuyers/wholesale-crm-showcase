// offer_oven_engine.test.js — cent-exact verification of the Offer Oven
// engine against the "Creative Offer Oven" Google Sheet (Creative Calc tab,
// $2.5M / $250k down / 4% / 30yr example — values read straight from the
// sheet's computed cells). Also asserts the FIX for the sheet's balloon
// principal bug: its =SUM(OFFSET($F12,…)) window starts four rows early, so
// principal paid must instead equal loanAmount − balance.
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildLoan, monthlyPayment, addMonths, normalizeDown, validateInputs } from "./public/workspace/js/offer_engine.js";

const cents = (v) => Math.round(v * 100) / 100;
const eq = (a, b, msg) => assert.equal(cents(a), b, `${msg}: got ${cents(a)}, want ${b}`);

const SHEET = {
  purchasePrice: 2500000, downPayment: 250000, annualRate: 4, termYears: 30,
  firstPaymentDate: new Date(2023, 0, 15), // sheet serial 44941
  balloonYears: [7, 8, 12, 29],
};

test("sheet loan: payment and month 1 to the cent", () => {
  const L = buildLoan(SHEET);
  assert.equal(L.errors.length, 0);
  assert.equal(L.loanAmount, 2250000);
  eq(L.pmt, 10741.84, "PMT");
  const m1 = L.schedule[0];
  eq(m1.interest, 7500.00, "month 1 interest");
  eq(m1.principal, 3241.84, "month 1 principal");
  eq(m1.balance, 2246758.16, "month 1 balance");
  assert.equal(m1.date.getTime(), new Date(2023, 0, 15).getTime(), "first payment date");
});

test("sheet loan: balloon years 7 / 8 / 12 / 29 match the sheet's cells", () => {
  const L = buildLoan(SHEET);
  const by = Object.fromEntries(L.balloons.map((b) => [b.year, b]));
  eq(by[7].interestPaid, 588653.00, "yr7 interest");     // H7
  eq(by[7].balance, 1936338.10, "yr7 balance");          // H9
  eq(by[8].interestPaid, 665152.74, "yr8 interest");     // I7
  eq(by[8].balance, 1883935.71, "yr8 balance");          // I9
  eq(by[12].interestPaid, 948914.49, "yr12 interest");   // J7
  eq(by[12].balance, 1652088.93, "yr12 balance");        // J9
  eq(by[29].balance, 126152.16, "yr29 balance");         // K9
});

test("balloon principal is corrected: loanAmount − balance, not the sheet's shifted SUM", () => {
  const L = buildLoan(SHEET);
  for (const b of L.balloons) {
    eq(b.principalPaid, cents(L.loanAmount - b.balance), `yr${b.year} principal identity`);
  }
  const y7 = L.balloons.find((b) => b.year === 7);
  eq(y7.principalPaid, 313661.90, "yr7 true principal");
  // The sheet's buggy cell (H8) says 296654.33 — we must NOT reproduce it.
  assert.notEqual(cents(y7.principalPaid), 296654.33, "sheet bug not reproduced");
});

test("sheet loan: full-term totals and total paid to seller", () => {
  const L = buildLoan(SHEET);
  eq(L.totalInterest, 1617063.89, "total interest");      // M17
  eq(L.totalPrincipal, 2250000.00, "total principal");    // M18
  assert.ok(Math.abs(L.finalBalance) < 0.01, `final balance ~0 (${L.finalBalance})`);
  eq(L.totalToSeller, 4117063.89, "total paid to seller"); // P19
  eq(L.vsCash.delta, 1617063.89, "seller makes this much more than a cash sale");
});

test("balloon dates advance EDATE-style from the first payment", () => {
  const L = buildLoan(SHEET);
  const y7 = L.balloons.find((b) => b.year === 7);
  // payment 84 = first payment + 83 months = 15 Dec 2029 (sheet H6 serial 47467)
  assert.equal(y7.date.getFullYear(), 2029);
  assert.equal(y7.date.getMonth(), 11);
  assert.equal(y7.date.getDate(), 15);
  // month-end clamping: Jan 31 + 1mo = Feb 28
  const clamp = addMonths(new Date(2023, 0, 31), 1);
  assert.equal(`${clamp.getMonth()}-${clamp.getDate()}`, "1-28");
});

test("interest-only: $425k at 5% = $1,770.83/mo, balance never moves", () => {
  eq(monthlyPayment(425000, 5, 30, "interest_only"), 1770.83, "IO payment");
  const L = buildLoan({ purchasePrice: 425000, downPayment: 0, annualRate: 5, termYears: 30,
    loanType: "interest_only", firstPaymentDate: new Date(2026, 0, 1), balloonYears: [5] });
  eq(L.pmt, 1770.83, "IO payment via buildLoan");
  assert.equal(L.schedule[59].balance, 425000, "balance flat");
  assert.equal(L.balloons[0].balance, 425000, "balloon = full loan amount");
  assert.equal(L.balloons[0].principalPaid, 0, "no principal in IO");
});

test("zero-rate loan amortizes straight-line", () => {
  const L = buildLoan({ purchasePrice: 120000, downPayment: 0, annualRate: 0, termYears: 10,
    firstPaymentDate: new Date(2026, 0, 1) });
  eq(L.pmt, 1000, "120k over 120 months");
  assert.ok(Math.abs(L.finalBalance) < 0.01, "lands on zero");
  assert.equal(cents(L.schedule[0].interest), 0, "no interest at 0%");
});

test("down payment accepted as dollars or percent, both reported", () => {
  assert.deepEqual(normalizeDown(2500000, { downPayment: 250000 }), { amount: 250000, pct: 10 });
  assert.deepEqual(normalizeDown(2500000, { downPaymentPct: 10 }), { amount: 250000, pct: 10 });
  const L = buildLoan({ ...SHEET, downPayment: undefined, downPaymentPct: 10 });
  assert.equal(L.loanAmount, 2250000, "percent path builds the same loan");
  assert.ok(buildLoan({ ...SHEET, downPayment: 500000 }).downWarning, ">15% flags high entry");
});

test("cash-flow layer: rent − PITI − other, CoC on down + assignment fee", () => {
  const L = buildLoan({ purchasePrice: 100000, downPayment: 10000, annualRate: 0, termYears: 10,
    firstPaymentDate: new Date(2026, 0, 1),
    monthlyRent: 1500, monthlyTaxes: 150, monthlyInsurance: 100, otherMonthlyCosts: 50, assignmentFee: 5000 });
  // pmt = 90000/120 = 750 → cashflow = 1500 − 750 − 150 − 100 − 50 = 450
  eq(L.cash.monthlyCashFlow, 450, "monthly cash flow");
  eq(L.cash.cashOnCash, cents(450 * 12 / 15000 * 100), "CoC on down+fee");
  assert.equal(L.cash.pitiFlag, false, "PITI 1000/1500 = 66.7% — under 75%");
  const hot = buildLoan({ purchasePrice: 200000, downPayment: 10000, annualRate: 6, termYears: 30,
    firstPaymentDate: new Date(2026, 0, 1), monthlyRent: 1300, monthlyTaxes: 200, monthlyInsurance: 100 });
  assert.equal(hot.cash.pitiFlag, true, "PITI over 75% of rent flags red");
});

test("validation guardrails", () => {
  assert.ok(validateInputs({ purchasePrice: 100000, downPayment: 100000, annualRate: 5, termYears: 30 })
    .some((e) => /down payment/.test(e)), "down must be below price");
  assert.ok(validateInputs({ purchasePrice: 100000, downPayment: 0, annualRate: 25, termYears: 30 })
    .some((e) => /rate/.test(e)), "rate capped at 20%");
  assert.ok(validateInputs({ purchasePrice: 100000, downPayment: 0, annualRate: 5, termYears: 50 })
    .some((e) => /term/.test(e)), "term capped at 40yrs");
  assert.ok(validateInputs({ purchasePrice: 100000, downPayment: 0, annualRate: 5, termYears: 30, balloonYears: [31] })
    .some((e) => /balloon/.test(e)), "balloon must fit the term");
  assert.equal(validateInputs(SHEET).length, 0, "the sheet's own example validates clean");
});

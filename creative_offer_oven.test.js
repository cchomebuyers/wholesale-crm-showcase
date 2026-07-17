// creative_offer_oven.test.js — backtests for the Offer Oven's math
// (public/workspace/js/oven_calc.js). Expected values are hand-computed or
// standard mortgage-table constants, plus round-trip identities: offering
// exactly the CoC-ceiling MAO must produce exactly the target CoC.
import { test } from "node:test";
import assert from "node:assert/strict";
import { pmt, rentalModel, cashDeal, financedDeal } from "./public/workspace/js/oven_calc.js";

const close = (a, b, eps, msg) => assert.ok(Math.abs(a - b) <= eps, `${msg}: ${a} !≈ ${b}`);

// $100k @ 6%/30yr = $599.55/mo — standard mortgage-table constant.
test("pmt matches mortgage tables", () => {
  close(pmt(100000, 6, 30), 599.55, 0.01, "6%/30yr");
  close(pmt(85000, 4, 30), 405.80, 0.5, "4%/30yr");
  close(pmt(100000, 0, 30), 277.78, 0.01, "0% amortizes straight-line");
  close(pmt(50000, 8, 30, true), 333.33, 0.01, "interest-only = P×r/12");
  assert.equal(pmt(100000, 5, 0), 0, "zero-year term never divides by zero");
});

// rent 1000, vac 5%, mgmt 8%, maint 5%, capex 5%, tax 150, ins 100, debt 300:
// EGI 950 · opex 430 · NOI 520 · cashflow 220 — hand-computed.
test("rentalModel waterfall", () => {
  const m = rentalModel({ rent: 1000, vac: 5, mgmt: 8, maint: 5, capex: 5, tax: 150, ins: 100 }, 300);
  close(m.egi, 950, 0.001, "EGI");
  close(m.opex, 430, 0.001, "opex");
  close(m.noiMo, 520, 0.001, "NOI");
  close(m.cashflowMo, 220, 0.001, "cashflow");
});

const RENTAL = { rent: 1300, vac: 5, mgmt: 8, maint: 5, capex: 5, tax: 150, ins: 100 };
// NOI = 1235 − 484 = 751/mo for RENTAL — used by the deals below.

test("cash deal: ARV-rule MAO and buyer economics", () => {
  const d = cashDeal({ arv: 150000, maoPct: 70, repairs: 30000, wfee: 10000, closing: 3000, offer: 60000, cocTarget: 0, rental: RENTAL });
  close(d.maoArv, 65000, 0.001, "ARV rule: 150k×70% − 30k − 10k");
  assert.equal(d.binding, "arv", "no CoC target → ARV rule binds");
  close(d.mao, 65000, 0.001, "MAO");
  close(d.margin, 5000, 0.001, "60k offer sits 5k under");
  close(d.buyerPrice, 70000, 0.001, "buyer pays offer + fee");
  close(d.cashInvested, 103000, 0.001, "buyer all-in");
  close(d.capRate, 751 * 12 / 70000 * 100, 0.01, "cap on buyer price");
  close(d.coc, 751 * 12 / 103000 * 100, 0.01, "all-cash CoC");
  close(d.onePct, 1300 / 70000 * 100, 0.001, "1% rule");
});

test("cash deal round-trip: offering the CoC-ceiling MAO yields exactly the target", () => {
  const gate = cashDeal({ arv: 150000, maoPct: 70, repairs: 30000, wfee: 10000, closing: 3000, offer: 0, cocTarget: 10, rental: RENTAL });
  close(gate.maoCashflow, 47120, 0.5, "ceiling: 9012/0.10 − 43k");
  assert.equal(gate.binding, "cashflow", "10% target binds below the ARV rule");
  const at = cashDeal({ arv: 150000, maoPct: 70, repairs: 30000, wfee: 10000, closing: 3000, offer: gate.maoCashflow, cocTarget: 10, rental: RENTAL });
  close(at.coc, 10, 0.001, "CoC at the ceiling == target");
});

test("subto: takeover payment, honest CoC, max-down round-trip", () => {
  const i = { purchase: 100000, down: 10000, subtoBal: 80000, subtoPmt: 600, entry: 3000, closing: 2000, cocTarget: 14.7, rental: RENTAL };
  const d = financedDeal(i, "subto");
  close(d.monthlyPmt, 600, 0.001, "no new note in pure subto");
  assert.equal(d.sfLoan, 0, "no seller note");
  close(d.cashflowMo, 151, 0.001, "751 NOI − 600 takeover");
  close(d.cashIn, 15000, 0.001, "entry+down+closing");
  close(d.coc, 151 * 12 / 15000 * 100, 0.01, "CoC on total cash in");
  close(d.dscr, 751 / 600, 0.001, "DSCR");
  close(d.maxDown, 151 * 12 / 0.147 - 5000, 1, "max cash to seller at 14.7%");
  const at = financedDeal({ ...i, down: d.maxDown }, "subto");
  close(at.coc, 14.7, 0.001, "down == maxDown hits the target exactly");
});

test("seller finance: note = purchase − down, amortized and interest-only", () => {
  const d = financedDeal({ purchase: 90000, down: 5000, rate: 4, amort: 30, rental: RENTAL }, "sellerfinance");
  assert.equal(d.sfLoan, 85000, "note principal");
  close(d.sfPmt, 405.80, 0.5, "note payment @4%/30yr");
  close(d.dscr, 751 / d.sfPmt, 0.001, "DSCR vs the note");
  const io = financedDeal({ purchase: 90000, down: 5000, rate: 4, amort: 30, io: true, rental: RENTAL }, "sellerfinance");
  close(io.sfPmt, 283.33, 0.01, "interest-only note");
  // subto fields must not leak into a pure seller-finance deal
  assert.equal(financedDeal({ purchase: 90000, down: 5000, rate: 4, amort: 30, subtoPmt: 999, rental: RENTAL }, "sellerfinance").monthlyPmt, d.monthlyPmt);
});

test("hybrid: seller note covers the equity gap over the subto balance", () => {
  const d = financedDeal({ purchase: 120000, down: 8000, subtoBal: 70000, subtoPmt: 520, rate: 5, amort: 20, rental: RENTAL }, "hybrid");
  assert.equal(d.sfLoan, 42000, "120k − 8k − 70k");
  close(d.monthlyPmt, 520 + pmt(42000, 5, 20), 0.01, "takeover + note");
  close(d.totalLoan, 112000, 0.001, "both debts carried");
  const clamped = financedDeal({ purchase: 120000, down: 8000, subtoBal: 130000, rate: 5, amort: 20, rental: RENTAL }, "hybrid");
  assert.equal(clamped.sfLoan, 0, "note never goes negative");
});

test("cash to seller nets out the agent commission; appreciation compounds", () => {
  const d = financedDeal({ purchase: 100000, down: 10000, comm: 3, listed: 100000, appr: 4, apprYrs: 5, rental: RENTAL }, "subto");
  close(d.cashToSeller, 7000, 0.001, "10k down − 3% of 100k");
  close(d.future, 100000 * 1.04 ** 5, 0.01, "compounded 5yr value");
});

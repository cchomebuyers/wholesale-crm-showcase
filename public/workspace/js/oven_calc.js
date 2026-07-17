// oven_calc.js — the Creative Offer Oven's math, pure and testable.
// Ported 1:1 from the verified Deal Calc in public/app.js (runCashCalc /
// runDealCalc / rentalModel / pmt, app.js:1160-1355) so both calculators agree.
// No DOM, no state — every function is (inputs) → numbers, exercised by
// creative_offer_oven.test.js at the repo root.

const n = (v) => Number(v) || 0;

/** Standard mortgage payment. Interest-only returns principal × monthly rate. */
export function pmt(principal, annualRatePct, years, interestOnly = false) {
  const P = n(principal), r = n(annualRatePct) / 100 / 12, months = n(years) * 12;
  if (interestOnly) return P * r;
  if (!months) return 0;
  if (r === 0) return P / months;
  return (P * r) / (1 - Math.pow(1 + r, -months));
}

/** Rent → vacancy → EGI → opex (tax/ins/hoa/other + mgmt/maint/capex % of rent)
    → NOI → debt → cash flow. Industry-standard defaults: vac 5, mgmt 8,
    maint 5, capex 5 (all % of gross rent); tax/ins/hoa/other are $/mo. */
export function rentalModel(r = {}, debtMonthly = 0) {
  const rent = n(r.rent);
  const vacLoss = n(r.vac) / 100 * rent;
  const egi = rent - vacLoss;
  const mgmt = n(r.mgmt) / 100 * rent;
  const maint = n(r.maint) / 100 * rent;
  const capex = n(r.capex) / 100 * rent;
  const tax = n(r.tax), ins = n(r.ins), hoa = n(r.hoa), other = n(r.other);
  const opex = tax + ins + hoa + other + mgmt + maint + capex;
  const noiMo = egi - opex;
  const debt = n(debtMonthly);
  return { rent, vacLoss, egi, tax, ins, hoa, other, mgmt, maint, capex, opex, noiMo, debtMonthly: debt, cashflowMo: noiMo - debt };
}

/** Cash / traditional wholesale. The MAO is min(ARV rule, CoC ceiling):
    ARV rule = ARV × maoPct − repairs − fee. CoC ceiling solves
    annual cashflow ÷ (offer + fee + repairs + closing) = target for offer.
    The buyer pays your offer + fee, so their economics gate your ceiling. */
export function cashDeal(i = {}) {
  const arv = n(i.arv), repairs = n(i.repairs), maoPct = n(i.maoPct) || 70;
  const wfee = n(i.wfee), offer = n(i.offer), closing = n(i.closing);
  const target = n(i.cocTarget);
  const model = rentalModel(i.rental, 0);
  const { cashflowMo } = model;
  const buyerPrice = offer + wfee;
  const cashInvested = buyerPrice + repairs + closing;
  const noiAnnual = model.noiMo * 12;
  const capRate = buyerPrice ? noiAnnual / buyerPrice * 100 : 0;
  const coc = cashInvested ? (cashflowMo * 12) / cashInvested * 100 : 0;
  const onePct = buyerPrice ? model.rent / buyerPrice * 100 : 0;

  const maoArv = arv * maoPct / 100 - repairs - wfee;
  const maxAllIn = target > 0 ? (cashflowMo * 12) / (target / 100) : Infinity;
  const maoCashflow = cashflowMo > 0 && target > 0 ? maxAllIn - wfee - repairs - closing : (target > 0 ? -Infinity : Infinity);
  const mao = Math.min(maoArv, maoCashflow);
  return {
    model, buyerPrice, cashInvested, capRate, coc, onePct,
    maoArv, maoCashflow, mao,
    binding: maoCashflow < maoArv ? "cashflow" : "arv",
    margin: mao - offer, // positive = your offer sits under the ceiling
  };
}

/** Creative finance: 'subto' | 'sellerfinance' | 'hybrid'.
    Subto: take over existing loan payments (loan stays in seller's name).
    Seller finance: seller carries a new note = purchase − down.
    Hybrid: subto the existing balance + seller note for the leftover equity.
    CoC is honest: annual cashflow ÷ TOTAL cash in (entry + down + rehab +
    assignment + closing). maxDown = the most cash-to-seller that still clears
    the CoC target — the negotiating lever in a takeover. */
export function financedDeal(i = {}, type = "subto") {
  const purchase = n(i.purchase), down = n(i.down);
  const subtoBal = n(i.subtoBal) + n(i.subtoBal2);
  const subtoMonthly = n(i.subtoPmt) + n(i.subtoPmt2);
  const usesSubto = type !== "sellerfinance";
  const usesSF = type !== "subto";
  let sfLoan = 0;
  if (type === "sellerfinance") sfLoan = Math.max(0, purchase - down);
  else if (type === "hybrid") sfLoan = Math.max(0, purchase - down - subtoBal);
  const sfPmt = usesSF && sfLoan > 0 ? pmt(sfLoan, i.rate, n(i.amort) || 30, !!i.io) : 0;
  const monthlyPmt = (usesSubto ? subtoMonthly : 0) + sfPmt;
  const totalLoan = (usesSubto ? subtoBal : 0) + (usesSF ? sfLoan : 0);

  const model = rentalModel(i.rental, monthlyPmt);
  const { cashflowMo } = model;
  const noiAnnual = model.noiMo * 12;
  const target = n(i.cocTarget);

  const cashOps = n(i.entry) + n(i.rehab) + n(i.assign) + n(i.closing);
  const cashIn = cashOps + down;
  const coc = cashIn ? (cashflowMo * 12) / cashIn * 100 : 0;
  const maxCashIn = target > 0 ? (cashflowMo * 12) / (target / 100) : Infinity;
  const maxDown = cashflowMo > 0 ? maxCashIn - cashOps : -Infinity;
  const capRate = purchase ? noiAnnual / purchase * 100 : 0;
  const dscr = monthlyPmt ? model.noiMo / monthlyPmt : null;
  const commission = purchase * n(i.comm) / 100;
  const cashToSeller = down - commission;
  const listed = n(i.listed);
  const future = listed * Math.pow(1 + n(i.appr) / 100, n(i.apprYrs));
  return {
    model, type, sfLoan, sfPmt, subtoBal: usesSubto ? subtoBal : 0,
    monthlyPmt, totalLoan, cashflowMo, coc, cashIn, maxDown,
    capRate, dscr, cashToSeller, future, appreciationGain: future - listed,
  };
}

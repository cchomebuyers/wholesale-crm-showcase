// offer_engine.js — the Offer Oven's seller-finance engine, pure and exact.
// Modeled on the "Creative Offer Oven" sheet (Creative Calc + Cash On Cash
// tabs) and verified to the cent against it by offer_oven_engine.test.js.
// One deliberate divergence: the sheet's balloon "Principal Paid" formula
// anchors its SUM window at $F12 instead of $F16 (four rows early), so it
// under-reports principal — here principal paid ALWAYS equals
// loanAmount − outstanding balance. No DOM, no state.

const num = (v) => Number(v) || 0;

/** EDATE-style month advance: keeps the day of month, clamping to the last
    day of shorter months (Jan 31 → Feb 28). */
export function addMonths(date, months) {
  const d = new Date(date.getTime());
  const day = d.getDate();
  d.setDate(1);
  d.setMonth(d.getMonth() + months);
  const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  d.setDate(Math.min(day, last));
  return d;
}

/** Amortizing payment: L·r / (1 − (1+r)^−n); r = 0 → straight-line L/n. */
export function monthlyPayment(loanAmount, annualRatePct, termYears, loanType = "amortizing") {
  const L = num(loanAmount), r = num(annualRatePct) / 100 / 12, n = Math.round(num(termYears) * 12);
  if (loanType === "interest_only") return L * r;
  if (!n) return 0;
  if (r === 0) return L / n;
  return (L * r) / (1 - Math.pow(1 + r, -n));
}

/** Accept down as dollars or percent; report both. Percent wins if both set. */
export function normalizeDown(purchasePrice, { downPayment, downPaymentPct } = {}) {
  const price = num(purchasePrice);
  if (downPaymentPct != null && downPaymentPct !== "") {
    const pct = num(downPaymentPct);
    return { amount: price * pct / 100, pct };
  }
  const amount = num(downPayment);
  return { amount, pct: price ? amount / price * 100 : 0 };
}

export function validateInputs(i = {}) {
  const errors = [];
  const price = num(i.purchasePrice);
  const { amount: down } = normalizeDown(price, i);
  if (!(price > 0)) errors.push("purchase price must be positive");
  if (down < 0 || down >= price) errors.push("down payment must be below the purchase price");
  const rate = num(i.annualRate);
  if (rate < 0 || rate > 20) errors.push("rate must be between 0% and 20%");
  const term = num(i.termYears);
  if (!(term >= 1 && term <= 40)) errors.push("term must be 1–40 years");
  const balloons = (i.balloonYears || []).map(num).filter((y) => y > 0);
  if (balloons.length > 4) errors.push("at most 4 balloon years");
  for (const y of balloons) if (y > term) errors.push(`balloon year ${y} exceeds the ${term}-year term`);
  return errors;
}

/** The whole loan: full schedule, yearly aggregates, balloon scenarios,
    total-to-seller, and the optional cash-flow layer. Full precision is
    carried internally; round only at display time. */
export function buildLoan(i = {}) {
  const errors = validateInputs(i);
  const price = num(i.purchasePrice);
  const down = normalizeDown(price, i);
  const loanAmount = price - down.amount;
  const termYears = Math.max(1, Math.round(num(i.termYears) || 30));
  const n = termYears * 12;
  const r = num(i.annualRate) / 100 / 12;
  const loanType = i.loanType === "interest_only" ? "interest_only" : "amortizing";
  const pmt = monthlyPayment(loanAmount, i.annualRate, termYears, loanType);
  const first = i.firstPaymentDate instanceof Date ? i.firstPaymentDate
    : i.firstPaymentDate ? new Date(i.firstPaymentDate) : new Date();

  const schedule = [];
  let balance = loanAmount, cumInterest = 0, cumPrincipal = 0;
  for (let k = 1; k <= n; k++) {
    const interest = balance * r;
    const principal = loanType === "interest_only" ? 0 : pmt - interest;
    balance -= principal;
    cumInterest += interest;
    cumPrincipal += principal;
    schedule.push({ n: k, date: addMonths(first, k - 1), payment: pmt, interest, principal,
      balance, cumInterest, cumPrincipal });
  }
  const last = schedule[n - 1] || { balance: loanAmount, cumInterest: 0, cumPrincipal: 0 };

  const years = [];
  for (let y = 1; y <= termYears; y++) {
    const rows = schedule.slice((y - 1) * 12, y * 12);
    if (!rows.length) break;
    years.push({
      year: y, date: rows[rows.length - 1].date,
      paid: rows.reduce((s, x) => s + x.payment, 0),
      interest: rows.reduce((s, x) => s + x.interest, 0),
      principal: rows.reduce((s, x) => s + x.principal, 0),
      balance: rows[rows.length - 1].balance,
      months: rows,
    });
  }

  // At a balloon the seller has received: down + every payment so far + the
  // payoff. principal + balance always reconstitutes loanAmount, so
  // totalToSeller(Y) = down + interest(Y) + loanAmount — the corrected math.
  const atMonth = (m) => {
    const row = schedule[Math.min(m, n) - 1];
    const bal = loanType === "interest_only" ? loanAmount : row.balance;
    return {
      date: row.date, balance: bal,
      interestPaid: row.cumInterest,
      principalPaid: loanAmount - bal,
      totalToSeller: down.amount + row.cumInterest + loanAmount,
    };
  };
  const balloons = (i.balloonYears || []).map(num).filter((y) => y > 0 && y <= termYears)
    .sort((a, b) => a - b)
    .map((year) => ({ year, ...atMonth(year * 12) }));

  const finalBalance = loanType === "interest_only" ? loanAmount : last.balance;
  const totalToSeller = down.amount + last.cumInterest + loanAmount;

  // Cash-flow layer (Cash On Cash tab, simplified per spec): PITI vs rent.
  let cash = null;
  if (num(i.monthlyRent) > 0) {
    const rent = num(i.monthlyRent), taxes = num(i.monthlyTaxes), ins = num(i.monthlyInsurance), other = num(i.otherMonthlyCosts);
    const monthlyCashFlow = rent - pmt - taxes - ins - other;
    const entry = down.amount + num(i.assignmentFee);
    const piti = pmt + taxes + ins;
    cash = {
      monthlyCashFlow, annualCashFlow: monthlyCashFlow * 12,
      cashOnCash: entry ? (monthlyCashFlow * 12) / entry * 100 : 0,
      piti, pitiPctOfRent: rent ? piti / rent * 100 : 0,
      pitiFlag: rent ? piti > rent * 0.75 : false,
    };
  }

  return {
    errors, loanType, purchasePrice: price, downPayment: down.amount, downPct: down.pct,
    downWarning: down.pct > 15, loanAmount, annualRate: num(i.annualRate), termYears,
    pmt, schedule, years, balloons, finalBalance,
    totalInterest: last.cumInterest, totalPrincipal: loanType === "interest_only" ? 0 : last.cumPrincipal,
    totalToSeller,
    vsCash: { delta: totalToSeller - price, pct: price ? (totalToSeller - price) / price * 100 : 0 },
    cash,
  };
}

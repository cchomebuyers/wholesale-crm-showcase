// oven_structures.js — the quick structure-compare screen inside the Oven:
// cash / seller-finance / subject-to / hybrid analysis on one set of numbers.
// Math in ../oven_calc.js (backtested by creative_offer_oven.test.js).
// Mounted as a segment of views/oven.js — the seller-finance staple screen
// (offer_engine.js) is the Oven's default.
import { el } from "../ui.js";
import { cashDeal, financedDeal } from "../oven_calc.js";

const TYPES = [
  { key: "cash", glyph: "💵", label: "Cash",
    hint: "Traditional wholesale: lock it up cheap, assign to a cash buyer. MAO = the lower of the ARV rule (ARV × % − repairs − your fee) and the optional cash-on-cash ceiling. Leave the CoC gate at 0 for wholesale volume; set it (e.g. 14.7) only for keeper deals — all-cash CoC equals cap rate, so a high gate forces very low offers." },
  { key: "sellerfinance", glyph: "📜", label: "Seller Finance",
    hint: "The seller becomes the bank: you agree on price, down, rate, and amortization, and they carry a note for the rest. Works best free-and-clear. Watch DSCR and the CoC target — the down payment is your lever." },
  { key: "subto", glyph: "🏠", label: "Subject-To",
    hint: "You take over the seller's existing mortgage payments — the loan stays in their name. Equity is thin, so the return must come from cash flow: the 'max cash to seller' card is the most down payment that still clears your CoC target." },
  { key: "hybrid", glyph: "🔀", label: "Hybrid",
    hint: "Subject-To the existing balance AND the seller finances the leftover equity as a second note. Fill in both the existing-loan and seller-note sections; the note principal is computed as purchase − down − loan balance." },
];

// field spec: [key, label, default, title?]
const DEAL = [
  ["arv", "ARV $", 150000, "after-repair value — what it's worth fixed up"],
  ["repairs", "Repairs $", 30000], ["listed", "Listed / asking $", 100000],
  ["offer", "Your offer $", 65000], ["closing", "Closing costs $", 3000],
];
const CASH = [
  ["maoPct", "MAO % of ARV", 70, "70 is standard; drop to 65 in rough areas"],
  ["wfee", "Your wholesale fee $", 10000],
  ["cocTargetCash", "CoC gate % (0 = off)", 0, "0 for wholesale volume — set 14.7 only for keeper deals"],
];
const CREATIVE = [
  ["down", "Down / cash to seller $", 5000], ["entry", "Entry fee $", 0],
  ["rehab", "Rehab budget $", 0], ["assign", "Assignment fee $", 0],
  ["comm", "Agent commission %", 0], ["cocTarget", "CoC target %", 14.7],
  ["appr", "Appreciation %/yr", 3], ["apprYrs", "Hold years", 5],
];
const SUBTO = [
  ["subtoBal", "Loan 1 balance $", 60000], ["subtoPmt", "Loan 1 payment $/mo", 550],
  ["subtoBal2", "Loan 2 balance $", 0], ["subtoPmt2", "Loan 2 payment $/mo", 0],
];
const NOTE = [
  ["rate", "Note rate %", 5], ["amort", "Amortization yrs", 30],
];
const RENTAL = [
  ["rent", "Rent $/mo", 1300], ["tax", "Property tax $/mo", 150],
  ["ins", "Insurance $/mo", 100], ["hoa", "HOA $/mo", 0], ["other", "Other $/mo", 0],
  ["vac", "Vacancy %", 5], ["mgmt", "Management %", 8],
  ["maint", "Maintenance %", 5], ["capex", "CapEx %", 5],
];
const ALL = [...DEAL, ...CASH, ...CREATIVE, ...SUBTO, ...NOTE, ...RENTAL];

const LS = "ovenInputs.v1";
function loadState() {
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(LS) || "{}"); } catch { /* fresh */ }
  const s = { type: TYPES.some((t) => t.key === saved.type) ? saved.type : "cash", io: !!saved.io };
  for (const [k, , def] of ALL) s[k] = typeof saved[k] === "number" ? saved[k] : def;
  return s;
}
const state = loadState();
const save = () => localStorage.setItem(LS, JSON.stringify(state));

const money = (v) => (v == null || !isFinite(v)) ? "—" : (v < 0 ? "−$" : "$") + Math.round(Math.abs(v)).toLocaleString("en-US");
const pct = (v) => isFinite(v) ? v.toFixed(1) + "%" : "—";

export function mount(root) {
  root.append(
    typeBar(root),
    el("p", { class: "engine-hint", id: "ovenHint" }, cur().hint),
    el("div", { class: "oven-grid" },
      el("div", { id: "ovenInputs" }),
      el("div", { id: "ovenResults" })),
  );
  renderInputs(root);
  recompute(root);
}

const cur = () => TYPES.find((t) => t.key === state.type);

function typeBar(root) {
  return el("div", { class: "engine-buckets", id: "ovenTypes" },
    TYPES.map((t) => el("button", {
      class: "ebucket", "aria-current": String(t.key === state.type),
      onclick: (e) => {
        state.type = t.key; save();
        for (const b of root.querySelectorAll("#ovenTypes .ebucket")) b.setAttribute("aria-current", "false");
        e.currentTarget.setAttribute("aria-current", "true");
        root.querySelector("#ovenHint").textContent = cur().hint;
        renderInputs(root); recompute(root);
      },
    }, `${t.glyph} ${t.label}`)));
}

function renderInputs(root) {
  const host = root.querySelector("#ovenInputs");
  const isCash = state.type === "cash";
  const usesSubto = state.type === "subto" || state.type === "hybrid";
  const usesNote = state.type === "sellerfinance" || state.type === "hybrid";
  const groups = [
    ["Deal", DEAL.map((f) => isCash || f[0] !== "offer" ? f : [f[0], "Purchase price $", f[2], f[3]])],
    isCash ? ["Cash offer", CASH] : ["Creative terms", CREATIVE],
    usesSubto ? ["Existing loans (taken over)", SUBTO] : null,
    usesNote ? ["Seller note", NOTE] : null,
    ["Rental underwriting", RENTAL],
  ].filter(Boolean);
  host.replaceChildren(...groups.map(([name, fields]) => el("div", { class: "glass oven-fs" },
    el("h4", {}, name),
    el("div", { class: "oven-fields" },
      fields.map(([k, label, , tip]) => el("label", { class: "oven-f", title: tip || null },
        el("span", {}, label),
        el("input", { type: "number", step: "any", value: String(state[k]),
          oninput: (e) => { state[k] = parseFloat(e.target.value) || 0; save(); recompute(root); } }))),
      name === "Seller note" ? el("label", { class: "oven-f oven-check" },
        el("input", { type: "checkbox", ...(state.io ? { checked: "" } : {}),
          onchange: (e) => { state.io = e.target.checked; save(); recompute(root); } }),
        el("span", {}, "interest-only")) : null))));
  host.append(el("button", { class: "btn-ghost showmore", onclick: () => {
    const fresh = {}; for (const [k, , def] of ALL) fresh[k] = def;
    Object.assign(state, fresh, { io: false }); save(); renderInputs(root); recompute(root);
  } }, "↺ Reset to defaults"));
}

function recompute(root) {
  const out = root.querySelector("#ovenResults");
  if (!out) return;
  const rental = Object.fromEntries(RENTAL.map(([k]) => [k, state[k]]));
  if (state.type === "cash") {
    const d = cashDeal({ ...state, cocTarget: state.cocTargetCash, rental });
    out.replaceChildren(...cashResults(d));
  } else {
    const d = financedDeal({ ...state, purchase: state.offer, rental }, state.type);
    out.replaceChildren(...financedResults(d));
  }
}

const stat = (label, value, cls = "") => el("div", { class: "oven-stat" },
  el("b", { class: cls }, value), el("span", {}, label));
const posneg = (v) => v >= 0 ? "pos" : "neg";

function cashResults(d) {
  const gated = isFinite(d.maoCashflow) && d.maoCashflow !== Infinity;
  return [
    el("div", { class: "glass oven-hero" },
      el("span", { class: "oh-label" }, "Max Allowable Offer"),
      el("b", { class: "oh-num" }, money(d.mao)),
      el("span", { class: "oh-sub" },
        `ARV rule ${money(d.maoArv)}${gated ? ` · CoC ceiling ${money(d.maoCashflow)}` : ""} — ${d.binding === "arv" ? "ARV is the limiter" : "cashflow is the limiter"}`),
      el("span", { class: "oh-sub " + posneg(d.margin) },
        d.margin >= 0 ? `your offer sits ${money(d.margin)} UNDER the ceiling ✓` : `your offer is ${money(-d.margin)} OVER the ceiling ✗`)),
    el("div", { class: "oven-stats" },
      stat("monthly cash flow (buyer)", money(d.model.cashflowMo) + "/mo", posneg(d.model.cashflowMo)),
      stat("cap rate (buyer price)", pct(d.capRate)),
      stat("all-cash CoC", pct(d.coc)),
      stat("1% rule", isFinite(d.onePct) ? d.onePct.toFixed(2) + "%" : "—"),
      stat("buyer pays (offer + fee)", money(d.buyerPrice)),
      stat("buyer all-in", money(d.cashInvested))),
    waterfall(d.model),
  ];
}

function financedResults(d) {
  const target = state.cocTarget;
  const cocOk = d.coc >= target;
  return [
    el("div", { class: "glass oven-hero" },
      el("span", { class: "oh-label" }, "Monthly cash flow"),
      el("b", { class: "oh-num " + posneg(d.cashflowMo) }, money(d.cashflowMo) + "/mo"),
      el("span", { class: "oh-sub" }, `${money(d.cashflowMo * 12)}/yr after ${money(d.monthlyPmt)}/mo debt service`),
      el("span", { class: "oh-sub " + (cocOk ? "pos" : "neg") },
        `cash-on-cash ${pct(d.coc)} vs ${pct(target)} target ${cocOk ? "✓" : "✗"}`)),
    el("div", { class: "oven-stats" },
      stat(`max cash to seller @ ${pct(target)}`, d.cashflowMo > 0 && isFinite(d.maxDown) ? money(d.maxDown) : "needs cashflow",
        state.down <= d.maxDown && d.cashflowMo > 0 ? "pos" : "neg"),
      stat("total cash in", money(d.cashIn)),
      stat("DSCR", d.dscr == null ? "—" : d.dscr.toFixed(2), d.dscr != null ? (d.dscr >= 1.2 ? "pos" : d.dscr < 1 ? "neg" : "") : ""),
      stat("debt carried", money(d.totalLoan)),
      d.sfLoan ? stat("seller note (pmt)", `${money(d.sfLoan)} (${money(d.sfPmt)}/mo)`) : null,
      stat("seller nets (after comm.)", money(d.cashToSeller)),
      stat(`value in ${state.apprYrs}yr @ ${state.appr}%`, `${money(d.future)} (+${money(d.appreciationGain)})`),
      stat("cap rate", pct(d.capRate))),
    waterfall(d.model),
  ];
}

function waterfall(m) {
  const row = (label, v, neg) => el("div", { class: "cfb-row" + (neg ? " neg" : "") },
    el("span", {}, label), el("span", {}, (neg ? "− " : "") + money(Math.abs(v))));
  const sub = (label, v) => el("div", { class: "cfb-row sub" }, el("span", {}, label), el("span", {}, money(v)));
  const kids = [row("Gross rent", m.rent)];
  if (m.vacLoss) kids.push(row(`Vacancy (${state.vac}%)`, m.vacLoss, true));
  kids.push(sub("Effective income", m.egi));
  for (const [v, l] of [[m.tax, "Property tax"], [m.ins, "Insurance"], [m.hoa, "HOA"], [m.other, "Other"],
    [m.mgmt, `Management (${state.mgmt}%)`], [m.maint, `Maintenance (${state.maint}%)`], [m.capex, `CapEx (${state.capex}%)`]]) {
    if (v) kids.push(row(l, v, true));
  }
  kids.push(sub("NOI (before debt)", m.noiMo));
  if (m.debtMonthly) kids.push(row("Debt service", m.debtMonthly, true));
  kids.push(el("div", { class: "cfb-row total " + posneg(m.cashflowMo) },
    el("span", {}, "Monthly cash flow"), el("span", {}, money(m.cashflowMo) + "/mo")));
  return el("div", { class: "glass oven-cfb" }, el("h4", {}, "💵 Cash-flow breakdown (monthly)"), ...kids);
}

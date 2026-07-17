// Oven — the Creative Offer Oven, rebuilt around the seller-finance staple
// (the "Creative Calc" sheet, engine in ../offer_engine.js, cent-verified by
// offer_oven_engine.test.js). Live single-screen calculator: inputs left,
// results right, no calculate button. The headline is the pitch number —
// TOTAL PAID TO SELLER vs a cash sale. Scenarios save to deal records via
// /api/offer-scenarios. The quick structure-compare screen (cash/subto/
// hybrid, oven_calc.js) lives in the second segment.
import { el, toast, modal, field } from "../ui.js";
import { buildLoan } from "../offer_engine.js";
import { get, post, del } from "../api.js";
import * as structures from "./oven_structures.js";

export const title = "Offer Oven";
export const icon = "M12 3c1 4-4 6-4 10a4 4 0 008 0c0-2-1.2-3.2-1.2-3.2C17.5 11 19 13 19 15a7 7 0 11-14 0c0-6 6-8 7-12z";

// ---- formatting: CAD currency, DD/MM/YYYY dates --------------------------------
const cad0 = new Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD", maximumFractionDigits: 0 });
const cad2 = new Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD", minimumFractionDigits: 2, maximumFractionDigits: 2 });
const $0 = (v) => isFinite(v) ? cad0.format(v) : "—";
const $2 = (v) => isFinite(v) ? cad2.format(v) : "—";
const dmy = (d) => d instanceof Date && !isNaN(d) ? d.toLocaleDateString("en-GB") : "—";
const iso = (d) => d.toISOString().slice(0, 10);

// ---- state (persists across tab switches) --------------------------------------
const DEF = {
  screen: "seller", purchasePrice: 2500000, downPayment: 250000, downMode: "amount",
  annualRate: 4, termYears: 30, firstPaymentDate: iso(new Date()),
  loanType: "amortizing", balloonYears: [7, "", "", ""], pitch: 0, // 0 = full term, else balloon year
  monthlyRent: "", monthlyTaxes: "", monthlyInsurance: "", otherMonthlyCosts: "", assignmentFee: "",
};
const LS = "ovenSF.v1";
let state = { ...DEF };
try { state = { ...DEF, ...JSON.parse(localStorage.getItem(LS) || "{}") }; } catch { /* fresh */ }
const save = () => localStorage.setItem(LS, JSON.stringify(state));
let compareSel = new Set();

const loanInputs = () => ({
  purchasePrice: +state.purchasePrice || 0,
  ...(state.downMode === "pct" ? { downPaymentPct: +state.downPayment || 0 } : { downPayment: +state.downPayment || 0 }),
  annualRate: +state.annualRate || 0,
  termYears: +state.termYears || 30,
  firstPaymentDate: new Date(state.firstPaymentDate + "T00:00:00"),
  loanType: state.loanType,
  balloonYears: state.balloonYears.map(Number).filter((y) => y > 0),
  monthlyRent: +state.monthlyRent || 0, monthlyTaxes: +state.monthlyTaxes || 0,
  monthlyInsurance: +state.monthlyInsurance || 0, otherMonthlyCosts: +state.otherMonthlyCosts || 0,
  assignmentFee: +state.assignmentFee || 0,
});

export function mount(root) {
  root.append(
    el("div", { class: "engine-head" },
      el("div", {},
        el("h1", { class: "view-title" }, "Offer Oven"),
        el("div", { class: "view-sub" }, "seller-finance offers, cent-verified against the Creative Offer Oven sheet · scenarios attach to deals")),
      el("div", { class: "engine-buckets", style: "margin-top:0" },
        ["seller", "structures"].map((s) => el("button", {
          class: "ebucket", "aria-current": String(state.screen === s),
          onclick: () => { state.screen = s; save(); remount(root); },
        }, s === "seller" ? "📜 Seller Finance" : "🧮 Structures")))),
  );
  if (state.screen === "structures") { const host = el("div", {}); root.append(host); structures.mount(host); return; }
  root.append(el("div", { class: "oven-grid" },
    el("div", { id: "sfInputs" }, inputsCol(root)),
    el("div", { id: "sfResults" })));
  recompute(root);
  loadScenarios(root);
}
const remount = (root) => { root.replaceChildren(); mount(root); };

// ---- inputs ---------------------------------------------------------------------
function inputsCol(root) {
  const num = (k, label, attrs = {}) => el("label", { class: "oven-f" },
    el("span", {}, label),
    el("input", { type: "number", step: "any", value: String(state[k] ?? ""), ...attrs,
      oninput: (e) => { state[k] = e.target.value; save(); recompute(root); } }));
  const L = buildLoan(loanInputs());
  return el("div", {},
    el("div", { class: "glass oven-fs" },
      el("h4", {}, "Purchase & terms"),
      el("div", { class: "oven-fields" },
        num("purchasePrice", "Purchase price"),
        el("label", { class: "oven-f" },
          el("span", {}, state.downMode === "pct" ? `Down % (= ${$0(L.downPayment)})` : `Down $ (= ${L.downPct.toFixed(1)}%)`),
          el("div", { class: "oven-down" },
            el("input", { type: "number", step: "any", value: String(state.downPayment),
              oninput: (e) => { state.downPayment = e.target.value; save(); recompute(root); } }),
            el("button", { class: "tap", title: "switch between $ and %", onclick: () => {
              const l = buildLoan(loanInputs());
              state.downMode = state.downMode === "pct" ? "amount" : "pct";
              state.downPayment = state.downMode === "pct" ? +l.downPct.toFixed(2) : Math.round(l.downPayment);
              save(); remount(root);
            } }, state.downMode === "pct" ? "%" : "$"))),
        num("annualRate", "Annual rate %", { min: 0, max: 20 }),
        num("termYears", "Term (years)", { min: 1, max: 40 }),
        el("label", { class: "oven-f" },
          el("span", {}, "First payment date"),
          el("input", { type: "date", value: state.firstPaymentDate,
            oninput: (e) => { if (e.target.value) { state.firstPaymentDate = e.target.value; save(); recompute(root); } } })),
        el("label", { class: "oven-f" },
          el("span", {}, "Loan type"),
          el("select", { onchange: (e) => { state.loanType = e.target.value; save(); recompute(root); } },
            el("option", { value: "amortizing", ...(state.loanType !== "interest_only" ? { selected: "" } : {}) }, "Amortizing"),
            el("option", { value: "interest_only", ...(state.loanType === "interest_only" ? { selected: "" } : {}) }, "Interest-only"))))),
    el("div", { class: "glass oven-fs" },
      el("h4", {}, "Balloons (years, up to 4)"),
      el("div", { class: "oven-fields oven-balloons" },
        state.balloonYears.map((v, idx) => el("input", { type: "number", min: 1, placeholder: "—", value: String(v || ""),
          oninput: (e) => { state.balloonYears[idx] = e.target.value; save(); recompute(root); } })))),
    el("div", { class: "glass oven-fs" },
      el("h4", {}, "Cash flow (optional)"),
      el("div", { class: "oven-fields" },
        num("monthlyRent", "Rent $/mo"), num("monthlyTaxes", "Taxes $/mo"),
        num("monthlyInsurance", "Insurance $/mo"), num("otherMonthlyCosts", "Other $/mo"),
        num("assignmentFee", "Assignment fee $"))),
    el("button", { class: "btn-ghost showmore", onclick: () => { state = { ...DEF, screen: "seller" }; save(); remount(root); } }, "↺ Reset to sheet example"));
}

// ---- results --------------------------------------------------------------------
let lastLoan = null;
function recompute(root) {
  const out = root.querySelector("#sfResults");
  if (!out) return;
  const L = lastLoan = buildLoan(loanInputs());
  const kids = [];
  if (L.errors.length) kids.push(el("div", { class: "glass oven-fs oven-errors" },
    el("h4", {}, "Fix these first"), el("ul", {}, L.errors.map((e) => el("li", {}, e)))));
  if (L.downWarning) kids.push(el("p", { class: "oven-warn" }, `⚠ down payment is ${L.downPct.toFixed(1)}% — high entry, restructure (keep below 15%)`));

  // Headline: through the selected balloon if one is active, else full term.
  const horizon = L.balloons.find((b) => b.year === +state.pitch) || null;
  const total = horizon ? horizon.totalToSeller : L.totalToSeller;
  const delta = total - L.purchasePrice;
  kids.push(el("div", { class: "glass oven-hero" },
    el("span", { class: "oh-label" }, `Total paid to seller${horizon ? ` · balloon year ${horizon.year}` : " · full term"}`),
    el("b", { class: "oh-num pos" }, $0(total)),
    el("span", { class: "oh-sub" },
      `vs ${$0(L.purchasePrice)} cash — seller makes ${$0(delta)} more (+${(L.purchasePrice ? delta / L.purchasePrice * 100 : 0).toFixed(1)}%)`)));

  kids.push(el("div", { class: "oven-stats" },
    stat("monthly payment to seller", $2(L.pmt)),
    stat("loan amount (seller carry)", $0(L.loanAmount)),
    stat("down at close", `${$0(L.downPayment)} (${L.downPct.toFixed(1)}%)`),
    stat("terms", `${L.annualRate}% · ${L.termYears}yr · ${L.loanType === "interest_only" ? "interest-only" : "amortizing"}`),
    stat("total interest (full term)", $0(L.totalInterest)),
    stat("first payment", dmy(L.schedule[0]?.date))));

  if (L.cash) {
    kids.push(el("div", { class: "oven-stats" },
      stat("monthly cash flow", $2(L.cash.monthlyCashFlow), L.cash.monthlyCashFlow >= 0 ? "pos" : "neg"),
      stat("cash-on-cash", L.cash.cashOnCash.toFixed(1) + "%", L.cash.cashOnCash >= 0 ? "" : "neg"),
      stat(`PITI (${L.cash.pitiPctOfRent.toFixed(0)}% of rent)`, $2(L.cash.piti), L.cash.pitiFlag ? "neg" : "pos"),
      L.cash.pitiFlag ? stat("⚠ warning", "PITI over 75% of rent") : null));
  }

  if (L.balloons.length) kids.push(balloonTable(L, root));
  kids.push(amortization(L));
  kids.push(el("div", { class: "taps" },
    el("button", { class: "tap", onclick: () => saveScenario(root) }, "💾 Save scenario"),
    el("button", { class: "tap", onclick: () => copyPitch(L, horizon) }, "📋 Copy pitch summary"),
    el("button", { class: "tap", onclick: () => sellerPdf(L, horizon) }, "🖨 Seller PDF")));
  kids.push(el("div", { id: "sfScenarios" }));
  out.replaceChildren(...kids);
  renderScenarios(root);
}

const stat = (label, value, cls = "") => el("div", { class: "oven-stat" },
  el("b", { class: cls }, value), el("span", {}, label));

function balloonTable(L, root) {
  const row = (b) => el("tr", { class: +state.pitch === b.year ? "sf-active" : "", onclick: () => {
    state.pitch = +state.pitch === b.year ? 0 : b.year; save(); recompute(root);
  } },
    el("td", {}, `Year ${b.year}`), el("td", {}, dmy(b.date)),
    el("td", {}, $0(b.balance)), el("td", {}, $0(b.interestPaid)),
    el("td", {}, $0(b.principalPaid)), el("td", {}, $0(b.totalToSeller)));
  return el("div", { class: "glass oven-fs" },
    el("h4", {}, "Balloon comparison — click a row to pitch that horizon"),
    el("table", { class: "ws" },
      el("thead", {}, el("tr", {}, ["balloon", "payoff date", "balance due", "interest paid", "principal paid", "total to seller"].map((h) => el("th", {}, h)))),
      el("tbody", {}, L.balloons.map(row))));
}

function amortization(L) {
  const openYears = new Set();
  const body = el("tbody", {});
  const yearRow = (y) => el("tr", { class: "sf-yr", onclick: () => {
    if (openYears.has(y.year)) { openYears.delete(y.year); } else { openYears.add(y.year); }
    rebuild();
  } },
    el("td", {}, `▸ Year ${y.year}`), el("td", {}, dmy(y.date)), el("td", {}, $0(y.paid)),
    el("td", {}, $0(y.interest)), el("td", {}, $0(y.principal)), el("td", {}, $0(y.balance)));
  const monthRow = (m) => el("tr", { class: "sf-mo" },
    el("td", {}, `#${m.n}`), el("td", {}, dmy(m.date)), el("td", {}, $2(m.payment)),
    el("td", {}, $2(m.interest)), el("td", {}, $2(m.principal)), el("td", {}, $2(m.balance)));
  const rebuild = () => {
    body.replaceChildren(...L.years.flatMap((y) =>
      [yearRow(y), ...(openYears.has(y.year) ? y.months.map(monthRow) : [])]));
  };
  rebuild();
  return el("details", { class: "glass oven-fs" },
    el("summary", {}, `📅 Amortization schedule (${L.years.length} years — click a year for months)`),
    el("table", { class: "ws" },
      el("thead", {}, el("tr", {}, ["", "date", "paid", "interest", "principal", "balance"].map((h) => el("th", {}, h)))),
      body));
}

// ---- pitch summary + seller PDF ---------------------------------------------------
function pitchText(L, horizon) {
  const lines = [
    "Seller financing offer",
    `Price: ${$0(L.purchasePrice)}`,
    `Down at close: ${$0(L.downPayment)} (${L.downPct.toFixed(1)}%)`,
    `Monthly payment to you: ${$2(L.pmt)} for ${horizon ? horizon.year * 12 : L.termYears * 12} months (${L.annualRate}% ${L.loanType === "interest_only" ? "interest-only" : "amortizing"})`,
  ];
  if (horizon) lines.push(`Paid in full on ${dmy(horizon.date)} with a ${$0(horizon.balance)} final payment.`);
  const total = horizon ? horizon.totalToSeller : L.totalToSeller;
  lines.push(`Total you collect: ${$0(total)}`);
  lines.push(`A cash sale today nets you ${$0(L.purchasePrice)}. This offer pays you ${$0(total - L.purchasePrice)} more (+${((total - L.purchasePrice) / L.purchasePrice * 100).toFixed(1)}%).`);
  lines.push("Figures are illustrative only, not legal or financial advice.");
  return lines.join("\n");
}
async function copyPitch(L, horizon) {
  try { await navigator.clipboard.writeText(pitchText(L, horizon)); toast("pitch copied — paste into a text or email"); }
  catch { toast("couldn't copy — clipboard blocked"); }
}

function sellerPdf(L, horizon) {
  const total = horizon ? horizon.totalToSeller : L.totalToSeller;
  const rows = (pairs) => pairs.map(([k, v]) => `<tr><td>${k}</td><td>${v}</td></tr>`).join("");
  const w = window.open("", "_blank");
  if (!w) return toast("popup blocked — allow popups to export the PDF");
  w.document.write(`<!doctype html><html><head><title>Seller Financing Offer</title><style>
    body{font:14px/1.5 -apple-system,Segoe UI,sans-serif;color:#111;max-width:680px;margin:40px auto;padding:0 24px}
    h1{font-size:22px;margin:0 0 4px} .sub{color:#555;margin:0 0 24px}
    .hero{border:2px solid #111;border-radius:10px;padding:18px 22px;margin:18px 0;text-align:center}
    .hero b{font-size:30px;display:block} .hero span{color:#444}
    table{width:100%;border-collapse:collapse;margin:14px 0} td{padding:7px 4px;border-bottom:1px solid #ddd}
    td:last-child{text-align:right;font-weight:600} h2{font-size:15px;margin:22px 0 4px}
    footer{margin-top:34px;font-size:11px;color:#666;border-top:1px solid #ccc;padding-top:10px}
    @media print{body{margin:0 auto}}</style></head><body>
    <h1>Seller Financing Offer</h1><p class="sub">prepared ${new Date().toLocaleDateString("en-GB")}</p>
    <div class="hero"><span>Total paid to you${horizon ? ` (paid off in year ${horizon.year})` : ""}</span><b>${$0(total)}</b>
    <span>${$0(total - L.purchasePrice)} more than a ${$0(L.purchasePrice)} cash sale (+${((total - L.purchasePrice) / L.purchasePrice * 100).toFixed(1)}%)</span></div>
    <h2>The terms</h2><table>${rows([
      ["Purchase price", $0(L.purchasePrice)],
      ["Cash to you at closing", `${$0(L.downPayment)} (${L.downPct.toFixed(1)}%)`],
      ["You carry", $0(L.loanAmount)],
      ["Monthly payment to you", $2(L.pmt)],
      ["Rate / term", `${L.annualRate}% · ${L.termYears} years · ${L.loanType === "interest_only" ? "interest-only" : "amortizing"}`],
      ["First payment", dmy(L.schedule[0]?.date)],
    ])}</table>
    ${horizon ? `<h2>Early payoff</h2><table>${rows([
      ["Paid in full on", dmy(horizon.date)],
      ["Final (balloon) payment", $0(horizon.balance)],
      ["Interest collected by then", $0(horizon.interestPaid)],
    ])}</table>` : ""}
    <footer>Figures are illustrative only and do not constitute legal or financial advice. If this agreement of
    purchase and sale is assigned, Ontario assignment-clause disclosure requirements apply. Verify all numbers
    with your lawyer and accountant before signing.</footer>
    <script>window.print()</script></body></html>`);
  w.document.close();
}

// ---- saved scenarios: attach to deals, compare side by side -----------------------
let scenarios = [];
async function loadScenarios(root) {
  try { scenarios = (await get("/api/offer-scenarios")).scenarios || []; } catch { scenarios = []; }
  renderScenarios(root);
}

async function saveScenario(root) {
  let leads = [];
  try { leads = (await get("/api/ws/leads")).leads || []; } catch { /* standalone save still works */ }
  const L = lastLoan;
  const defLabel = `${L.downPct.toFixed(0)}% down / ${L.annualRate}% / ${L.termYears}yr` +
    (L.balloons.length ? `, balloon yr ${L.balloons[0].year}` : "");
  const v = await modal({ title: "Save offer scenario", submitLabel: "Save", body: [
    field("Label", "label", { value: `Offer — ${defLabel}` }),
    el("label", { class: "f" }, el("span", {}, "Attach to deal (optional)"),
      el("select", { name: "lead_id" },
        el("option", { value: "" }, "— none —"),
        leads.map((l) => el("option", { value: String(l.id) }, l.address || l.seller_name || `#${l.id}`)))),
  ] });
  if (!v) return;
  try {
    await post("/api/offer-scenarios", { label: v.label || defLabel, lead_id: v.lead_id || null, inputs: loanInputs() });
    toast("scenario saved");
    loadScenarios(root);
  } catch (e) { toast(e.message); }
}

function renderScenarios(root) {
  const host = root.querySelector("#sfScenarios");
  if (!host) return;
  if (!scenarios.length) { host.replaceChildren(); return; }
  const card = (s) => el("div", { class: "card glass sf-scen" },
    el("label", { class: "sf-cmp" },
      el("input", { type: "checkbox", ...(compareSel.has(s.id) ? { checked: "" } : {}), onchange: (e) => {
        if (e.target.checked) { if (compareSel.size >= 3) { e.target.checked = false; return toast("compare up to 3"); } compareSel.add(s.id); }
        else compareSel.delete(s.id);
        renderScenarios(root);
      } })),
    el("div", { class: "sf-scen-main", onclick: () => {
      const inp = s.inputs;
      Object.assign(state, {
        purchasePrice: inp.purchasePrice, downPayment: inp.downPaymentPct ?? inp.downPayment,
        downMode: inp.downPaymentPct != null ? "pct" : "amount",
        annualRate: inp.annualRate, termYears: inp.termYears,
        firstPaymentDate: String(inp.firstPaymentDate).slice(0, 10),
        loanType: inp.loanType || "amortizing",
        balloonYears: [...(inp.balloonYears || []), "", "", "", ""].slice(0, 4),
        monthlyRent: inp.monthlyRent || "", monthlyTaxes: inp.monthlyTaxes || "",
        monthlyInsurance: inp.monthlyInsurance || "", otherMonthlyCosts: inp.otherMonthlyCosts || "",
        assignmentFee: inp.assignmentFee || "",
      });
      save(); remount(root); toast(`loaded: ${s.label}`);
    } },
      el("div", { class: "addr" }, s.label),
      el("div", { class: "meta" }, `${s.lead_id ? `deal #${s.lead_id} · ` : ""}${new Date(s.created_at).toLocaleDateString("en-GB")}`)),
    el("button", { class: "tap", onclick: async () => {
      await del(`/api/offer-scenarios/${s.id}`); compareSel.delete(s.id); toast("deleted"); loadScenarios(root);
    } }, "✕"));
  const kids = [el("h3", { class: "trail-title" }, "Saved scenarios"), ...scenarios.slice(0, 12).map(card)];
  if (compareSel.size >= 2) kids.push(compareTable());
  host.replaceChildren(...kids);
}

function compareTable() {
  const picks = scenarios.filter((s) => compareSel.has(s.id));
  const loans = picks.map((s) => ({ s, L: buildLoan({ ...s.inputs, firstPaymentDate: new Date(s.inputs.firstPaymentDate) }) }));
  const row = (label, fn) => el("tr", {}, el("td", {}, label), ...loans.map(({ L }) => el("td", {}, fn(L))));
  return el("div", { class: "glass oven-fs" },
    el("h4", {}, "Side-by-side"),
    el("table", { class: "ws" },
      el("thead", {}, el("tr", {}, el("th", {}, ""), ...loans.map(({ s }) => el("th", {}, s.label.slice(0, 28))))),
      el("tbody", {},
        row("price", (L) => $0(L.purchasePrice)),
        row("down", (L) => `${$0(L.downPayment)} (${L.downPct.toFixed(0)}%)`),
        row("rate / term", (L) => `${L.annualRate}% / ${L.termYears}yr`),
        row("monthly payment", (L) => $2(L.pmt)),
        row("first balloon", (L) => L.balloons[0] ? `yr ${L.balloons[0].year}: ${$0(L.balloons[0].balance)}` : "—"),
        row("total to seller", (L) => $0(L.balloons[0] ? L.balloons[0].totalToSeller : L.totalToSeller)),
        row("monthly cash flow", (L) => L.cash ? $2(L.cash.monthlyCashFlow) : "—"))));
}

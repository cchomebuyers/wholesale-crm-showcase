// Engine — the autonomous lead engine, visual and workable.
// Funnel of the last pass · triage buckets (one list at a time, never six
// columns) · guided review with the engine's own reasons/spend-blocks on every
// card. Statuses live server-side (PATCH /api/lead-engine/candidates/:id):
// shortlisted → hold | approved_for_skiptrace | rejected, plus
// imported_prospect / skiptraced set by the import & skip-trace actions.
import { el, toast, modal, field, emptyState, focusTimer } from "../ui.js";
import { get, post, patch } from "../api.js";

export const title = "Lead Engine";
export const icon = "M13 2L4 14h6l-1 8 9-12h-6l1-8";

// The subcategories: where every candidate lives and what to do with it there.
const BUCKETS = [
  { key: "shortlisted", glyph: "📥", label: "Review",
    hint: "Fresh from the last pass, best score first. One decision per card — approve, hold, or reject. Empty this bucket every pass." },
  { key: "hold", glyph: "⏸", label: "Hold",
    hint: "Parked — something's missing (comps, owner, spread). Revisit after the next pass instead of re-reading them daily." },
  { key: "approved_for_skiptrace", glyph: "✅", label: "Approved",
    hint: "You said these are worth money. Skip trace ($0.10–0.25 each) finds the owner's phone/email and pushes the lead into the CRM." },
  { key: "skiptraced", glyph: "📞", label: "Traced",
    hint: "Contact found and saved on the CRM lead. These are your call list — work them in the main app." },
  { key: "imported_prospect", glyph: "📤", label: "In CRM",
    hint: "Sent to the main app as Prospects (review queue). Open the CRM → Prospects → Activate to work them in the pipeline." },
  { key: "rejected", glyph: "🗑", label: "Rejected",
    hint: "Dead signals. Restore one if you change your mind — nothing is deleted." },
];

const LIST_CAP = 8; // bounded lists, per spec

// Survives remounts so a triage action doesn't lose your place.
const state = { runId: null, bucket: "shortlisted", minScore: 0, source: "", q: "", showAll: false, open: new Set() };

export async function mount(root) {
  let runs;
  try { runs = (await get("/api/lead-engine/runs?limit=10")).runs || []; }
  catch (e) { root.append(el("p", { class: "view-sub" }, `couldn't load: ${e.message}`)); return; }

  if (!runs.length) {
    root.append(header(root, null),
      emptyState({ glyph: "🛰", title: "No engine passes yet",
        body: "Run a pass to harvest free public sources (violations, county records, listings), converge duplicates, score, and shortlist.",
        phase: "lead engine" }));
    return;
  }
  if (!state.runId || !runs.some((r) => r.id === state.runId)) state.runId = runs[0].id;

  let detail;
  try { detail = await get(`/api/lead-engine/runs/${state.runId}/candidates`); }
  catch (e) { root.append(el("p", { class: "view-sub" }, `couldn't load: ${e.message}`)); return; }
  if (!root.isConnected) return;

  root.append(
    header(root, detail.run),
    funnel(detail.run),
    guide(),
    buckets(root, detail.candidates),
    filters(root),
    list(root, detail.candidates),
    runsTable(root, runs),
  );
}

const remount = (root) => { root.replaceChildren(); mount(root); };

// ---- header: last pass + run/sprint actions -----------------------------------
function header(root, run) {
  const t = run?.target || {};
  return el("div", { class: "engine-head" },
    el("div", {},
      el("h1", { class: "view-title" }, "Lead Engine"),
      el("div", { class: "view-sub" }, run
        ? `pass #${run.id} · ${ago(run.created_at)} · ${[t.city, t.state, t.zip].filter(Boolean).join(", ") || "—"}`
        : "harvest → converge → score → shortlist")),
    el("div", { class: "engine-actions" },
      el("button", { class: "btn-ghost", onclick: () => focusTimer("Lead triage sprint", 15) }, "⏱ 15-min sprint"),
      el("button", { class: "btn-solid", onclick: () => runPass(root) }, "▸ Run a pass")));
}

async function runPass(root) {
  const v = await modal({
    title: "Run an engine pass", submitLabel: "Run",
    body: [
      field("City", "city", { value: "Detroit", required: "" }),
      field("State", "state", { value: "MI" }),
      field("ZIP (optional)", "zip", {}),
      el("label", { class: "check" },
        el("input", { type: "checkbox", name: "freeOnly", checked: "" }),
        "Free sources only — skip RentCast and paid skip-trace, so this pass costs nothing"),
    ],
  });
  if (!v) return;
  const body = { city: v.city, state: v.state || undefined, zip: v.zip || undefined, shortlistLimit: 25 };
  if (v.freeOnly) body.searchPlan = { excludeConnectorIds: ["rentcast-sale"], excludeSourceTypes: ["paid-skiptrace"] };
  toast("pass running — takes about a minute, hang tight…");
  try {
    const r = await post("/api/lead-engine/run", body);
    toast(`pass #${r.runId} done: ${(r.cycle?.shortlist || []).length} shortlisted`);
    state.runId = r.runId; state.bucket = "shortlisted"; state.showAll = false;
    if (root.isConnected) remount(root);
  } catch (e) { toast(e.message); }
}

// ---- funnel: what the last pass did, as bars ----------------------------------
function funnel(run) {
  const stages = [
    ["raw records harvested", run.raw_records],
    ["kept for convergence", run.raw_thingas],
    ["converged properties", run.converged_properties],
    ["shortlisted for you", run.shortlist_count],
  ];
  const max = Math.max(1, ...stages.map(([, n]) => Math.sqrt(n || 0)));
  return el("div", { class: "glass engine-funnel" },
    stages.map(([label, n]) => el("div", { class: "bar-row" },
      el("span", { class: "bl" }, label),
      el("div", { class: "bar-track" },
        el("div", { class: "bar-fill", style: `width:${Math.max(2, Math.round(Math.sqrt(n || 0) / max * 100))}%` })),
      el("span", { class: "bv" }, (n || 0).toLocaleString("en-US")))));
}

// ---- guide: what to look for, how to look through it, where leads go ----------
function guide() {
  const li = (...c) => el("li", {}, ...c);
  return el("details", { class: "glass engine-guide" },
    el("summary", {}, "📖 How to work this screen"),
    el("div", { class: "eg-cols" },
      el("div", {},
        el("h4", {}, "Where leads go"),
        el("ol", {},
          li("The engine harvests public sources, merges records that prove the same property, and scores each one."),
          li(el("b", {}, "📥 Review"), " — you triage: ✓ Approve (worth money) · ⏸ Hold (missing info) · ✕ Reject (dead)."),
          li(el("b", {}, "✅ Approved"), " — 📞 Skip trace ($) finds the owner's phone/email, or 📤 send to CRM free without contact."),
          li(el("b", {}, "📤 In CRM"), " — lands as a Prospect in the main app; Activate it there to enter the pipeline."),
          li("Anything scoring 70+ the Acquisitions Autopilot promotes on its own — you'll see it under In CRM."))),
      el("div", {},
        el("h4", {}, "What to look for"),
        el("ul", {},
          li(el("span", { class: "escore hot" }, "75+"), " spend-worthy — distress + identity + a path to a spread. Act now."),
          li(el("span", { class: "escore warm" }, "55–74"), " promising but incomplete — read the card's \"still needs\" list."),
          li(el("span", { class: "escore" }, "<55"), " thin — reject fast unless something jumps out."),
          li("Good signs: distress signal (+18) · absentee owner · active listing (+20) · owner identity (+10) · contact evidence (+12) · buyer matches (+15) · proven spread (+15)."),
          li("LLC owner = investor-owned; a person's name at a different mailing address = classic absentee seller."))),
      el("div", {},
        el("h4", {}, "Stay on task"),
        el("ul", {},
          li("Hit ⏱ 15-min sprint and triage top-score down — one decision per card, no skipping."),
          li("Empty Review every pass; a full Review bucket is the only backlog that matters here."),
          li("Approve only what you'd pay $0.25 to call. When unsure, Hold — the next pass adds data."),
          li("Money is only spent in Approved, and only when you press Skip trace.")))));
}

// ---- buckets: the subcategory chips + the selected bucket's hint ---------------
function buckets(root, candidates) {
  const counts = {};
  for (const c of candidates) counts[c.status] = (counts[c.status] || 0) + 1;
  const cur = BUCKETS.find((b) => b.key === state.bucket) || BUCKETS[0];
  return el("div", {},
    el("div", { class: "engine-buckets" },
      BUCKETS.map((b) => el("button", {
        class: "ebucket", "aria-current": String(b.key === state.bucket),
        onclick: () => { state.bucket = b.key; state.showAll = false; remount(root); },
      }, `${b.glyph} ${b.label}`, el("span", { class: "cnt" }, String(counts[b.key] || 0))))),
    el("p", { class: "engine-hint" }, cur.hint));
}

// ---- filters -------------------------------------------------------------------
function filters(root) {
  const sel = (opts, value, onchange) =>
    el("select", { onchange }, opts.map(([v, l]) =>
      el("option", { value: v, ...(String(value) === String(v) ? { selected: "" } : {}) }, l)));
  return el("div", { class: "engine-filters" },
    sel([[0, "any score"], [55, "55+"], [75, "75+ only"]], state.minScore,
      (e) => { state.minScore = +e.target.value; remount(root); }),
    sel([["", "all sources"], ["violations", "violations"], ["listings", "listings"], ["property", "property"], ["public-contact", "public contact"]],
      state.source, (e) => { state.source = e.target.value; remount(root); }),
    el("input", { placeholder: "filter by address or owner…", value: state.q,
      oninput: (e) => { state.q = e.target.value; refreshList(root); } }));
}

// ---- candidate list ------------------------------------------------------------
let lastCandidates = [];
function list(root, candidates) {
  lastCandidates = candidates;
  const host = el("div", { id: "engineList" });
  fillList(host, root);
  return host;
}
const refreshList = (root) => {
  const host = root.querySelector("#engineList");
  if (host) { host.replaceChildren(); fillList(host, root); }
};

function fillList(host, root) {
  const q = state.q.trim().toLowerCase();
  const rows = lastCandidates
    .filter((c) => c.status === state.bucket)
    .filter((c) => c.score >= state.minScore)
    .filter((c) => !state.source || (c.data?.property?.source_type || "") === state.source)
    .filter((c) => !q || `${c.address} ${c.data?.property?.seller_name || ""}`.toLowerCase().includes(q))
    .sort((a, b) => b.score - a.score);
  if (!rows.length) {
    host.append(el("p", { class: "engine-none" }, "Nothing here",
      state.bucket === "shortlisted" ? " — run a pass or check Hold." : "."));
    return;
  }
  const showN = state.showAll ? rows.length : LIST_CAP;
  for (const c of rows.slice(0, showN)) host.append(card(c, root));
  if (rows.length > showN) {
    host.append(el("button", { class: "btn-ghost showmore",
      onclick: () => { state.showAll = true; refreshList(root); } }, `show ${rows.length - showN} more`));
  }
}

function card(c, root) {
  const d = c.data || {};
  const p = d.property || {};
  const tier = c.score >= 75 ? "hot" : c.score >= 55 ? "warm" : "";
  const chips = [
    p.source_type ? el("span", { class: "badge" }, p.source_type) : null,
    p.absentee ? el("span", { class: "badge" }, "🏃 absentee") : null,
    p.seller_name ? el("span", { class: "badge" }, p.seller_name.length > 26 ? p.seller_name.slice(0, 25) + "…" : p.seller_name) : null,
    c.lead_id ? el("span", { class: "badge" }, `CRM lead #${c.lead_id}`) : null,
  ];
  const motivation = p.ordinance || p.motivation || d.reasons?.[0] || "";
  const node = el("div", { class: "card glass ecard" + (state.open.has(c.id) ? " open" : "") },
    el("div", { class: "ecard-top", onclick: () => { state.open.has(c.id) ? state.open.delete(c.id) : state.open.add(c.id); refreshList(root); } },
      el("div", { class: "ecard-main" },
        el("div", { class: "addr" }, c.address || "(no address)"),
        motivation ? el("div", { class: "meta" }, motivation.length > 90 ? motivation.slice(0, 89) + "…" : motivation) : null,
        el("div", { class: "echips" }, chips)),
      el("span", { class: `escore ${tier}` }, String(c.score))),
    state.open.has(c.id) ? detail(d) : null,
    actions(c, root));
  return node;
}

function detail(d) {
  const listRows = (items) => el("ul", {}, (items || []).map((r) => el("li", {}, r)));
  const buyers = (d.buyer_matches || []).filter((b) => b.score >= 50).slice(0, 3);
  return el("div", { class: "edetail" },
    (d.reasons || []).length ? el("div", {}, el("b", {}, "Why it scored"), listRows(d.reasons)) : null,
    (d.spend_blocks || []).length ? el("div", {}, el("b", {}, "Still needs (before spending money)"), listRows(d.spend_blocks)) : null,
    buyers.length ? el("div", {}, el("b", {}, "Buyer demand"),
      listRows(buyers.map((b) => `${b.name || "buyer"} (${b.score})`))) : null,
    d.spread_status ? el("div", {}, el("b", {}, "Spread"), el("span", {}, ` ${d.spread_status}`)) : null);
}

// ---- per-bucket actions ---------------------------------------------------------
function actions(c, root) {
  const tap = (label, fn, cls = "tap") => el("button", { class: cls, onclick: (e) => { e.stopPropagation(); fn(); } }, label);
  const set = (status, msg) => async () => {
    try { await patch(`/api/lead-engine/candidates/${c.id}`, { status }); toast(msg); remount(root); }
    catch (e) { toast(e.message); }
  };
  const send = async () => {
    try {
      const r = await post(`/api/lead-engine/candidates/${c.id}/import`, {});
      toast(r.duplicate ? "matched an existing CRM lead by address" : `sent to CRM — Prospect #${r.leadId}`);
      remount(root);
    } catch (e) { toast(e.message); }
  };
  const trace = async () => {
    const ok = await modal({ title: "Paid skip trace", submitLabel: "Spend & trace",
      body: el("p", { class: "engine-hint" },
        `BatchData will look up the owner of ${c.address} (~$0.10–0.25). The result lands on a CRM lead automatically.`) });
    if (!ok) return;
    toast("tracing…");
    try {
      const r = await post(`/api/lead-engine/candidates/${c.id}/skiptrace`, {});
      toast(r.phone || r.email ? `found: ${[r.phone, r.email].filter(Boolean).join(" · ")}` : "traced — no contact returned");
      remount(root);
    } catch (e) { toast(e.message); }
  };
  const A = {
    shortlisted: [tap("✓ Approve", set("approved_for_skiptrace", "approved — worth money")), tap("⏸ Hold", set("hold", "parked in Hold")),
      tap("✕ Reject", set("rejected", "rejected")), tap("📤 Send to CRM", send)],
    hold: [tap("✓ Approve", set("approved_for_skiptrace", "approved — worth money")), tap("✕ Reject", set("rejected", "rejected")),
      tap("📤 Send to CRM", send)],
    approved_for_skiptrace: [tap("📞 Skip trace $", trace), tap("📤 Send to CRM (free)", send), tap("⏸ Hold", set("hold", "parked in Hold"))],
    skiptraced: [],
    imported_prospect: [],
    rejected: [tap("↩ Restore", set("shortlisted", "back in Review"))],
  };
  const btns = A[c.status] || [];
  return btns.length ? el("div", { class: "taps" }, btns) : null;
}

// ---- pass history ---------------------------------------------------------------
function runsTable(root, runs) {
  return el("div", { class: "engine-runs" },
    el("h3", { class: "trail-title" }, "Pass history"),
    el("table", { class: "ws" },
      el("thead", {}, el("tr", {}, ["pass", "when", "target", "raw → converged → shortlisted", ""].map((h) => el("th", {}, h)))),
      el("tbody", {}, runs.slice(0, 5).map((r) => el("tr", {},
        el("td", {}, `#${r.id}`),
        el("td", {}, ago(r.created_at)),
        el("td", {}, [r.target?.city, r.target?.zip].filter(Boolean).join(" ") || "—"),
        el("td", {}, `${(r.raw_records || 0).toLocaleString("en-US")} → ${r.converged_properties || 0} → ${r.shortlist_count || 0}`),
        el("td", {}, r.id === state.runId ? el("span", { class: "badge" }, "viewing") :
          el("button", { class: "tap", onclick: () => { state.runId = r.id; state.showAll = false; remount(root); } }, "view")))))));
}

function ago(iso) {
  if (!iso) return "—";
  const m = Math.floor((Date.now() - Date.parse(iso)) / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  if (m < 1440) return `${Math.floor(m / 60)}h ago`;
  return `${Math.floor(m / 1440)}d ago`;
}

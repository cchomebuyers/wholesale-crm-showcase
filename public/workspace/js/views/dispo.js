// Dispo — per-deal disposition board + buyer matching (spec Phase 5).
import { el, emptyState, toast, focusTimer } from "../ui.js";
import { get, post, patch, money } from "../api.js";

export const title = "Dispo";
export const icon = "M4 17l6-6-4-4M14 7h6M14 12h6M14 17h6";

const DISPO = ["blast_sent", "showings", "offers_in", "buyer_locked", "closing", "closed"];
const LABEL = { blast_sent: "Blast Sent", showings: "Showings", offers_in: "Offers In", buyer_locked: "Buyer Locked", closing: "Closing", closed: "Closed" };
const openMatches = new Set();

export async function mount(root) {
  let deals;
  try { deals = await get("/api/ws/deals"); }
  catch (e) { root.append(el("p", { class: "view-sub" }, `couldn't load: ${e.message}`)); return; }

  root.append(
    el("h1", { class: "view-title" }, "Dispo"),
    el("div", { class: "view-sub" }, `${deals.length} deal${deals.length === 1 ? "" : "s"} in flight`));

  if (!deals.length) {
    root.append(emptyState({
      glyph: "🤝", title: "No deals under contract",
      body: "Drag a lead to Under Contract on the Acquisitions board — the deal appears here with matched buyers.",
    }));
    return;
  }

  for (const deal of deals) root.append(await dealCard(deal, root));
}

function remount(root) { root.replaceChildren(); mount(root); }

async function dealCard(deal, root) {
  // countdown chip: accent-colored under 7 days (the ONE allowed urgency use)
  const dtc = deal.days_to_close;
  const countdown = dtc == null ? null
    : dtc < 7
      ? el("span", { class: "urgent-badge" }, dtc < 0 ? `${-dtc}d past closing` : `closes in ${dtc}d`)
      : el("span", { class: "badge" }, `closes in ${dtc}d`);

  const stageRow = el("div", { class: "dstage" },
    DISPO.map((s) => el("button", {
      "aria-current": String(deal.dispo_stage === s),
      onclick: async () => { try { await patch(`/api/ws/deals/${deal.id}`, { dispo_stage: s }); remount(root); } catch (e) { toast(e.message); } },
    }, LABEL[s])));

  const matchesHost = el("div", {});
  const card = el("div", { class: "card glass" },
    el("div", { class: "deal" },
      el("div", {},
        el("div", { class: "addr" }, deal.address || `deal #${deal.id}`, " ", countdown, " ",
          el("button", { class: "btn-ghost timer-btn", title: "15-min sprint: work this deal",
            onclick: (e) => { e.stopPropagation(); focusTimer(deal.address || `deal #${deal.id}`, 15); } }, "⏱")),
        el("div", { class: "meta" },
          `${money(deal.contract_price)} contract · fee target ${money(deal.assignment_fee_target)}`,
          deal.emd ? ` · EMD ${money(deal.emd)}` : "",
          deal.title_company ? ` · ${deal.title_company}` : ""),
        stageRow),
      el("div", { style: "display:grid;gap:8px;justify-items:end" },
        el("button", { class: "btn-solid", onclick: async () => {
          try { const r = await post(`/api/ws/deals/${deal.id}/blast`, {}); toast(`blasted to ${r.blasted} matched buyer${r.blasted === 1 ? "" : "s"}`); remount(root); }
          catch (e) { toast(e.message); }
        } }, "mark blasted"),
        el("button", { class: "btn-ghost", onclick: async () => {
          if (openMatches.has(deal.id)) { openMatches.delete(deal.id); matchesHost.replaceChildren(); return; }
          openMatches.add(deal.id);
          await renderMatches(deal, matchesHost, root);
        } }, "buyers ▾"))),
    matchesHost);

  if (openMatches.has(deal.id)) await renderMatches(deal, matchesHost, root);
  // "N buyers match" badge (spec)
  try {
    const m = await get(`/api/ws/deals/${deal.id}/matches`);
    card.querySelector(".meta").append(` · ${m.length} buyer${m.length === 1 ? "" : "s"} match`);
  } catch { /* non-fatal */ }
  return card;
}

async function renderMatches(deal, host, root) {
  host.replaceChildren();
  let matches;
  try { matches = await get(`/api/ws/deals/${deal.id}/matches`); } catch (e) { toast(e.message); return; }
  if (!matches.length) { host.append(el("div", { class: "match" }, "no buyers match this buy box — add buyers or widen the box")); return; }
  for (const b of matches) {
    host.append(el("div", { class: "match" },
      el("span", {}, `${b.name}${deal.locked_buyer_id === b.id ? " · 🔒 locked" : ""} — ${"★".repeat(b.responsiveness || 3)}${b.pof ? " · PoF" : ""}${b.closed_before ? " · closed before" : ""}`),
      el("span", {},
        `w ${b.match.weight} `,
        el("button", { class: "btn-ghost", onclick: async () => {
          try { await patch(`/api/ws/deals/${deal.id}`, { locked_buyer_id: b.id, dispo_stage: "buyer_locked" }); toast(`locked ${b.name}`); remount(root); }
          catch (e) { toast(e.message); }
        } }, "lock"))));
  }
}

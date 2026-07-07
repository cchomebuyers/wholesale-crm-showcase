// Analytics — 4 numbers + one bar chart, nothing more (spec Phase 8).
import { el } from "../ui.js";
import { get, money } from "../api.js";

export const title = "Analytics";
export const icon = "M4 20V10M10 20V4M16 20v-7M22 20H2";

export async function mount(root) {
  let a;
  try { a = await get("/api/ws/analytics"); }
  catch (e) { root.append(el("p", { class: "view-sub" }, `couldn't load: ${e.message}`)); return; }

  root.append(
    el("h1", { class: "view-title" }, "Analytics"),
    el("div", { class: "view-sub" }, "this week, at a glance — no dashboard soup"));

  const tile = (n, label) => el("div", { class: "glass" }, el("b", {}, String(n)), el("span", {}, label));
  root.append(el("div", { class: "num4" },
    tile(a.contactedThisWeek, "leads contacted"),
    tile(a.offersMade, "offers made"),
    tile(a.underContract, "under contract"),
    tile(money(a.projectedFees), "projected fees")));

  // one bar chart: leads by source (single neutral hue; value labels visible)
  const max = Math.max(1, ...a.bySource.map((s) => s.n));
  root.append(el("div", { class: "barchart glass" },
    el("div", { class: "view-sub", style: "margin-bottom:8px" }, "active leads by source"),
    a.bySource.length
      ? a.bySource.map((s) => el("div", { class: "bar-row" },
          el("span", { class: "bl", title: s.source }, s.source),
          el("span", { class: "bar-track" }, el("i", { class: "bar-fill", style: `width:${Math.round((s.n / max) * 100)}%;display:block` })),
          el("span", { class: "bv" }, String(s.n))))
      : el("div", { class: "view-sub" }, "no leads yet")));
}

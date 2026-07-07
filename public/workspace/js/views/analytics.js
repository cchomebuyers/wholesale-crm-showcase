// Analytics — 4 numbers + one bar chart, nothing more (spec Phase 8).
import { el, emptyState } from "../ui.js";
export const title = "Analytics";
export const icon = "M4 20V10M10 20V4M16 20v-7M22 20H2";
export function mount(root) {
  root.append(
    el("h1", { class: "view-title" }, "Analytics"),
    el("div", { class: "view-sub" }, "contacted · offers · under contract · projected fees"),
    emptyState({
      glyph: "📊",
      title: "Four numbers only",
      body: "Leads contacted this week, offers made, deals under contract, projected assignment fees — plus one bar chart by source. No dashboard soup.",
      phase: "arrives in Phase 8",
    }),
  );
}

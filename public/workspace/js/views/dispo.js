// Dispo — per-deal disposition board + buyer matching (spec Phase 5).
import { el, emptyState } from "../ui.js";
export const title = "Dispo";
export const icon = "M4 17l6-6-4-4M14 7h6M14 12h6M14 17h6";
export function mount(root) {
  root.append(
    el("h1", { class: "view-title" }, "Dispo"),
    el("div", { class: "view-sub" }, "under-contract deals: Blast → Showings → Offers In → Locked → Closing"),
    emptyState({
      glyph: "🤝",
      title: "No deals under contract",
      body: "When a lead hits Under Contract, its deal appears here with matched buyers ranked.",
      phase: "arrives in Phase 5",
    }),
  );
}

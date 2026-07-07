// Buyers — bounded table + buy boxes (spec Phase 6).
import { el, emptyState } from "../ui.js";
export const title = "Buyers";
export const icon = "M16 11a4 4 0 10-8 0M12 15c-4 0-7 2-7 4v1h14v-1c0-2-3-4-7-4M19 8v4M21 10h-4";
export function mount(root) {
  root.append(
    el("h1", { class: "view-title" }, "Buyers"),
    el("div", { class: "view-sub" }, "cash buyers, buy boxes, proof of funds — 10 rows + show more"),
    emptyState({
      glyph: "💰",
      title: "Buyer list lands here",
      body: "Quick-add with the b prefix. Matching runs automatically when deals go under contract.",
      phase: "arrives in Phase 6",
    }),
  );
}

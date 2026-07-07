// Acquisitions — seller pipeline kanban (spec Phase 4). Phase 1 = shell only.
import { el, emptyState } from "../ui.js";
export const title = "Acquisitions";
export const icon = "M3 11l9-7 9 7M5 10v9a1 1 0 001 1h3v-5h6v5h3a1 1 0 001-1v-9";
export function mount(root) {
  root.append(
    el("h1", { class: "view-title" }, "Acquisitions"),
    el("div", { class: "view-sub" }, "sellers: New → Contacted → Appointment → Offer → … → Closed"),
    emptyState({
      glyph: "🏚",
      title: "Kanban lands here",
      body: "Drag leads between stages, inline MAO on every card, dead leads get a revive date.",
      phase: "arrives in Phase 4",
    }),
  );
}

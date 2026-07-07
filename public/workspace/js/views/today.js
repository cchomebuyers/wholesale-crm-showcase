// Today — the default screen (spec Phase 3). Phase 1 = empty shell only.
import { el, emptyState } from "../ui.js";
export const title = "Today";
export const icon = "M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M18.4 5.6L17 7M7 17l-1.4 1.4M12 8a4 4 0 100 8 4 4 0 000-8z";
export function mount(root) {
  root.append(
    el("h1", { class: "view-title" }, "Today"),
    el("div", { class: "view-sub" }, "only what's due — max 5, sorted by motivation"),
    emptyState({
      glyph: "☀️",
      title: "Nothing here yet",
      body: "Follow-ups due today will appear as one-tap cards: No Answer · Spoke · Offer Made.",
      phase: "arrives in Phase 3",
    }),
  );
}

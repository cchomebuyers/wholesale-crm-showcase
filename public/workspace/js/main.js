// ============================================================================
// main.js — shell: view registry · hash router · rail · quick-add focus keys
// ============================================================================
// Phase 1 scope only: navigation skeleton + design system. No feature logic.
// Views are labeled folders: one module per view under ./views/, each
// exporting { title, glyph, icon, mount(rootEl) }.

import { el, toast } from "./ui.js";
import * as today from "./views/today.js";
import * as acquisitions from "./views/acquisitions.js";
import * as dispo from "./views/dispo.js";
import * as buyers from "./views/buyers.js";
import * as analytics from "./views/analytics.js";

// Rail order = spec order. Five items, never more.
const VIEWS = { today, acquisitions, dispo, buyers, analytics };
const DEFAULT = "today";

const rail = document.getElementById("rail");
const root = document.getElementById("viewRoot");
const quickAdd = document.getElementById("quickAdd");

// ---- rail ------------------------------------------------------------------
for (const [key, view] of Object.entries(VIEWS)) {
  rail.append(
    el("button", {
      class: "rail-btn", "data-view": key, title: view.title,
      style: "position:relative",
      onclick: () => { location.hash = `#/${key}`; },
    },
    svg(view.icon),
    el("span", { class: "tip" }, view.title)),
  );
}

function svg(pathD) {
  const s = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  s.setAttribute("viewBox", "0 0 24 24");
  const p = document.createElementNS("http://www.w3.org/2000/svg", "path");
  p.setAttribute("d", pathD);
  p.setAttribute("stroke-linecap", "round");
  p.setAttribute("stroke-linejoin", "round");
  s.append(p);
  return s;
}

// ---- router ------------------------------------------------------------------
function route() {
  const key = (location.hash.replace(/^#\//, "") || DEFAULT);
  const view = VIEWS[key] || VIEWS[DEFAULT];
  for (const b of rail.querySelectorAll(".rail-btn")) {
    if (b.dataset.view === key) b.setAttribute("aria-current", "page");
    else b.removeAttribute("aria-current");
  }
  root.replaceChildren();
  root.classList.remove("view-enter");
  void root.offsetWidth; // restart the enter animation
  root.classList.add("view-enter");
  document.title = `${view.title} — Wholesale Workspace`;
  view.mount(root);
}
addEventListener("hashchange", route);
route();

// ---- quick-add: `/` or `n` focuses from anywhere (parse logic = Phase 7) ----
addEventListener("keydown", (e) => {
  const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName);
  if (!typing && (e.key === "/" || e.key === "n")) {
    e.preventDefault();
    quickAdd.focus();
  }
  if (e.key === "Escape" && document.activeElement === quickAdd) quickAdd.blur();
});
quickAdd.addEventListener("keydown", (e) => {
  if (e.key !== "Enter" || !quickAdd.value.trim()) return;
  toast("quick capture lands in Phase 7 — nothing saved yet");
});

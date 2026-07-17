// ============================================================================
// main.js — shell: view registry · hash router · rail · quick capture (Phase 7)
// ============================================================================
import { el, toast } from "./ui.js";
import { post } from "./api.js";
import * as today from "./views/today.js";
import * as acquisitions from "./views/acquisitions.js";
import * as engine from "./views/engine.js";
import * as oven from "./views/oven.js";
import * as dispo from "./views/dispo.js";
import * as buyers from "./views/buyers.js";
import * as analytics from "./views/analytics.js";
import * as agents from "./views/agents.js";

const VIEWS = { today, engine, acquisitions, oven, dispo, buyers, analytics, agents };
const DEFAULT = "today";

const rail = document.getElementById("rail");
const root = document.getElementById("viewRoot");
const quickAdd = document.getElementById("quickAdd");

// ---- rail --------------------------------------------------------------------
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

// ---- router --------------------------------------------------------------------
function route() {
  const key = (location.hash.replace(/^#\//, "") || DEFAULT);
  const view = VIEWS[key] || VIEWS[DEFAULT];
  for (const b of rail.querySelectorAll(".rail-btn")) {
    if (b.dataset.view === key) b.setAttribute("aria-current", "page");
    else b.removeAttribute("aria-current");
  }
  root.replaceChildren();
  root.classList.remove("view-enter");
  void root.offsetWidth;
  root.classList.add("view-enter");
  document.title = `${view.title} — Wholesale Workspace`;
  view.mount(root);
}
addEventListener("hashchange", route);
route();

// ---- quick capture (spec Phase 7): thought → record in under 3 seconds --------
// prefixes: l lead · b buyer · t task. Only name/address required; everything
// else fillable later (cards show the incomplete dot).
addEventListener("keydown", (e) => {
  const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName);
  if (!typing && (e.key === "/" || e.key === "n")) { e.preventDefault(); quickAdd.focus(); }
  if (e.key === "Escape" && document.activeElement === quickAdd) quickAdd.blur();
});

async function capture(raw) {
  const m = raw.match(/^([lbt])\s+(.+)$/i);
  if (!m) {
    // no prefix → default to a task (the safest parking spot for a thought)
    await post("/api/tasks", { title: raw });
    return "parked as task";
  }
  const [, prefix, rest] = m;
  const parts = rest.split(",").map((s) => s.trim()).filter(Boolean);
  if (prefix.toLowerCase() === "l") {
    // l <address or name>[, phone][, city]
    const phone = parts.find((p) => /[\d\-()+ ]{7,}/.test(p) && /\d{3}/.test(p));
    const body = { address: parts[0], seller_phone: phone || null, city: parts.find((p) => p !== parts[0] && p !== phone) || null };
    await post("/api/ws/leads", body);
    return `lead saved: ${parts[0]}`;
  }
  if (prefix.toLowerCase() === "b") {
    // b <name>[, areas][, max price]
    const num = parts.find((p) => /^\$?[\d,]+$/.test(p.replace(/\s/g, "")));
    await post("/api/ws/buyers", {
      name: parts[0],
      areas: parts.slice(1).filter((p) => p !== num).join(", ") || null,
      max_price: num ? +num.replace(/[^0-9]/g, "") : null,
    });
    return `buyer saved: ${parts[0]}`;
  }
  await post("/api/tasks", { title: rest });
  return "task parked";
}

quickAdd.addEventListener("keydown", async (e) => {
  if (e.key !== "Enter" || !quickAdd.value.trim()) return;
  const raw = quickAdd.value.trim();
  quickAdd.value = "";
  try {
    toast(await capture(raw));
    route(); // refresh the current view so the new record is visible
  } catch (err) {
    quickAdd.value = raw; // don't lose the thought
    toast(err.message);
  }
});

// ============================================================================
// ui.js — tiny shared primitives (no framework, no state library)
// ============================================================================

/** el("div", {class:"x", onclick:fn}, child1, child2) — DOM without innerHTML. */
export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k.startsWith("on") && typeof v === "function") node.addEventListener(k.slice(2), v);
    else if (v != null) node.setAttribute(k, v);
  }
  for (const c of children.flat()) {
    if (c == null) continue;
    node.append(c.nodeType ? c : document.createTextNode(String(c)));
  }
  return node;
}

/** Standard empty state — every view ships one from day zero. */
export function emptyState({ glyph, title, body, phase }) {
  return el("div", { class: "empty glass" },
    el("div", { class: "glyph", "aria-hidden": "true" }, glyph),
    el("h2", {}, title),
    el("p", {}, body),
    phase ? el("span", { class: "phase" }, phase) : null,
  );
}

let toastTimer;
export function toast(msg) {
  const t = document.getElementById("toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("show"), 2200);
}

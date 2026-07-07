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

/** Modal with a form body. resolve(valuesObj) on submit, null on cancel/esc. */
export function modal({ title, body, submitLabel = "Save" }) {
  return new Promise((resolve) => {
    const close = (v) => { wrap.remove(); resolve(v); };
    const form = el("form", { class: "modal-form" }, body,
      el("div", { class: "modal-actions" },
        el("button", { type: "button", class: "btn-ghost", onclick: () => close(null) }, "Cancel"),
        el("button", { type: "submit", class: "btn-solid" }, submitLabel)));
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const values = {};
      for (const inp of form.querySelectorAll("[name]")) {
        values[inp.name] = inp.type === "checkbox" ? inp.checked : inp.value.trim();
      }
      close(values);
    });
    const wrap = el("div", { class: "modal-wrap", onclick: (e) => { if (e.target === wrap) close(null); } },
      el("div", { class: "modal-card glass" }, el("h3", {}, title), form));
    addEventListener("keydown", function esc(e) { if (e.key === "Escape") { removeEventListener("keydown", esc); close(null); } });
    document.body.append(wrap);
    wrap.querySelector("input,select,textarea")?.focus();
  });
}

export const field = (label, name, attrs = {}) =>
  el("label", { class: "f" }, el("span", {}, label), el("input", { name, ...attrs }));

/** Confetti-lite: 1 second, skippable by click, honors reduced-motion. */
export function confetti() {
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const host = el("div", { class: "confetti", onclick: () => host.remove() });
  for (let i = 0; i < 22; i++) {
    host.append(el("i", { style: `left:${8 + Math.random() * 84}%;animation-delay:${Math.random() * 0.25}s;` +
      `transform:rotate(${Math.random() * 360}deg);opacity:${0.5 + Math.random() * 0.5}` }));
  }
  document.body.append(host);
  setTimeout(() => host.remove(), 1100);
}

/** 15-minute focus timer chip (spec Phase 3). One at a time. */
let timerInterval;
export function focusTimer(label) {
  document.getElementById("wsTimer")?.remove();
  clearInterval(timerInterval);
  let left = 15 * 60;
  const time = el("b", {}, "15:00");
  const chip = el("div", { class: "timer-chip glass", id: "wsTimer" },
    el("span", { class: "t-label" }, label), time,
    el("button", { class: "btn-ghost", onclick: () => { chip.remove(); clearInterval(timerInterval); } }, "✕"));
  document.body.append(chip);
  timerInterval = setInterval(() => {
    left--;
    time.textContent = `${String(Math.floor(left / 60)).padStart(2, "0")}:${String(left % 60).padStart(2, "0")}`;
    if (left <= 0) { clearInterval(timerInterval); chip.classList.add("done"); time.textContent = "done"; }
  }, 1000);
}

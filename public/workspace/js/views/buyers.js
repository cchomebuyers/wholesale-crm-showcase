// Buyers — bounded table + buy boxes (spec Phase 6). Quick-add via `b` prefix.
import { el, emptyState, toast, modal, field } from "../ui.js";
import { get, patch, money } from "../api.js";

export const title = "Buyers";
export const icon = "M16 11a4 4 0 10-8 0M12 15c-4 0-7 2-7 4v1h14v-1c0-2-3-4-7-4M19 8v4M21 10h-4";

let showAll = false;

export async function mount(root) {
  let buyers;
  try { buyers = await get("/api/ws/buyers"); }
  catch (e) { root.append(el("p", { class: "view-sub" }, `couldn't load: ${e.message}`)); return; }

  root.append(
    el("h1", { class: "view-title" }, "Buyers"),
    el("div", { class: "view-sub" }, `${buyers.length} buyer${buyers.length === 1 ? "" : "s"} · quick-add with "b Name, areas, max" in the bar below`));

  if (!buyers.length) {
    root.append(emptyState({
      glyph: "💰", title: "No buyers yet",
      body: 'Press / and type: b Demo Capital, detroit, 200000 — buy boxes drive Dispo matching.',
    }));
    return;
  }

  const rows = showAll ? buyers : buyers.slice(0, 10); // 10 rows + expand, per spec
  const table = el("table", { class: "ws" },
    el("thead", {}, el("tr", {},
      ...["Name", "Buy box", "PoF", "Closed before", "Responsiveness", "Contact"].map((h) => el("th", {}, h)))),
    el("tbody", {}, rows.map((b) => el("tr", { style: "cursor:pointer", onclick: () => editBuyer(b, root) },
      el("td", {}, b.name),
      el("td", {}, [b.areas, b.property_types, b.max_price ? `≤ ${money(b.max_price)}` : null].filter(Boolean).join(" · ") || "—"),
      el("td", {}, b.pof ? "✓" : "—"),
      el("td", {}, b.closed_before ? "✓" : "—"),
      el("td", {}, el("span", { class: "stars" }, "★".repeat(b.responsiveness || 3))),
      el("td", {}, b.phone || b.email || "—")))));
  root.append(table);
  if (buyers.length > 10 && !showAll) {
    root.append(el("button", { class: "btn-ghost showmore", onclick: () => { showAll = true; root.replaceChildren(); mount(root); } },
      `show ${buyers.length - 10} more`));
  }
}

async function editBuyer(b, root) {
  const v = await modal({
    title: `Edit ${b.name}`,
    body: el("div", { style: "display:grid;gap:12px" },
      field("Name", "name", { value: b.name || "" }),
      field("Phone", "phone", { value: b.phone || "" }),
      field("Email", "email", { value: b.email || "" }),
      field("Areas (comma-sep)", "areas", { value: b.areas || "" }),
      field("Property types", "property_types", { value: b.property_types || "" }),
      field("Max price", "max_price", { inputmode: "numeric", value: b.max_price ?? "" }),
      field("Responsiveness 1-5", "responsiveness", { inputmode: "numeric", value: b.responsiveness ?? 3 }),
      el("label", { class: "check" }, el("input", { type: "checkbox", name: "pof", ...(b.pof ? { checked: "" } : {}) }), el("span", {}, "Proof of funds on file")),
      el("label", { class: "check" }, el("input", { type: "checkbox", name: "closed_before", ...(b.closed_before ? { checked: "" } : {}) }), el("span", {}, "Has closed with us before"))),
  });
  if (!v) return;
  try {
    await patch(`/api/ws/buyers/${b.id}`, {
      ...v, pof: v.pof ? 1 : 0, closed_before: v.closed_before ? 1 : 0,
      max_price: v.max_price ? +v.max_price : null, responsiveness: Math.min(5, Math.max(1, +v.responsiveness || 3)),
    });
    toast("buyer saved");
  } catch (e) { toast(e.message); }
  root.replaceChildren(); mount(root);
}

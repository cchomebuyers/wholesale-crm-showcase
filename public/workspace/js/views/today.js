// Today — the default screen (spec Phase 3).
// ONLY follow-ups due, max 5 visible, motivation-sorted. One-tap logging
// auto-schedules the next touch. Streak + confetti-lite on clear. 15-min
// focus timer on card click.
import { el, emptyState, toast, confetti, focusTimer } from "../ui.js";
import { get, post, money, mao } from "../api.js";

export const title = "Today";
export const icon = "M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M18.4 5.6L17 7M7 17l-1.4 1.4M12 8a4 4 0 100 8 4 4 0 000-8z";

let showAll = false;

export async function mount(root) {
  let state;
  try { state = await get("/api/ws/state"); }
  catch (e) { root.append(el("p", { class: "view-sub" }, `couldn't load: ${e.message}`)); return; }

  const items = [...state.revived.map((l) => ({ ...l, revived: true })), ...state.due];
  root.append(
    el("div", { style: "display:flex;justify-content:space-between;align-items:baseline" },
      el("div", {},
        el("h1", { class: "view-title" }, "Today"),
        el("div", { class: "view-sub" }, `${items.length} follow-up${items.length === 1 ? "" : "s"} due · tap to log · click card for a 15-min focus timer`)),
      el("span", { class: "streak" }, `🔥 ${state.streak}-day streak`)),
  );

  if (!items.length) {
    root.append(emptyState({
      glyph: "✓", title: "All clear",
      body: "Every follow-up is handled. Go find the next deal — or take the win.",
    }));
    post("/api/ws/clear-check").catch(() => {});
    return;
  }

  const list = el("div", { class: "today-list" });
  const visible = showAll ? items : items.slice(0, 5); // max 5 visible, per spec
  for (const lead of visible) list.append(card(lead, root));
  root.append(list);
  if (items.length > 5 && !showAll) {
    root.append(el("button", { class: "btn-ghost showmore", onclick: () => { showAll = true; remount(root); } },
      `show ${items.length - 5} more`));
  }
}

function remount(root) { root.replaceChildren(); mount(root); }

function card(lead, root) {
  const overdueDays = Math.floor((Date.now() - Date.parse(lead.next_followup || lead.ws_revive_date)) / 86400000);
  const label = lead.address || lead.seller_name || `lead #${lead.id}`;
  const maoVal = lead.arv ? mao(lead.arv, lead.repair_estimate, lead.assignment_fee ?? 10000) : null;
  const incomplete = !(lead.seller_phone || lead.seller_email);

  const tap = (type, text) => el("button", {
    class: "tap",
    onclick: async (e) => {
      e.stopPropagation();
      try {
        const r = await post("/api/ws/log", { lead_id: lead.id, type });
        toast(`${text} logged${r.next_followup ? ` — next touch ${r.next_followup}` : ""}`);
        const check = await post("/api/ws/clear-check");
        if (check.cleared && check.firstClearToday) confetti();
        remount(root);
      } catch (err) { toast(err.message); }
    },
  }, text);

  return el("div", {
    class: "card glass", role: "button", tabindex: "0",
    onclick: () => focusTimer(label),
  },
  el("div", { class: "addr" }, label,
    incomplete ? el("span", { class: "dot-incomplete", title: "missing contact info" }) : null,
    " ",
    lead.revived
      ? el("span", { class: "urgent-badge" }, "revived — call today")
      : overdueDays > 0 ? el("span", { class: "urgent-badge" }, `${overdueDays}d overdue`) : null),
  el("div", { class: "meta" },
    lead.motivation ? el("span", { class: "badge" }, lead.motivation) : null,
    ` ${lead.stage}`,
    lead.seller_name && lead.address ? ` · ${lead.seller_name}` : "",
    lead.seller_phone ? ` · ${lead.seller_phone}` : "",
    maoVal != null ? ` · MAO ${money(maoVal)}` : ""),
  el("div", { class: "taps" },
    tap("call_no_answer", "No Answer"),
    tap("call_spoke", "Spoke"),
    tap("offer_made", "Offer Made")));
}

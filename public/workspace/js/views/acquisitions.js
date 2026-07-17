// Acquisitions — seller pipeline kanban (spec Phase 4).
// Native drag-drop between stages · inline MAO calc on every card (never leave
// the card to do math) · Dead requires a revive date · Under Contract opens the
// blocking deal modal (Ontario assignment-clause disclosure).
import { el, toast, modal, field, focusTimer } from "../ui.js";
import { get, post, patch, del, money, mao, daysAgo } from "../api.js";

export const title = "Acquisitions";
export const icon = "M3 11l9-7 9 7M5 10v9a1 1 0 001 1h3v-5h6v5h3a1 1 0 001-1v-9";

const COL_CAP = 8; // bounded lists, per spec
const expanded = new Set();

export async function mount(root) {
  let data;
  try { data = await get("/api/ws/leads"); }
  catch (e) { root.append(el("p", { class: "view-sub" }, `couldn't load: ${e.message}`)); return; }

  root.append(
    el("h1", { class: "view-title" }, "Acquisitions"),
    el("div", { class: "view-sub" }, `${data.leads.length} active leads · drag between stages · click 💲 for inline MAO`));

  const board = el("div", { class: "board" });
  for (const stage of data.stages) {
    const inStage = data.leads.filter((l) => l.stage === stage);
    const col = el("div", { class: "kcol", "data-stage": stage },
      el("h3", {}, stage, el("span", {}, String(inStage.length))));
    col.addEventListener("dragover", (e) => { e.preventDefault(); col.classList.add("dragover"); });
    col.addEventListener("dragleave", () => col.classList.remove("dragover"));
    col.addEventListener("drop", (e) => { e.preventDefault(); col.classList.remove("dragover"); onDrop(e, stage, root); });
    const showN = expanded.has(stage) ? inStage.length : COL_CAP;
    for (const lead of inStage.slice(0, showN)) col.append(kcard(lead, root));
    if (inStage.length > showN) {
      col.append(el("button", { class: "btn-ghost", style: "width:100%",
        onclick: () => { expanded.add(stage); remount(root); } }, `show ${inStage.length - showN} more`));
    }
    board.append(col);
  }
  root.append(board);
}

function remount(root) { root.replaceChildren(); mount(root); }

function kcard(lead, root) {
  const maoVal = mao(lead.arv, lead.repair_estimate, lead.assignment_fee ?? 10000);
  const days = daysAgo(lead.updated_at);
  const closingSoon = false; // closing countdown lives on Dispo
  const cardEl = el("div", { class: "kcard", draggable: "true", "data-id": lead.id },
    el("div", { class: "a" }, lead.address || lead.seller_name || `#${lead.id}`,
      !(lead.seller_phone || lead.seller_email) ? el("span", { class: "dot-incomplete", title: "incomplete" }) : null),
    el("div", { class: "m" },
      lead.motivation ? el("span", { class: "badge" }, lead.motivation) : null,
      el("span", {}, `${days}d in stage`),
      lead.next_followup ? el("span", {}, `next ${lead.next_followup}`) : null,
      el("span", { class: "mao-chip", role: "button", title: "inline deal calc",
        onclick: (e) => { e.stopPropagation(); cardEl.classList.toggle("open"); } },
        lead.arv ? `💲 MAO ${money(maoVal)}` : "💲 set numbers"),
      el("span", { class: "mao-chip", role: "button", title: "15-min sprint: work this lead",
        onclick: (e) => { e.stopPropagation(); focusTimer(lead.address || lead.seller_name || `lead #${lead.id}`, 15); } },
        "⏱ 15m")),
    calcRow(lead));
  cardEl.addEventListener("dragstart", (e) => {
    e.dataTransfer.setData("text/plain", String(lead.id));
    cardEl.classList.add("dragging");
  });
  cardEl.addEventListener("dragend", () => cardEl.classList.remove("dragging"));
  return cardEl;
}

// inline calculator: editable ARV / repairs / fee → live MAO (spec Phase 4)
function calcRow(lead) {
  const out = el("span", { class: "mao-chip" });
  const inputs = {};
  const upd = () => { out.textContent = `= MAO ${money(mao(inputs.arv.value, inputs.repairs.value, inputs.fee.value))}`; };
  const mk = (name, ph, val) => {
    inputs[name] = el("input", { placeholder: ph, value: val ?? "", inputmode: "numeric",
      onclick: (e) => e.stopPropagation(), oninput: upd,
      onchange: async () => {
        try {
          await patch(`/api/ws/leads/${lead.id}`, {
            arv: inputs.arv.value || null, repair_estimate: inputs.repairs.value || null,
            assignment_fee: inputs.fee.value || null });
          toast("numbers saved");
        } catch (e) { toast(e.message); }
      } });
    return inputs[name];
  };
  const row = el("div", { class: "kcalc" },
    mk("arv", "ARV", lead.arv), mk("repairs", "repairs", lead.repair_estimate),
    mk("fee", "fee", lead.assignment_fee ?? 10000), out);
  upd();
  return row;
}

async function onDrop(e, stage, root) {
  const id = +e.dataTransfer.getData("text/plain");
  if (!id) return;
  try {
    if (stage === "Dead") {
      const v = await modal({
        title: "Kill lead — set a revive date",
        submitLabel: "Kill + schedule revive",
        body: el("div", {}, field("Revive on", "ws_revive_date", { type: "date", required: "true",
          value: new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10) })),
      });
      if (!v) return remount(root);
      await patch(`/api/ws/leads/${id}`, { stage, ws_revive_date: v.ws_revive_date });
      toast(`dead — revives ${v.ws_revive_date}`);
    } else if (stage === "Under Contract") {
      // auto-create Deal, blocking Ontario disclosure (spec Phase 4)
      const v = await modal({
        title: "Under contract — create the deal",
        submitLabel: "Create deal",
        body: el("div", { style: "display:grid;gap:12px" },
          field("Contract price", "contract_price", { inputmode: "numeric", required: "true" }),
          field("Assignment fee target", "assignment_fee_target", { inputmode: "numeric" }),
          field("EMD", "emd", { inputmode: "numeric" }),
          field("Closing date", "closing_date", { type: "date", required: "true" }),
          field("Title company", "title_company", {}),
          el("label", { class: "check" },
            el("input", { type: "checkbox", name: "assignment_clause_confirmed" }),
            el("span", {}, "I confirm the assignment clause + Ontario wholesaling disclosure requirements are satisfied for this contract. (required)"))),
      });
      if (!v) return remount(root);
      await post("/api/ws/deals", {
        lead_id: id,
        contract_price: +v.contract_price || null,
        assignment_fee_target: +v.assignment_fee_target || null,
        emd: +v.emd || null,
        closing_date: v.closing_date || null,
        title_company: v.title_company || null,
        assignment_clause_confirmed: v.assignment_clause_confirmed === true,
      });
      toast("deal created — see Dispo");
    } else {
      await patch(`/api/ws/leads/${id}`, { stage });
    }
  } catch (err) { toast(err.message); }
  remount(root);
}

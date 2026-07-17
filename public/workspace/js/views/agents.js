// Agents — the crew, organized for one ADHD brain.
// Layout (top → bottom): ONE next action (the coach's pick, with a sprint
// timer) · compact crew strip (click a row to unfold its job + latest report)
// · triaged work queue (money groups first, 3 visible per group) · report
// accordion (one line per agent, click for history). Polls while anything
// runs so RUN → working → new report flips live.
import { el, toast, focusTimer } from "../ui.js";
import { get, post, put, money } from "../api.js";
import { botSprite, BOTS } from "../bots.js";

export const title = "Agents";
export const icon = "M12 2v3M8 7h8a2 2 0 012 2v7a2 2 0 01-2 2H8a2 2 0 01-2-2V9a2 2 0 012-2zM9.5 12h.01M14.5 12h.01M4 13h2M18 13h2M10 15h4";

const AGENT_INFO = {
  briefing: "Files a 'here's your day' briefing to the 🔔 bell every morning after 7am — AI-written when Claude is connected, deterministic otherwise.",
  momentum: "Watches for due follow-ups, call-backs, and stuck leads — files dated tasks so nothing goes cold.",
  acquisitions: "Promotes lead-engine shortlist candidates into leads, dedupes by address, files review tasks.",
  underwriting: "Prices leads — writes ARV/MAO onto the lead and files send-offer tasks for deals that clear.",
  outreach: "Drafts seller scripts into the activity feed and files approve-&-send tasks. Never sends on its own.",
  emailer: "Writes offer emails in Sonny's voice — realtor or homeowner template auto-picked per lead, AI-polished when Claude is connected — into the Outbox below. You approve; sending stamps the offer + advances the stage.",
  doctor: "Runs a full health check — server, database, backups, inbox sync, funnel, logs, integration keys — and files a 'Fix: …' task for anything broken.",
  comps: "Prices unpriced leads for free — pulls Detroit parcel + recorded-sales comps through the underwrite engine, writes ARV/MAO onto the lead, files send-offer tasks for deals that clear.",
  replies: "Triages inbound replies matched to leads — interested / counter / not-interested / question — advances the stage and files the exact next-action task. Never kills a lead on its own.",
};

// work-queue triage: what the item IS decides its group; money groups first
const QUEUE_GROUPS = [
  { key: "offers", label: "💵 Send offers", test: (t) => /^(send offer|approve & send|approve offer email)/i.test(t) },
  { key: "followups", label: "📞 Follow-ups", test: (t) => /^(follow up|call back)/i.test(t) },
  { key: "review", label: "📥 Review", test: (t) => /^(review|unstick)/i.test(t) },
  { key: "other", label: "🔧 Other", test: () => true },
];
const GROUP_CAP = 3;

// UI state that survives re-renders/polls
const openCrew = new Set();      // agent names with an unfolded strip row
const openGroups = new Set();    // queue groups expanded past the cap
const openReports = new Set();   // agents with unfolded history

let pollTimer = null;

export async function mount(root) {
  clearInterval(pollTimer);
  let data;
  try { data = await get("/api/agents"); }
  catch (e) { root.append(el("p", { class: "view-sub" }, `couldn't load: ${e.message}`)); return; }
  try { outbox = await get("/api/email-queue"); } catch { /* server without the queue yet */ }

  const body = el("div", { class: "agents-body" });
  root.append(body);
  render(body, data);

  const schedule = () => {
    clearInterval(pollTimer);
    const active = data.agents.some((a) => a.running);
    pollTimer = setInterval(async () => {
      if (!body.isConnected) return clearInterval(pollTimer);
      try {
        const fresh = await get("/api/agents");
        try { outbox = await get("/api/email-queue"); } catch { /* keep last */ }
        const wasActive = data.agents.some((a) => a.running);
        data = fresh;
        render(body, data);
        if (wasActive !== data.agents.some((a) => a.running)) schedule();
      } catch { /* transient — keep polling */ }
    }, active ? 3000 : 30000);
  };
  schedule();
}

function render(body, data) {
  lastData = data;
  body.replaceChildren(
    header(data, body),
    nextHero(data.next),
    outboxPanel(data, body),
    crewStrip(data, body),
    workQueue(data.tasks, body),
    reportAccordion(data.history, data.agents, body),
  );
}

// ---- Outbox — the Sonny Emailer's drafts, you approve & send --------------------
let outbox = { emails: [], counts: {} };
const openDrafts = new Set(); // draft ids expanded to show the editable body

async function refreshOutbox(body) {
  try { outbox = await get("/api/email-queue"); } catch { /* keep last */ }
  rerender(body);
}

function outboxPanel(data, body) {
  const drafts = outbox.emails || [];
  const emailerBusy = data.agents.find((a) => a.name === "emailer")?.running;
  const wrap = el("div", { class: "agent-trail outbox" },
    el("h2", { class: "trail-title" }, "✉ Outbox — offers in Sonny's voice ",
      el("span", { class: "badge" }, drafts.length ? `${drafts.length} waiting` : (outbox.counts?.sent ? `${outbox.counts.sent} sent` : "empty")),
      el("span", { style: "margin-left:auto;display:inline-flex;gap:8px" },
        el("button", {
          class: "btn-ghost", disabled: emailerBusy ? "true" : null,
          title: "Find offer-ready leads (email + priced offer) and draft each one",
          onclick: async (e) => {
            e.target.disabled = true;
            try { await post("/api/agents/emailer/run"); toast("Sonny Emailer dispatched"); }
            catch (err) { toast(err.message); }
            refreshSoon(body); setTimeout(() => refreshOutbox(body), 4000);
          },
        }, emailerBusy ? "writing…" : "✍ Draft offers"),
        drafts.length > 1 ? el("button", {
          class: "btn-solid",
          onclick: async (e) => {
            if (!confirm(`Send all ${drafts.length} drafted offer emails now?`)) return;
            e.target.disabled = true;
            try {
              const r = await post("/api/email-queue/send-all");
              toast(`sent ${r.sent}/${r.of}` + (r.errors?.length ? ` · ${r.errors.length} failed` : " ✓"));
            } catch (err) { toast(err.message); }
            refreshOutbox(body);
          },
        }, `Send all (${drafts.length})`) : null)));
  if (!drafts.length) {
    wrap.append(el("p", { class: "agent-job" },
      emailerBusy ? "The emailer is reading offer-ready leads and writing each email…"
        : "No drafts waiting. ✍ Draft offers finds leads with an email + a priced offer (no offer sent yet), writes each in Sonny's voice — realtor or homeowner template auto-picked — and parks them here. Nothing sends until you say so."));
    return wrap;
  }
  for (const q of drafts) wrap.append(draftRow(q, body));
  return wrap;
}

function draftRow(q, body) {
  const open = openDrafts.has(q.id);
  const row = el("div", { class: "queue-row ob-row" + (open ? " open" : "") },
    el("span", { class: "badge" }, q.recipient_type === "realtor" ? "🏢 realtor" : "🏠 homeowner"),
    el("span", { class: "queue-title", role: "button",
      onclick: () => { open ? openDrafts.delete(q.id) : openDrafts.add(q.id); rerender(body); } },
      q.lead_address || q.lead_seller || `lead #${q.lead_id}`,
      el("span", { class: "queue-addr" }, ` · ${q.subject}`)),
    q.offer_amount ? el("span", { class: "trail-time" }, money(q.offer_amount)) : null,
    q.ai ? el("span", { class: "badge", title: "AI-rewritten in Sonny's voice" }, "✨") : null,
    el("button", {
      class: "btn-ghost", title: "drop this draft",
      onclick: async (e) => {
        e.target.disabled = true;
        try { await post(`/api/email-queue/${q.id}/dismiss`); toast("dismissed"); } catch (err) { toast(err.message); }
        refreshOutbox(body);
      },
    }, "✕"),
    el("button", {
      class: "btn-solid",
      onclick: async (e) => {
        e.target.disabled = true; e.target.textContent = "sending…";
        try {
          // persist any inline edits before firing
          const box = e.target.closest(".ob-wrap");
          const subj = box?.querySelector(".ob-subject")?.value;
          const bodyTxt = box?.querySelector(".ob-body")?.value;
          if (subj != null || bodyTxt != null) await put(`/api/email-queue/${q.id}`, { subject: subj, body: bodyTxt });
          const r = await post(`/api/email-queue/${q.id}/send`);
          toast(`offer sent ✓${r.stage ? " · " + r.stage : ""}`);
        } catch (err) { toast(err.message); }
        refreshOutbox(body);
      },
    }, "✉ Send"));
  if (!open) return el("div", { class: "ob-wrap" }, row);
  return el("div", { class: "ob-wrap open" }, row,
    el("div", { class: "ob-detail" },
      el("div", { class: "ob-to" }, `to ${q.to_addr}`),
      el("input", { class: "ob-subject", value: q.subject }),
      el("textarea", { class: "ob-body", rows: 9 }, q.body)));
}

// ---- header + run all ---------------------------------------------------------
function header(data, body) {
  const runningN = data.agents.filter((a) => a.running).length;
  return el("div", { style: "display:flex;justify-content:space-between;align-items:baseline;gap:12px;flex-wrap:wrap" },
    el("div", {},
      el("h1", { class: "view-title" }, "Agents"),
      el("div", { class: "view-sub" },
        runningN ? `clawd.unit · ${runningN} working` : `clawd.unit · idle · nothing sends without you`)),
    el("button", {
      class: "btn-ghost",
      onclick: async (e) => {
        e.target.disabled = true;
        let n = 0;
        for (const a of data.agents) {
          if (a.running) continue;
          try { await post(`/api/agents/${a.name}/run`); n++; } catch { /* busy */ }
        }
        toast(n ? `${n} dispatched` : "all already running");
        refreshSoon(body);
      },
    }, "▸ Run all"));
}

// ---- 1 · the ONE next action ----------------------------------------------------
function nextHero(next) {
  if (!next) return el("div");
  return el("div", { class: "next-hero" + (next.kind === "clear" ? " clear" : "") },
    el("span", { class: "nh-label" }, "next"),
    el("div", { class: "nh-main" },
      el("div", { class: "nh-title" }, next.title),
      el("div", { class: "nh-why" }, next.why || "")),
    next.kind !== "clear"
      ? el("button", { class: "btn-solid nh-go", onclick: () => focusTimer(next.title, next.timeboxMin || 15) },
          `⏱ ${next.timeboxMin || 15}m`)
      : null);
}

// ---- 2 · compact crew strip ------------------------------------------------------
function crewStrip(data, body) {
  const wrap = el("div", { class: "crew" });
  for (const a of data.agents) wrap.append(crewRow(a, body));
  // the autonomous engine as a strip row too — one crew, one box
  const run = data.leadEngine;
  wrap.append(el("div", { class: "crew-row is-auto", title: BOTS.engine.title },
    botSprite("engine", 34),
    el("span", { class: "crew-name" }, "Lead Engine", el("span", { class: "badge", style: "margin-left:6px" }, "auto")),
    el("span", { class: "crew-when" },
      run ? `${ago(run.created_at)} · ${run.raw_records ?? 0}→${run.converged_properties ?? 0}→${run.shortlist_count ?? 0} shortlisted` : "no runs yet"),
    el("span", { class: "crew-run" })));
  return wrap;
}

function crewRow(a, body) {
  const open = openCrew.has(a.name);
  const row = el("div", { class: "crew-row" + (a.running ? " is-running" : "") + (open ? " open" : ""), title: BOTS[a.name]?.title || "" },
    botSprite(a.name, 34),
    el("span", { class: "crew-name", role: "button",
      onclick: () => { open ? openCrew.delete(a.name) : openCrew.add(a.name); rerender(body); } },
      a.label),
    a.running
      ? el("span", { class: "crew-when running" }, el("i", { class: "status-dot live" }), "working…")
      : el("span", { class: "crew-when" }, el("i", { class: "status-dot" + (a.lastRun ? "" : " never") }), a.lastRun ? ago(a.lastRun) : "never run"),
    el("button", {
      class: "btn-ghost crew-run", disabled: a.running ? "true" : null,
      onclick: async (e) => {
        e.stopPropagation(); e.target.disabled = true; e.target.textContent = "…";
        try { await post(`/api/agents/${a.name}/run`); toast(`${a.label} dispatched`); }
        catch (err) { toast(err.message); }
        refreshSoon(body);
      },
    }, a.running ? "…" : "▸ Run"));
  if (!open) return row;
  return el("div", { class: "crew-open-wrap" }, row,
    el("div", { class: "crew-detail" },
      el("p", { class: "agent-job", style: "margin-top:0" }, AGENT_INFO[a.name] || ""),
      el("div", { class: "agent-report" },
        el("span", { class: "agent-report-label" }, "last report"),
        el("span", { class: "agent-digest" }, a.digest || "never run"))));
}

// ---- 3 · triaged work queue -------------------------------------------------------
function workQueue(tasks, body) {
  const wrap = el("div", { class: "agent-trail" },
    el("h2", { class: "trail-title" }, "Work queue ",
      el("span", { class: "badge" }, `${tasks.length} open`)));
  if (!tasks.length) {
    wrap.append(el("p", { class: "agent-job" }, "Queue clear 🎉 — run the crew to refill it."));
    return wrap;
  }
  const remaining = [...tasks];
  for (const g of QUEUE_GROUPS) {
    const mine = [];
    for (let i = remaining.length - 1; i >= 0; i--) {
      if (g.test(remaining[i].title)) mine.unshift(...remaining.splice(i, 1));
    }
    if (!mine.length) continue;
    const expanded = openGroups.has(g.key);
    const shown = expanded ? mine : mine.slice(0, GROUP_CAP);
    const head = el("div", { class: "wq-head" },
      el("span", { class: "wq-label" }, g.label, " ", el("span", { class: "wq-count" }, String(mine.length))));
    if (mine.length > GROUP_CAP) {
      head.append(el("button", { class: "btn-ghost wq-more",
        onclick: () => { expanded ? openGroups.delete(g.key) : openGroups.add(g.key); rerender(body); } },
        expanded ? "less" : `+${mine.length - GROUP_CAP} more`));
    }
    wrap.append(head);
    for (const t of shown) wrap.append(queueRow(t, body));
  }
  return wrap;
}

function queueRow(t, body) {
  return el("div", { class: "queue-row" },
    el("button", {
      class: "queue-done", title: "mark done",
      onclick: async (e) => {
        e.target.disabled = true;
        try { await post(`/api/tasks/${t.id}/toggle`); toast("done ✓"); refreshSoon(body); }
        catch (err) { toast(err.message); }
      },
    }, "✓"),
    el("span", { class: "queue-title" }, t.title,
      t.address ? el("span", { class: "queue-addr" }, ` · ${t.address}`) : null),
    t.due_date ? el("span", { class: "trail-time" }, `due ${t.due_date}`) : null,
    el("button", { class: "btn-ghost queue-timer", title: "25-minute sprint on this",
      onclick: () => focusTimer(t.title, 25) }, "⏱"));
}

// ---- 4 · report accordion ------------------------------------------------------------
function reportAccordion(history, agents, body) {
  const label = Object.fromEntries(agents.map((a) => [a.name, a.label]));
  const byAgent = {};
  for (const r of history) (byAgent[r.agent] ||= []).push(r); // history is newest-first
  const wrap = el("div", { class: "agent-trail" },
    el("h2", { class: "trail-title" }, "Reports"));
  const names = Object.keys(byAgent);
  if (!names.length) {
    wrap.append(el("p", { class: "agent-job" }, "No reports yet — run an agent above."));
    return wrap;
  }
  // newest activity first
  names.sort((a, b) => (byAgent[b][0].finished_at || "").localeCompare(byAgent[a][0].finished_at || ""));
  for (const name of names) {
    const runs = byAgent[name];
    const open = openReports.has(name);
    wrap.append(el("div", { class: "rep-head", role: "button",
      onclick: () => { open ? openReports.delete(name) : openReports.add(name); rerender(body); } },
      el("span", { class: "rep-arrow" }, open ? "▾" : "▸"),
      el("span", { class: "trail-agent" }, label[name] || name),
      el("span", { class: "trail-digest rep-latest" }, runs[0].digest || "—"),
      el("span", { class: "trail-time" }, ago(runs[0].finished_at))));
    if (open) {
      for (const r of runs.slice(1)) {
        wrap.append(el("div", { class: "rep-item" },
          el("span", { class: "trail-digest" }, r.digest || "—"),
          el("span", { class: "trail-time" }, ago(r.finished_at))));
      }
      if (runs.length === 1) wrap.append(el("div", { class: "rep-item" }, el("span", { class: "trail-digest" }, "no earlier runs")));
    }
  }
  return wrap;
}

// ---- helpers -----------------------------------------------------------------------
let lastData = null;
function rerender(body) {
  // re-render from the freshest data we have without a network round-trip
  if (lastData) render(body, lastData);
  else refreshSoon(body, 0);
}

function refreshSoon(body, delay = 600) {
  setTimeout(async () => {
    if (!body.isConnected) return;
    try { render(body, await get("/api/agents")); } catch { /* next poll */ }
  }, delay);
}

function ago(iso) {
  if (!iso) return "never";
  const s = Math.max(0, (Date.now() - Date.parse(iso)) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

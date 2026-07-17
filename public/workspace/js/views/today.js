// Today — single-screen command dashboard (zero page scroll on desktop).
// Fixed grid: header (briefing status) · KPI strip · [Do Today | Alerts/News | Email].
// Every panel scrolls internally, never the page. All times Eastern. Data from
// GET /api/ws/dashboard; the Daily Briefing agent + news job keep the caches
// warm server-side. Skeletons on first paint, 60s repoll, no layout shift.
import { el, toast } from "../ui.js";
import { get, post, money } from "../api.js";
import { botSprite } from "../bots.js";

export const title = "Today";
export const icon = "M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M18.4 5.6L17 7M7 17l-1.4 1.4M12 8a4 4 0 100 8 4 4 0 000-8z";

let pollTimer = null;
let dashData = null;
const openEmails = new Set();

const ET = { timeZone: "America/New_York" };
const fmtTime = (iso) => iso ? new Date(iso).toLocaleTimeString("en-US", { ...ET, hour: "numeric", minute: "2-digit" }) : "—";
const fmtWhen = (iso) => {
  if (!iso) return "—";
  const d = new Date(iso);
  const today = new Date().toLocaleDateString("en-US", ET);
  return d.toLocaleDateString("en-US", ET) === today
    ? fmtTime(iso)
    : d.toLocaleDateString("en-US", { ...ET, month: "short", day: "numeric" });
};

export async function mount(root) {
  clearInterval(pollTimer);
  // dashboard mode: full width, no page scroll (removed when navigating away)
  const main = document.getElementById("main");
  main.classList.add("dash");
  addEventListener("hashchange", function off() {
    if (!location.hash.includes("today") && location.hash !== "" && location.hash !== "#/") {
      main.classList.remove("dash"); removeEventListener("hashchange", off);
    }
  });

  const shell = el("div", { class: "tdash" },
    el("div", { class: "td-head" },
      el("div", { class: "td-title" }, "Today",
        el("span", { class: "td-date" }, new Date().toLocaleDateString("en-US", { ...ET, weekday: "short", month: "short", day: "numeric" }), " ET"))),
    el("div", { class: "td-kpis", id: "tdKpis" }, ...Array.from({ length: 7 }, () => el("div", { class: "kpi skel-box" }, skel(60, 22), skel(80, 10)))),
    el("div", { class: "td-grid" },
      el("div", { class: "td-col" },
        panel("tdDo", "Do Today"),
        panel("tdAlerts", "Alerts")),
      el("div", { class: "td-mid" },
        panel("tdBriefP", "Daily Briefing"),
        panel("tdNews", "Daily News")),
      panel("tdMail", "Email")));
  root.append(shell);

  await refresh(root);
  pollTimer = setInterval(() => {
    if (!shell.isConnected) return clearInterval(pollTimer);
    refresh(root);
  }, 60_000);
}

const panel = (id, name) => el("section", { class: "td-panel" },
  el("header", { class: "td-panel-head" }, el("h2", {}, name), el("span", { class: "td-badge", id: id + "Badge" })),
  el("div", { class: "td-panel-body", id: id },
    el("div", { class: "td-skel" }, skel("90%", 12), skel("75%", 12), skel("85%", 12))));

const skel = (w, h) => el("span", { class: "skel", style: `width:${typeof w === "number" ? w + "px" : w};height:${h}px` });

async function refresh(root) {
  try { dashData = await get("/api/ws/dashboard"); }
  catch (e) { toast("dashboard: " + e.message); return; }
  renderBrief(root); renderKpis(); renderDo(root); renderAlerts(); renderNews(root); renderMail(root);
}

// ---- Daily Briefing panel: the bot at his desk + his report ------------------------
// The clawdbot sits at a pixel desk; monitor flickers while idle-bobbing, claws
// snip while he's actually on a run. His structured report fills the panel.
let briefingWorking = false;

function deskScene(b, root) {
  const scene = el("div", { class: "agent-desk" + (briefingWorking ? " working" : "") });
  scene.append(botSprite("briefing", 52));
  const desk = el("div", { class: "desk-art" });
  desk.innerHTML = `<svg viewBox="0 0 150 74" width="150" height="74">
    <!-- monitor -->
    <rect x="96" y="18" width="40" height="27" rx="2.5" fill="#141420" stroke="#383835" stroke-width="1.5"/>
    <rect class="scr" x="101" y="24" width="22" height="2.4" rx="1.2" fill="#3987e5"/>
    <rect class="scr" x="101" y="29" width="28" height="2.4" rx="1.2" fill="#3987e5"/>
    <rect class="scr" x="101" y="34" width="17" height="2.4" rx="1.2" fill="#3987e5"/>
    <rect class="cursor" x="101" y="39" width="6" height="2.4" rx="1.2" fill="#f5d78e"/>
    <rect x="112" y="45" width="7" height="6" fill="#383835"/>
    <rect x="104" y="51" width="24" height="3" rx="1.5" fill="#383835"/>
    <!-- coffee -->
    <rect x="78" y="46" width="10" height="9" rx="2" fill="#52514e"/>
    <rect class="steam" x="81" y="38" width="2" height="5" rx="1" fill="#6e7672"/>
    <rect class="steam s2" x="85" y="36" width="2" height="7" rx="1" fill="#6e7672"/>
    <!-- desk -->
    <rect x="4" y="55" width="142" height="7" rx="3" fill="#383835"/>
    <rect x="12" y="62" width="5" height="12" fill="#2c2c2a"/>
    <rect x="133" y="62" width="5" height="12" fill="#2c2c2a"/>
  </svg>`;
  scene.append(desk);
  scene.append(el("div", { class: "desk-status" },
    el("span", { class: "desk-dot" + (briefingWorking ? " live" : "") }),
    el("span", {}, briefingWorking ? "working…"
      : b ? `on shift · last run ${fmtTime(b.ranAt)} ET · ${b.mode}${b.source === "ai" ? " · AI" : ""}` : "hasn't clocked in yet"),
    el("button", {
      class: "btn-ghost desk-run",
      disabled: briefingWorking ? "true" : null,
      onclick: async (e) => {
        e.target.disabled = true;
        briefingWorking = true; renderBrief(root);
        try { await post("/api/agents/briefing/run", {}); }
        catch (err) { toast(err.message); }
        setTimeout(async () => { briefingWorking = false; await refresh(root); }, 8000);
      },
    }, briefingWorking ? "…" : "Run briefing")));
  return scene;
}

function renderBrief(root) {
  const host = document.getElementById("tdBriefP");
  const badge = document.getElementById("tdBriefPBadge");
  if (!host) return;
  const b = dashData.briefing;
  if (badge) badge.textContent = b ? fmtTime(b.ranAt) : "";
  const report = el("div", { class: "desk-report" });
  if (!b) {
    report.append(el("p", { class: "td-empty" }, "No report filed yet — send him on a run."));
  } else {
    report.append(el("p", { class: "desk-headline" }, b.headline));
    for (const line of (b.lines || []).slice(0, 4)) report.append(el("p", { class: "desk-line" }, line));
    if (b.top3?.length) {
      report.append(el("p", { class: "desk-top3-title" }, "Top 3 today"));
      b.top3.slice(0, 3).forEach((x, i) =>
        report.append(el("p", { class: "desk-top3" }, el("b", {}, `${i + 1}`), x.action)));
    }
    const d = b.deltas && Object.keys(b.deltas).length
      ? "since 8am: " + Object.entries(b.deltas).map(([k, v]) => `${k} ${v > 0 ? "+" : ""}${v}`).join(" · ")
      : null;
    if (d) report.append(el("p", { class: "desk-deltas" }, d));
  }
  host.replaceChildren(deskScene(b, root), report);
}

// ---- viz primitives (dataviz spec: 2px lines, tracks = dim step of same hue,
// text wears ink tokens, marks carry the color) --------------------------------------
const VIZ = { accent: "#3987e5", accentDim: "#184f95", good: "#0ca30c", warning: "#fab219", critical: "#d03b3b", track: "#2c2c2a" };

function ring(pct, { size = 52, stroke = 5, color = VIZ.accent, track = VIZ.track, center = "", sub = "" } = {}) {
  const r = (size - stroke) / 2, c = 2 * Math.PI * r, p = Math.max(0, Math.min(1, pct));
  const host = el("div", { class: "viz-ring", style: `width:${size}px;height:${size}px` });
  host.innerHTML = `<svg viewBox="0 0 ${size} ${size}" width="${size}" height="${size}">
    <circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="${track}" stroke-width="${stroke}"/>
    <circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="${color}" stroke-width="${stroke}"
      stroke-linecap="round" stroke-dasharray="${c * p} ${c}" transform="rotate(-90 ${size / 2} ${size / 2})"
      style="transition:stroke-dasharray .4s ease"/>
    <text x="50%" y="${sub ? "46%" : "52%"}" text-anchor="middle" dominant-baseline="middle"
      fill="var(--ink)" font-size="${size * 0.26}" font-weight="650" font-family="inherit">${center}</text>
    ${sub ? `<text x="50%" y="66%" text-anchor="middle" fill="var(--ink-3)" font-size="${size * 0.15}" font-family="inherit">${sub}</text>` : ""}
  </svg>`;
  return host;
}

function spark(series, { w = 72, h = 22, color = VIZ.accentDim, dot = VIZ.accent } = {}) {
  const max = Math.max(1, ...series);
  const pts = series.map((v, i) => [(i / (series.length - 1)) * (w - 6) + 3, h - 3 - (v / max) * (h - 8)]);
  const host = el("div", { class: "viz-spark" });
  host.innerHTML = `<svg viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">
    <polyline points="${pts.map((p) => p.join(",")).join(" ")}" fill="none" stroke="${color}" stroke-width="2"
      stroke-linejoin="round" stroke-linecap="round"/>
    <circle cx="${pts.at(-1)[0]}" cy="${pts.at(-1)[1]}" r="3" fill="${dot}" stroke="var(--bg-raise)" stroke-width="2"/>
  </svg>`;
  return host;
}

function meter(pct, { color = VIZ.accent, track = VIZ.track } = {}) {
  const p = Math.max(0, Math.min(1, pct));
  return el("div", { class: "viz-meter", style: `background:${track}` },
    el("i", { style: `width:${Math.round(p * 100)}%;background:${color}` }));
}

// ---- KPI strip: rings for trackers, sparklines for flows, meters for shares --------
function renderKpis() {
  const k = dashData.kpis, h = dashData.history || {};
  const host = document.getElementById("tdKpis");
  if (!host) return;

  const tile = (viz, label, sub, cls = "") => el("div", { class: "kpi " + cls },
    viz, el("div", { class: "kpi-text" },
      el("span", { class: "kpi-label" }, label), sub ? el("span", { class: "kpi-sub" }, sub) : null));
  const numViz = (v) => el("b", { class: "kpi-num" }, String(v));

  // offers ring — THE daily tracker; green when target hit
  const offersHit = k.offersToday >= k.offersTarget;
  const offersRing = ring(k.offersToday / k.offersTarget, {
    size: 58, color: offersHit ? VIZ.good : VIZ.accent, center: `${k.offersToday}/${k.offersTarget}` });

  // follow-ups ring — full green when clear; red arc = overdue share
  const fuClear = k.followupsDue === 0;
  const fuRing = ring(fuClear ? 1 : (k.followupsOverdue ? 1 : 0.5), {
    size: 58, color: fuClear ? VIZ.good : (k.followupsOverdue ? VIZ.critical : VIZ.warning),
    center: fuClear ? "✓" : String(k.followupsDue) });

  // contract goal ring — 1/week
  const contractRing = ring(Math.min(1, k.contracts), {
    size: 58, color: k.contracts ? VIZ.good : VIZ.accent, center: String(k.contracts) });

  const collectedShare = k.pipelineValue ? k.collectedFees / (k.pipelineValue + k.collectedFees) : 0;

  host.replaceChildren(
    tile(offersRing, "offers today", offersHit ? "target hit" : "resets 9am ET"),
    tile(fuRing, "follow-ups", fuClear ? "all clear" : (k.followupsOverdue ? `${k.followupsOverdue} overdue` : "due today"), k.followupsOverdue ? "red" : ""),
    tile(contractRing, "under contract", "goal 1/wk"),
    el("div", { class: "kpi kpi-money" },
      el("b", { class: "kpi-num" }, money(k.pipelineValue)),
      el("span", { class: "kpi-label" }, "pipeline"),
      meter(collectedShare, { color: VIZ.good }),
      el("span", { class: "kpi-sub" }, `${money(k.collectedFees)} collected`)),
    tile(el("div", { class: "kpi-stack" }, numViz(k.newLeadsToday), spark(h.newLeads || [0, 0])), "new leads", `${k.newLeadsWeek} this wk`),
    tile(el("div", { class: "kpi-stack" }, numViz(k.replies7), spark(h.replies || [0, 0])), "replies 7d",
      k.responseRate == null ? "no outreach yet" : `${k.responseRate}% response`),
    tile(numViz(k.buyers), "buyers", `+${k.buyersNewWeek} this wk`));
}

// ---- Do Today: ONE list you can finish — top items only, batch-work grouped ---------
const doState = { showAll: false, groupOpen: false };
const DO_CAP = 6;

function renderDo(root) {
  const host = document.getElementById("tdDo");
  const badge = document.getElementById("tdDoBadge");
  if (!host) return;
  const items = dashData.doToday;
  badge.textContent = items.length ? `${items.length}` : "";
  if (!items.length) { host.replaceChildren(el("p", { class: "td-empty" }, "Clear. Go find the next deal.")); return; }

  // batch-work (same-verb bulk tasks like "Unstick:") collapses into one group
  // row — 11 identical red lines is noise, one chip is a plan.
  const grouped = items.filter((it) => it.kind === "task" && /^unstick:/i.test(it.title));
  const rest = items.filter((it) => !grouped.includes(it));
  const shown = doState.showAll ? rest : rest.slice(0, DO_CAP);

  const out = shown.map((it) => doRow(it, root));
  if (rest.length > DO_CAP) {
    out.push(el("button", { class: "btn-ghost td-more", onclick: () => { doState.showAll = !doState.showAll; renderDo(root); } },
      doState.showAll ? "show less" : `+${rest.length - DO_CAP} more`));
  }
  if (grouped.length) {
    out.push(el("div", { class: "td-group", role: "button", onclick: () => { doState.groupOpen = !doState.groupOpen; renderDo(root); } },
      el("span", { class: "td-group-arrow" }, doState.groupOpen ? "▾" : "▸"),
      el("span", { class: "td-group-title" }, "Unstick stale leads"),
      el("span", { class: "td-badge" }, String(grouped.length)),
      el("span", { class: "td-group-hint" }, "batch it — one sprint, work the list top to bottom")));
    if (doState.groupOpen) out.push(...grouped.map((it) => doRow(it, root)));
  }
  host.replaceChildren(...out);
}

function doRow(it, root) {
  const row = el("div", { class: "td-row" + (it.overdue ? " overdue" : ""), "data-task": it.taskId || "" });
  // complete: tasks toggle; follow-ups/revived log a call outcome via one-tap
  if (it.kind === "task") {
    row.append(el("button", { class: "td-check", title: "done",
      onclick: async (e) => { e.target.disabled = true;
        try { await post(`/api/tasks/${it.taskId}/toggle`); toast("done"); refresh(root); } catch (err) { toast(err.message); } } }, "✓"));
    row.draggable = true;
    row.addEventListener("dragstart", (e) => { e.dataTransfer.setData("text/plain", String(it.taskId)); row.classList.add("dragging"); });
    row.addEventListener("dragend", () => row.classList.remove("dragging"));
    row.addEventListener("dragover", (e) => e.preventDefault());
    row.addEventListener("drop", async (e) => {
      e.preventDefault();
      const dragged = document.querySelector(".td-row.dragging");
      if (dragged && dragged !== row) row.parentNode.insertBefore(dragged, row);
      const ids = [...row.parentNode.querySelectorAll("[data-task]")].map((n) => +n.dataset.task).filter(Boolean);
      try { await post("/api/ws/tasks/reorder", { ids }); } catch (err) { toast(err.message); }
    });
  } else {
    row.append(el("span", { class: "td-kind" }, { followup: "FU", revived: "RV", closing: "CL" }[it.kind] || ""));
  }
  row.append(el("div", { class: "td-row-main" },
    el("div", { class: "td-row-title" }, it.title),
    it.sub ? el("div", { class: "td-row-sub" }, it.sub) : null));
  if (it.kind === "followup" || it.kind === "revived") {
    row.append(el("div", { class: "td-taps" },
      tap(it.leadId, "call_no_answer", "NA", root), tap(it.leadId, "call_spoke", "Spoke", root), tap(it.leadId, "offer_made", "Offer", root)));
  }
  if (it.kind === "closing") {
    row.append(el("button", { class: "btn-ghost td-link", onclick: () => { location.hash = "#/dispo"; } }, "open"));
  }
  return row;
}

const tap = (leadId, type, label, root) => el("button", { class: "td-tap",
  onclick: async (e) => { e.target.disabled = true;
    try { const r = await post("/api/ws/log", { lead_id: leadId, type });
      toast(`logged${r.next_followup ? " · next " + r.next_followup : ""}`); refresh(root); }
    catch (err) { toast(err.message); } } }, label);

// ---- Alerts ---------------------------------------------------------------------------
let alertsShowAll = false;
function renderAlerts() {
  const host = document.getElementById("tdAlerts");
  const badge = document.getElementById("tdAlertsBadge");
  if (!host) return;
  const alerts = dashData.alerts;
  const reds = alerts.filter((a) => a.severity === "red").length;
  const yellows = alerts.length - reds;
  badge.textContent = alerts.length ? `${alerts.length}` : "";
  badge.className = "td-badge" + (reds ? " red" : "");
  if (!alerts.length) { host.replaceChildren(el("p", { class: "td-empty" }, "Nothing needs eyes.")); return; }

  // severity summary chips first — the count IS the visual; rows are detail
  const chips = el("div", { class: "td-sev" },
    reds ? el("span", { class: "td-sev-chip red" }, el("i", {}), `${reds} act now`) : null,
    yellows ? el("span", { class: "td-sev-chip yellow" }, el("i", {}), `${yellows} drifting`) : null);
  const shown = alertsShowAll ? alerts : alerts.slice(0, 4);
  const rows = shown.map((a) => el("div", {
    class: "td-alert " + a.severity, role: "button",
    onclick: () => { location.hash = "#/" + (a.view || "acquisitions"); },
  }, a.text));
  if (alerts.length > 4) {
    rows.push(el("button", { class: "btn-ghost td-more", onclick: () => { alertsShowAll = !alertsShowAll; renderAlerts(); } },
      alertsShowAll ? "show less" : `+${alerts.length - 4} more`));
  }
  host.replaceChildren(chips, ...rows);
}

// ---- Daily News -----------------------------------------------------------------------
function renderNews(root) {
  const host = document.getElementById("tdNews");
  const badge = document.getElementById("tdNewsBadge");
  if (!host) return;
  const n = dashData.news;
  badge.textContent = n ? fmtWhen(n.fetchedAt) : "";
  const refreshBtn = el("button", { class: "btn-ghost td-link", onclick: async (e) => {
    e.target.disabled = true; e.target.textContent = "fetching…";
    try { await post("/api/ws/news/refresh", {}); await refresh(root); toast("news refreshed"); }
    catch (err) { toast(err.message); e.target.disabled = false; e.target.textContent = "refresh"; }
  } }, "refresh");
  if (!n) { host.replaceChildren(el("p", { class: "td-empty" }, "No story yet — auto-fetches 8:00 AM ET. "), refreshBtn); return; }
  // replaceChildren stringifies a null argument into a literal "null" text
  // node — filter instead of passing the ternary's null through.
  host.replaceChildren(...[
    el("a", { class: "td-news-hl", href: n.url, target: "_blank", rel: "noopener" }, n.headline),
    el("p", { class: "td-news-sum clamp" }, n.summary),
    n.why ? el("p", { class: "td-news-why" }, "Why it matters: ", n.why) : null,
    el("div", { class: "td-news-meta" },
      el("span", {}, `${n.source} · fetched ${fmtTime(n.fetchedAt)} ET${n.aiWritten ? " · AI summary" : ""}`),
      refreshBtn)].filter(Boolean));
}

// ---- Email ------------------------------------------------------------------------------
function renderMail(root) {
  const host = document.getElementById("tdMail");
  const badge = document.getElementById("tdMailBadge");
  if (!host) return;
  badge.textContent = dashData.unread ? `${dashData.unread} unread` : "";
  badge.className = "td-badge" + (dashData.unread ? " red" : "");
  if (!dashData.emails.length) { host.replaceChildren(el("p", { class: "td-empty" }, "Inbox synced — nothing inbound yet.")); return; }
  host.replaceChildren(...dashData.emails.map((m) => mailRow(m, root)));
}

function mailRow(m, root) {
  const open = openEmails.has(m.id);
  const row = el("div", { class: "td-mail" + (m.read ? "" : " unread") + (open ? " open" : "") },
    el("div", { class: "td-mail-top", role: "button",
      onclick: () => { open ? openEmails.delete(m.id) : openEmails.add(m.id); renderMail(root); } },
      el("span", { class: "td-mail-from" }, m.seller_name || m.from_name || m.from_addr),
      el("span", { class: "td-mail-subj" }, m.subject || "(no subject)"),
      el("span", { class: "td-mail-when" }, fmtWhen(m.msg_date))),
    m.lead_address ? el("div", { class: "td-mail-lead" }, m.lead_address) : null);
  if (open) {
    const box = el("textarea", { class: "td-reply", rows: "4", placeholder: "Reply…" });
    row.append(
      el("div", { class: "td-mail-snippet" }, m.snippet || ""),
      box,
      el("div", { class: "td-mail-actions" },
        el("button", { class: "btn-ghost", onclick: async (e) => {
          e.target.disabled = true; e.target.textContent = "drafting…";
          try { const r = await post("/api/ws/draft-reply", { email_id: m.id }); box.value = r.draft; }
          catch (err) { toast(err.message); }
          e.target.disabled = false; e.target.textContent = "AI draft";
        } }, "AI draft"),
        el("button", { class: "btn-solid", onclick: async (e) => {
          if (!box.value.trim()) return toast("write something first");
          e.target.disabled = true;
          try {
            await post("/api/email/send", { to: m.from_addr, subject: /^re:/i.test(m.subject || "") ? m.subject : `Re: ${m.subject || ""}`, body: box.value });
            toast("sent"); openEmails.delete(m.id); refresh(root);
          } catch (err) { toast(err.message); e.target.disabled = false; }
        } }, "Send")));
  }
  return row;
}

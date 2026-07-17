#!/usr/bin/env node
// ============================================================================
// Agent 6 — Daily Briefing v2: the engine that keeps the Today dashboard alive.
// ============================================================================
// Two modes (env BRIEFING_MODE):
//   full        (default) — 8am-ET morning run: snapshot KPIs, AI-written
//                briefing (Claude key from settings; deterministic fallback),
//                bell notification, structured state for the dashboard.
//   incremental — intraday re-run every N min: recompute state + KPI deltas
//                vs. the morning snapshot. No AI call, no notification.
// ALL output is structured JSON written to settings.briefing_state — the
// dashboard renders from that, never from prose. Every run is logged to
// agent_runs. Run once and exit:  node focus/agents/briefing.mjs
import { existsSync } from "node:fs";
import { openFocusDb, DB_PATH, todayStart } from "../focus-data.mjs";

if (!existsSync(DB_PATH)) { console.error(`crm.db not found at ${DB_PATH}`); process.exit(1); }
const MODE = process.env.BRIEFING_MODE === "incremental" ? "incremental" : "full";
const store = openFocusDb(DB_PATH);
const db = store.db;
const today = todayStart();
const safeGet = (sql, params = [], fb = null) => { try { return db.prepare(sql).get(...params) ?? fb; } catch { return fb; } };
const getSetting = (k) => safeGet("SELECT value FROM settings WHERE key=?", [k])?.value ?? null;
const setSetting = (k, v) => { try { db.prepare("INSERT INTO settings (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(k, v); } catch (e) { console.error("briefing: setSetting failed —", e.message); } };
const money = (v) => "$" + Math.round(v || 0).toLocaleString("en-US");

// --- gather (the same numbers the dashboard computes live) --------------------
const kpis = store.computeKpis();
const due = store.followupsDue();
const tasks = store.listTasks();
const agentRuns = store.listAgentRuns().filter((r) => r.agent !== "briefing");
const engine = store.lastLeadEngineRun();
const stuck = safeGet(`SELECT COUNT(*) n FROM leads WHERE active=1 AND stage NOT IN ('Closed','Dead')
  AND updated_at < ?`, [new Date(Date.now() - 7 * 86400000).toISOString()], { n: 0 }).n;
const unreadMail = safeGet("SELECT COUNT(*) n FROM emails WHERE direction='in' AND read=0", [], { n: 0 }).n;
const hotProspects = safeGet("SELECT COUNT(*) n FROM leads WHERE active=0 AND stage!='Dead' AND opportunity_score>=70", [], { n: 0 }).n;
const contracts = safeGet("SELECT COUNT(*) n FROM ws_deals WHERE deleted_at IS NULL AND dispo_stage != 'closed'", [], { n: 0 }).n;

const snapshot = {
  offersToday: kpis.offers.done, offersTarget: kpis.offers.target,
  callsToday: kpis.calls.done, newLeadsToday: kpis.newLeads.done,
  followupsDue: due.leads.length + due.calls.length,
  openTasks: tasks.length, projectedFees: kpis.pipelineFees, collectedFees: kpis.collectedFees,
  stuckLeads7d: stuck, unreadLeadEmails: unreadMail, hotProspectsToReview: hotProspects, contracts,
};

// deltas vs. the morning snapshot (incremental runs only)
let prev = null;
try { prev = JSON.parse(getSetting("briefing_state") || "null"); } catch { /* corrupt */ }
const morning = prev?.morningSnapshot && prev?.day === today ? prev.morningSnapshot : null;
const base = MODE === "incremental" && morning ? morning : null;
const deltas = base
  ? Object.fromEntries(Object.entries(snapshot).filter(([k, v]) => typeof v === "number" && v !== base[k]).map(([k, v]) => [k, v - (base[k] || 0)]))
  : {};

// --- deterministic top-3 + summary (always computed; AI may replace summary) ---
const top3 = [];
for (const f of due.leads.slice(0, 3)) top3.push({ action: `Follow up: ${f.seller_name || "seller"} — ${f.address || "lead #" + f.id}`, leadId: f.id });
for (const t of tasks.filter((x) => /^send offer/i.test(x.title)).slice(0, 3 - top3.length)) top3.push({ action: t.title, taskId: t.id });
if (top3.length < 3 && snapshot.offersToday < snapshot.offersTarget) top3.push({ action: `Send the next offer (${snapshot.offersToday}/${snapshot.offersTarget} today)` });
if (top3.length < 3 && hotProspects) top3.push({ action: `Review ${hotProspects} hot prospects (score ≥70)` });

const fallbackSummary =
  `${money(snapshot.projectedFees)} projected · ${snapshot.contracts} under contract · ` +
  `${snapshot.followupsDue} follow-ups due · offers ${snapshot.offersToday}/${snapshot.offersTarget} · ${snapshot.openTasks} open tasks.`;

// --- AI summary (full mode only) ------------------------------------------------
async function aiSummary() {
  const apiKey = getSetting("anthropic_api_key") || process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;
  const { default: Anthropic } = await import("@anthropic-ai/sdk");
  const client = new Anthropic({ apiKey });
  const facts = { date: today, ...snapshot, dueFollowups: due.leads.slice(0, 5), topTasks: tasks.slice(0, 6).map((t) => t.title),
    agentReports: agentRuns.map((r) => ({ agent: r.agent, digest: r.digest })), leadEngineLastPass: engine };
  const response = await client.messages.create(
    {
      model: "claude-opus-4-8",
      max_tokens: 1500,
      thinking: { type: "adaptive" },
      system:
        "You write the morning briefing inside a real-estate wholesaling CRM (Detroit; goal: 1 contract/week, lever: offers sent daily). " +
        "From the JSON facts, return STRICT JSON only — no markdown, no prose outside JSON — shaped exactly: " +
        '{"headline": "<one sentence state of the business>", "lines": ["<2-5 short lines: what agents found overnight, what changed, what matters>"], ' +
        '"top3": ["<three highest-leverage imperative actions, concrete, money-first>"]} ' +
        "Never invent data not in the facts.",
      messages: [{ role: "user", content: JSON.stringify(facts) }],
    },
    { timeout: 60_000, maxRetries: 1 },
  );
  const text = response.content.filter((b) => b.type === "text").map((b) => b.text).join("").trim();
  const m = text.match(/\{[\s\S]*\}/);
  return m ? JSON.parse(m[0]) : null;
}

// --- run -------------------------------------------------------------------------
let ai = null, source = "deterministic";
if (MODE === "full") {
  try { ai = await aiSummary(); if (ai) source = "ai"; }
  catch (e) { console.error("briefing: AI unavailable —", e.message); }
}

const state = {
  day: today,
  ranAt: new Date().toISOString(),
  mode: MODE,
  source,
  headline: ai?.headline || fallbackSummary,
  lines: ai?.lines || [],
  top3: ai?.top3 ? ai.top3.map((a) => ({ action: a })) : top3,
  snapshot,
  morningSnapshot: MODE === "full" ? snapshot : (morning || snapshot),
  deltas,
  agentReports: agentRuns,
};
setSetting("briefing_state", JSON.stringify(state));

// full run also rings the bell (one per day — replace, never stack)
if (MODE === "full") {
  try {
    db.exec(`CREATE TABLE IF NOT EXISTS notifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT, created_at TEXT, type TEXT, title TEXT, body TEXT, read INTEGER DEFAULT 0)`);
    db.prepare("DELETE FROM notifications WHERE type='briefing' AND created_at >= ?").run(today);
    const body = [state.headline, ...state.lines, "", "Top 3:", ...state.top3.map((x, i) => `${i + 1}. ${x.action}`)].join("\n");
    db.prepare("INSERT INTO notifications (created_at, type, title, body, read) VALUES (?,?,?,?,0)")
      .run(new Date().toISOString(), "briefing", `Daily briefing — ${today}`, body);
  } catch (e) { console.error("briefing: could not file notification —", e.message); }
}

const deltaStr = Object.keys(deltas).length
  ? " · Δ " + Object.entries(deltas).map(([k, v]) => `${k}${v > 0 ? "+" : ""}${v}`).join(" ")
  : "";
const digest = `${MODE} (${source}) — ${snapshot.followupsDue} fu due, ${snapshot.openTasks} tasks, offers ${snapshot.offersToday}/${snapshot.offersTarget}, ${money(snapshot.projectedFees)} projected${deltaStr}`;
console.log(`briefing: ${digest}`);
store.recordAgentRun("briefing", digest);
store.close();

// ============================================================================
// focus-data.mjs — crm.db reader/writer for the Focus Terminal + agents
// ============================================================================
// Reads the live SQLite substrate directly (no server needed). Every query
// mirrors the semantics of GET /api/stats (server.js:1763) so the terminal
// and the dashboard never disagree on a number.
//
// Tolerant by design: the db is owned by a running server — any table may be
// missing (fresh db) or momentarily locked (SQLITE_BUSY). Reads fall back to
// empty defaults; writes retry once, then throw.

import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
export const DB_PATH = process.env.CRM_DB || join(ROOT, "crm.db");
export const GOALS_PATH = join(ROOT, "focus", "daily-goals.json");

export function loadGoals(path = GOALS_PATH) {
  const fallback = {
    targets: { newLeads: 25, calls: 20, offers: 5, followupsCleared: "all", stageAdvances: 5 },
    focus: { pomodoroMin: 25, breakMin: 5, longBreakMin: 15, cyclesBeforeLongBreak: 4 },
    copy: { greetingAM: "Let's move. One thing at a time.", streakEmoji: "🔥" },
  };
  try {
    const g = JSON.parse(readFileSync(path, "utf8"));
    return { ...fallback, ...g, targets: { ...fallback.targets, ...g.targets }, focus: { ...fallback.focus, ...g.focus }, copy: { ...fallback.copy, ...g.copy } };
  } catch { return fallback; }
}

// --- time boundaries (parity with server.js:1602-1615) ---
export function todayStart() {
  return new Date().toISOString().slice(0, 10);
}
function etOffsetMinutes(d) {
  const et = new Date(d.toLocaleString("en-US", { timeZone: "America/New_York" }));
  const utc = new Date(d.toLocaleString("en-US", { timeZone: "UTC" }));
  return Math.round((et - utc) / 60000); // e.g. -240 in summer (EDT)
}
export function cutoff9amET(now = new Date()) {
  const p = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour12: false, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const g = (t) => +p.find((x) => x.type === t).value;
  const offUTC = -etOffsetMinutes(now); // minutes to ADD to local ET wall time to get UTC
  let cutoff = new Date(Date.UTC(g("year"), g("month") - 1, g("day"), 9, 0, 0) + offUTC * 60000);
  if (now < cutoff) cutoff = new Date(cutoff.getTime() - 86400000);
  return cutoff.toISOString();
}

// --- db handle ---
export function openFocusDb(dbPath = DB_PATH) {
  const db = new DatabaseSync(dbPath);
  // The server owns this file — wait out transient write locks instead of
  // failing instantly (proper fix for SQLITE_BUSY; the retry below is backstop).
  try { db.exec("PRAGMA busy_timeout = 250"); } catch { /* older sqlite */ }

  // Reads never crash the terminal: missing table / busy db → fallback value.
  function safeGet(sql, params = [], fallback = null) {
    try { return db.prepare(sql).get(...params) ?? fallback; } catch { return fallback; }
  }
  function safeAll(sql, params = [], fallback = []) {
    try { return db.prepare(sql).all(...params); } catch { return fallback; }
  }
  // Writes retry once on a transient lock, then throw (the caller should know).
  function write(sql, params = []) {
    try { return db.prepare(sql).run(...params); }
    catch (e) {
      if (!/busy|locked/i.test(String(e?.message))) throw e;
      return db.prepare(sql).run(...params);
    }
  }

  function followupsDue() {
    const today = todayStart();
    // Lead follow-ups — mirror server.js:1773 (note the ￿ upper bound trick).
    const leads = safeAll(
      `SELECT id, seller_name, address, next_followup, stage FROM leads
       WHERE active=1 AND next_followup IS NOT NULL AND next_followup <= ?
         AND stage NOT IN ('Closed','Dead')
       ORDER BY next_followup ASC`, [today + "￿"]);
    // Property call follow-ups — latest outcome decides; suppressed never appear (server.js:1785).
    const calls = safeAll(
      `SELECT co.property_id, co.follow_up_date, co.outcome, p.address, p.formatted_address, p.city
       FROM call_outcomes co
       JOIN properties p ON p.id = co.property_id
       WHERE co.id IN (SELECT MAX(id) FROM call_outcomes GROUP BY property_id)
         AND co.follow_up_date IS NOT NULL AND co.follow_up_date <= ?
         AND co.property_id NOT IN (SELECT property_id FROM call_outcomes WHERE outreach_suppressed = 1)
       ORDER BY co.follow_up_date ASC LIMIT 50`, [today]);
    return { leads, calls };
  }

  function computeKpis(goals = loadGoals()) {
    const today = todayStart();
    const t = goals.targets;
    const due = followupsDue();
    const followupsRemaining = due.leads.length + due.calls.length;
    return {
      newLeads: { done: safeGet("SELECT COUNT(*) n FROM leads WHERE created_at >= ?", [today], { n: 0 }).n, target: t.newLeads },
      calls: { done: safeGet("SELECT COUNT(*) n FROM call_outcomes WHERE created_at >= ?", [today], { n: 0 }).n, target: t.calls },
      offers: { done: safeGet("SELECT COUNT(*) n FROM leads WHERE offer_sent_at >= ?", [cutoff9amET()], { n: 0 }).n, target: t.offers },
      // "cleared" KPI: done when nothing is left due. done/target expressed so the bar fills as the queue drains.
      followups: { remaining: followupsRemaining, target: t.followupsCleared },
      stageAdvances: {
        done: safeGet("SELECT COUNT(*) n FROM activities WHERE type='stage_change' AND body LIKE 'Stage:%' AND created_at >= ?", [today], { n: 0 }).n,
        target: t.stageAdvances,
      },
      pipelineFees: safeGet("SELECT COALESCE(SUM(assignment_fee),0) v FROM leads WHERE active=1 AND stage NOT IN ('Closed','Dead')", [], { v: 0 }).v,
      collectedFees: safeGet("SELECT COALESCE(SUM(fee_collected),0) v FROM leads WHERE stage='Closed' AND fee_collected IS NOT NULL", [], { v: 0 }).v,
      stages: safeAll("SELECT stage, COUNT(*) n FROM leads WHERE active=1 GROUP BY stage"),
    };
  }

  function listTasks() {
    return safeAll(
      `SELECT t.id, t.title, t.due_date, t.done, t.lead_id, l.address
       FROM tasks t LEFT JOIN leads l ON l.id = t.lead_id
       WHERE t.done = 0
       ORDER BY t.due_date IS NULL, t.due_date ASC, t.id ASC`);
  }
  function tasksDoneToday() {
    // done has no timestamp — approximate the daily streak with tasks created today and done.
    return safeGet("SELECT COUNT(*) n FROM tasks WHERE done=1 AND created_at >= ?", [todayStart()], { n: 0 }).n;
  }
  function toggleTask(id) {
    return write("UPDATE tasks SET done = 1 - done WHERE id = ?", [id]);
  }
  function addTask(title, { leadId = null, dueDate = todayStart() } = {}) {
    return write(
      "INSERT INTO tasks (lead_id, created_at, title, due_date, done) VALUES (?,?,?,?,0)",
      [leadId, new Date().toISOString(), title, dueDate]);
  }
  // Idempotent variant for agents: skip if an open task with this exact title exists.
  function addTaskOnce(title, opts = {}) {
    const dup = safeGet("SELECT id FROM tasks WHERE done=0 AND title = ?", [title]);
    if (dup) return { skipped: true, id: dup.id };
    const info = addTask(title, opts);
    return { skipped: false, id: Number(info.lastInsertRowid) };
  }

  // --- agent visibility -------------------------------------------------
  // Every focus agent records its run digest here; the terminal and the web
  // dashboard read it back so "what are my agents doing" has one answer.
  function recordAgentRun(agent, digest) {
    try {
      db.exec(`CREATE TABLE IF NOT EXISTS agent_runs (
        id INTEGER PRIMARY KEY AUTOINCREMENT, agent TEXT NOT NULL,
        finished_at TEXT NOT NULL, digest TEXT)`);
      write("INSERT INTO agent_runs (agent, finished_at, digest) VALUES (?,?,?)", [agent, new Date().toISOString(), digest]);
    } catch { /* visibility is best-effort — never fail the agent over it */ }
  }
  function listAgentRuns() {
    // latest run per agent
    return safeAll(
      `SELECT agent, finished_at, digest FROM agent_runs
       WHERE id IN (SELECT MAX(id) FROM agent_runs GROUP BY agent)
       ORDER BY agent`);
  }
  function agentRunHistory(limit = 40) {
    // full report trail, newest first — feeds the workspace Agents tab
    return safeAll("SELECT agent, finished_at, digest FROM agent_runs ORDER BY id DESC LIMIT ?", [limit]);
  }
  function lastLeadEngineRun() {
    // the autonomous lead engine (server.js hourly loop) logs its own runs
    return safeGet(
      `SELECT created_at, raw_records, converged_properties, shortlist_count
       FROM lead_engine_runs ORDER BY id DESC LIMIT 1`);
  }

  // Per-day KPI counts for the last N days — feeds the dashboard sparklines.
  function kpiHistory(days = 14) {
    const dayList = [...Array(days)].map((_, i) => new Date(Date.now() - (days - 1 - i) * 86400000).toISOString().slice(0, 10));
    const since = dayList[0];
    const fill = (rows) => { const m = Object.fromEntries(rows.map((r) => [r.d, r.n])); return dayList.map((d) => m[d] || 0); };
    return {
      days: dayList,
      newLeads: fill(safeAll("SELECT substr(created_at,1,10) d, COUNT(*) n FROM leads WHERE created_at >= ? GROUP BY d", [since])),
      calls: fill(safeAll("SELECT substr(created_at,1,10) d, COUNT(*) n FROM call_outcomes WHERE created_at >= ? GROUP BY d", [since])),
      offers: fill(safeAll("SELECT substr(offer_sent_at,1,10) d, COUNT(*) n FROM leads WHERE offer_sent_at IS NOT NULL AND offer_sent_at >= ? GROUP BY d", [since])),
      stageAdvances: fill(safeAll("SELECT substr(created_at,1,10) d, COUNT(*) n FROM activities WHERE type='stage_change' AND body LIKE 'Stage:%' AND created_at >= ? GROUP BY d", [since])),
    };
  }
  function recentActivity(limit = 6) {
    return safeAll(
      `SELECT a.created_at, a.type, a.body, l.address FROM activities a
       LEFT JOIN leads l ON l.id = a.lead_id ORDER BY a.id DESC LIMIT ?`, [limit]);
  }

  return { db, computeKpis, followupsDue, listTasks, tasksDoneToday, toggleTask, addTask, addTaskOnce, recordAgentRun, listAgentRuns, agentRunHistory, lastLeadEngineRun, kpiHistory, recentActivity, close: () => db.close() };
}

// ============================================================================
// focus-api.mjs — the Focus core, shared by every host
// ============================================================================
// One implementation of the dashboard state + agent runner, consumed by:
//   • server.js (:4000)     via focus-server.mjs mountFocus(app)  ← primary
//   • focus-web.mjs (:4100) standalone node:http fallback
// so the CRM and the standalone dashboard can never drift apart.

import { spawn } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { openFocusDb, loadGoals, DB_PATH } from "./focus-data.mjs";
import { rankPlan, getNextAction } from "./focus-coach.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));

// The runnable agents — a fixed whitelist, never derived from a request.
export const AGENTS = {
  briefing: "Daily Briefing",
  momentum: "Momentum Keeper",
  acquisitions: "Acquisitions Autopilot",
  underwriting: "Underwriting Analyst",
  outreach: "Outreach Drafter",
  emailer: "Sonny Emailer",
  doctor: "System Doctor",
  comps: "Comps Analyst",
  replies: "Reply Triage",
};

export function createFocusCore({ dbPath = DB_PATH } = {}) {
  const store = openFocusDb(dbPath);
  const goals = loadGoals();
  const running = new Map(); // name → { startedAt }

  function agentStatus() {
    const last = Object.fromEntries(store.listAgentRuns().map((r) => [r.agent, r]));
    return Object.entries(AGENTS).map(([name, label]) => ({
      name, label,
      running: running.has(name),
      lastRun: last[name]?.finished_at || null,
      digest: last[name]?.digest || "never run",
    }));
  }

  function statePayload() {
    const kpis = store.computeKpis(goals);
    const tasks = store.listTasks();
    const followups = store.followupsDue();
    return {
      now: new Date().toISOString(),
      goals,
      kpis,
      tasks,
      doneToday: store.tasksDoneToday(),
      next: getNextAction({ kpis, tasks, followups }),
      plan: rankPlan({ kpis, tasks, followups }).slice(0, 6),
      agents: agentStatus(),
      leadEngine: store.lastLeadEngineRun(), // the hourly autonomous engine in server.js
      history: store.kpiHistory(14),         // sparkline feeds
      activity: store.recentActivity(6),     // inbox trail
    };
  }

  // Everything the workspace Agents tab needs in one call: live status per
  // agent, the full report trail, and the autonomous lead engine's last run.
  function agentsPayload() {
    const kpis = store.computeKpis(goals);
    const tasks = store.listTasks();
    const followups = store.followupsDue();
    return {
      now: new Date().toISOString(),
      agents: agentStatus(),
      history: store.agentRunHistory(40),
      leadEngine: store.lastLeadEngineRun(),
      tasks, // the work the agents filed — the human's queue
      next: getNextAction({ kpis, tasks, followups }), // the coach's ONE next action
    };
  }

  function runAgent(name, extraEnv = {}) {
    if (!AGENTS[name] || running.has(name)) return false;
    running.set(name, { startedAt: Date.now() });
    const child = spawn(process.execPath, [join(HERE, "agents", `${name}.mjs`)], {
      env: { ...process.env, CRM_DB: dbPath, ...extraEnv },
      stdio: ["ignore", "inherit", "inherit"],
    });
    child.on("exit", () => running.delete(name));
    child.on("error", () => running.delete(name));
    return true;
  }

  return {
    store, goals,
    statePayload, agentsPayload, runAgent,
    htmlPath: join(HERE, "focus-web.html"),
    addTask: (title) => store.addTask(String(title).slice(0, 300)),
    toggleTask: (id) => store.toggleTask(id),
    close: () => store.close(),
  };
}

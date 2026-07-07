#!/usr/bin/env node
// ============================================================================
// focus-web.mjs — the Focus Terminal in the browser + live agent visibility
// ============================================================================
// A tiny standalone HTTP server (node:http, no deps) over the same crm.db and
// the same coach ranker as the TUI. Deliberately separate from server.js so
// the live CRM substrate is never at risk. Local-only (binds 127.0.0.1).
//
//   npm run focus:web        → http://127.0.0.1:4100
//   FOCUS_PORT=4200 …        → pick a port · CRM_DB=… → pick a database
//
// API: GET /api/focus · POST /api/tasks {title} · POST /api/tasks/:id/toggle
//      POST /api/agents/:name/run   (whitelisted focus agents only)

import http from "node:http";
import { spawn } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { openFocusDb, loadGoals, DB_PATH } from "./focus-data.mjs";
import { rankPlan, getNextAction } from "./focus-coach.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.FOCUS_PORT || 4100);
if (!existsSync(DB_PATH)) {
  console.error(`crm.db not found at ${DB_PATH} — start the CRM once (npm start) or set CRM_DB=`);
  process.exit(1);
}
const store = openFocusDb();
const goals = loadGoals();

// The runnable agents — a fixed whitelist, never derived from the request.
const AGENTS = {
  momentum: "Momentum Keeper",
  acquisitions: "Acquisitions Autopilot",
  underwriting: "Underwriting Analyst",
  outreach: "Outreach Drafter",
};
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

function runAgent(name) {
  if (!AGENTS[name] || running.has(name)) return false;
  running.set(name, { startedAt: Date.now() });
  const child = spawn(process.execPath, [join(HERE, "agents", `${name}.mjs`)], {
    env: { ...process.env, CRM_DB: DB_PATH },
    stdio: ["ignore", "inherit", "inherit"],
  });
  child.on("exit", () => running.delete(name));
  child.on("error", () => running.delete(name));
  return true;
}

const json = (res, code, obj) => { res.writeHead(code, { "content-type": "application/json" }); res.end(JSON.stringify(obj)); };
const readBody = (req) => new Promise((resolve) => {
  let b = ""; req.on("data", (c) => { b += c; if (b.length > 4096) req.destroy(); });
  req.on("end", () => { try { resolve(JSON.parse(b || "{}")); } catch { resolve({}); } });
});

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  try {
    if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/index.html")) {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      return res.end(readFileSync(join(HERE, "focus-web.html"), "utf8"));
    }
    if (req.method === "GET" && url.pathname === "/api/focus") return json(res, 200, statePayload());
    if (req.method === "POST" && url.pathname === "/api/tasks") {
      const { title } = await readBody(req);
      if (!title || typeof title !== "string") return json(res, 400, { error: "title required" });
      store.addTask(title.slice(0, 300));
      return json(res, 200, { ok: true });
    }
    const toggle = url.pathname.match(/^\/api\/tasks\/(\d+)\/toggle$/);
    if (req.method === "POST" && toggle) { store.toggleTask(+toggle[1]); return json(res, 200, { ok: true }); }
    const run = url.pathname.match(/^\/api\/agents\/([a-z]+)\/run$/);
    if (req.method === "POST" && run) {
      return runAgent(run[1])
        ? json(res, 200, { ok: true, started: run[1] })
        : json(res, 409, { error: "unknown agent or already running" });
    }
    json(res, 404, { error: "not found" });
  } catch (e) {
    json(res, 500, { error: String(e.message || e) });
  }
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`☥ Focus web dashboard → http://127.0.0.1:${PORT}  (db: ${DB_PATH})`);
});

// ============================================================================
// focus-server.mjs — mount the Focus dashboard inside the CRM (server.js)
// ============================================================================
// Additive-only integration: server.js calls mountFocus(app) once and the
// operator UI gains  GET /focus  (the dashboard page, iframed as the Focus
// view) plus the focus API. No existing route is touched; task writes here
// go straight to the same `tasks` table the CRM reads.

import { readFileSync } from "node:fs";
import { createFocusCore } from "./focus-api.mjs";

export function mountFocus(app, opts = {}) {
  const core = createFocusCore(opts);

  app.get("/focus", (req, res) => {
    // read per-request (dev-friendly, matches the no-cache static policy)
    res.setHeader("Cache-Control", "no-store, max-age=0");
    res.type("html").send(readFileSync(core.htmlPath, "utf8"));
  });

  app.get("/api/focus", (req, res) => res.json(core.statePayload()));

  app.post("/api/tasks", (req, res) => {
    const title = req.body?.title;
    if (!title || typeof title !== "string") return res.status(400).json({ error: "title required" });
    core.addTask(title);
    res.json({ ok: true });
  });

  app.post("/api/tasks/:id/toggle", (req, res) => {
    core.toggleTask(+req.params.id);
    res.json({ ok: true });
  });

  app.post("/api/agents/:name/run", (req, res) => {
    if (core.runAgent(req.params.name)) return res.json({ ok: true, started: req.params.name });
    res.status(409).json({ error: "unknown agent or already running" });
  });

  return core;
}

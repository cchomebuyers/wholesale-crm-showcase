#!/usr/bin/env node
// ============================================================================
// focus-web.mjs — standalone Focus dashboard (fallback host)
// ============================================================================
// The PRIMARY home of the dashboard is the CRM itself: server.js mounts
// focus-server.mjs, so http://localhost:4000/focus is the one true door.
// This thin node:http wrapper serves the identical core on :4100 for when
// the CRM server isn't running. Local-only (binds 127.0.0.1).
//
//   npm run focus:web   ·   FOCUS_PORT=4200 …   ·   CRM_DB=… overrides db

import http from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { DB_PATH } from "./focus-data.mjs";
import { createFocusCore } from "./focus-api.mjs";

const PORT = Number(process.env.FOCUS_PORT || 4100);
if (!existsSync(DB_PATH)) {
  console.error(`crm.db not found at ${DB_PATH} — start the CRM once (npm start) or set CRM_DB=`);
  process.exit(1);
}
const core = createFocusCore();

const json = (res, code, obj) => { res.writeHead(code, { "content-type": "application/json" }); res.end(JSON.stringify(obj)); };
const readBody = (req) => new Promise((resolve) => {
  let b = ""; req.on("data", (c) => { b += c; if (b.length > 4096) req.destroy(); });
  req.on("end", () => { try { resolve(JSON.parse(b || "{}")); } catch { resolve({}); } });
});

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  try {
    if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/focus" || url.pathname === "/index.html")) {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      return res.end(readFileSync(core.htmlPath, "utf8"));
    }
    if (req.method === "GET" && url.pathname === "/api/focus") return json(res, 200, core.statePayload());
    if (req.method === "POST" && url.pathname === "/api/tasks") {
      const { title } = await readBody(req);
      if (!title || typeof title !== "string") return json(res, 400, { error: "title required" });
      core.addTask(title);
      return json(res, 200, { ok: true });
    }
    const toggle = url.pathname.match(/^\/api\/tasks\/(\d+)\/toggle$/);
    if (req.method === "POST" && toggle) { core.toggleTask(+toggle[1]); return json(res, 200, { ok: true }); }
    const run = url.pathname.match(/^\/api\/agents\/([a-z]+)\/run$/);
    if (req.method === "POST" && run) {
      return core.runAgent(run[1])
        ? json(res, 200, { ok: true, started: run[1] })
        : json(res, 409, { error: "unknown agent or already running" });
    }
    json(res, 404, { error: "not found" });
  } catch (e) {
    json(res, 500, { error: String(e.message || e) });
  }
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`☥ Focus web dashboard (standalone) → http://127.0.0.1:${PORT}  (db: ${DB_PATH})`);
  console.log(`   primary home: http://localhost:4000/focus (inside the CRM)`);
});

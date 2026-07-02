// tools/watch_round.mjs — the standing watch, one command.
// Runs the verification battery evolved over the 2026-07-02 session (ticks
// 80-88): server liveness, money endpoints, disk-vs-served byte integrity,
// database page + FK integrity, disk headroom, git cleanliness. Read-only;
// exits non-zero if anything fails so it can gate cron/CI use.
//
// Run: node tools/watch_round.mjs [--port=4000]  (server must be running)

import { createHash } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";
import { execSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

const repo = join(dirname(fileURLToPath(import.meta.url)), "..");
const port = (process.argv.find((a) => a.startsWith("--port=")) || "--port=4000").split("=")[1];
const BASE = `http://127.0.0.1:${port}`;
let failures = 0;
const ok = (name, pass, detail = "") => { console.log(`${pass ? " ok " : "FAIL"}  ${name}${detail ? "  " + detail : ""}`); if (!pass) failures++; };

// 1) server + money endpoints
try {
  const h = await (await fetch(`${BASE}/api/health`)).json();
  ok("server /api/health", h.ok === true);
} catch { ok("server /api/health", false, "(is the server running?)"); }
for (const ep of ["/api/pro-queue?limit=1", "/api/pipeline/coverage", "/api/pro-queue/call-sheet.csv", "/api/export/ankhor-import?kinds=lead&limit_per_kind=1"]) {
  try { ok(`GET ${ep}`, (await fetch(`${BASE}${ep}`)).status === 200); }
  catch { ok(`GET ${ep}`, false); }
}

// 2) disk vs served bytes (cache-busters read from index.html so drift shows)
const idx = readFileSync(join(repo, "public/index.html"), "utf8");
const ver = (re, d) => (idx.match(re) || [null, d])[1];
const surfaces = [
  ["public/index.html", "/"],
  ["public/app.js", `/app.js?v=${ver(/app\.js\?v=(\d+)/, "0")}`],
  ["public/styles.css", `/styles.css?v=${ver(/styles\.css\?v=(\d+)/, "0")}`],
  ["public/hyper.js", `/hyper.js?v=${ver(/hyper\.js\?v=(\d+)/, "0")}`],
];
for (const [file, path] of surfaces) {
  try {
    const disk = createHash("sha1").update(readFileSync(join(repo, file))).digest("hex");
    const served = createHash("sha1").update(Buffer.from(await (await fetch(`${BASE}${path}`)).arrayBuffer())).digest("hex");
    ok(`bytes ${file}`, disk === served, disk === served ? "" : "DRIFT");
  } catch { ok(`bytes ${file}`, false); }
}

// 3) database integrity
try {
  const db = new DatabaseSync(join(repo, "crm.db"), { readOnly: true });
  ok("db integrity_check", db.prepare("PRAGMA integrity_check").get().integrity_check === "ok");
  ok("db foreign_key_check", db.prepare("PRAGMA foreign_key_check").all().length === 0);
  db.close();
} catch (e) { ok("db integrity", false, e.message); }

// 4) disk headroom (warn under 1.5 GB — this box runs tight)
try {
  const o = execSync("wmic logicaldisk where name='C:' get freespace /format:value").toString();
  const free = Number((/FreeSpace=(\d+)/.exec(o) || [0, 0])[1]) / 1e9;
  ok("disk C: headroom", free > 1.5, `${free.toFixed(1)} GB free`);
} catch { console.log(" ?    disk check unavailable"); }

// 5) git cleanliness (informational — a dirty tree mid-work is not a failure)
try {
  const dirty = execSync("git status --porcelain", { cwd: repo }).toString().trim();
  console.log(`${dirty ? " !   " : " ok "}  git tree ${dirty ? "dirty (" + dirty.split("\n").length + " paths)" : "pristine"}`);
} catch { /* not fatal */ }

console.log(failures === 0 ? "\nWATCH ROUND: ALL CLEAR" : `\nWATCH ROUND: ${failures} FAILURE(S)`);
// --log: append one line per round to logs/watch.log so unattended rounds
// leave a durable trace (logs/ is gitignored; grep it for FAIL to triage).
if (process.argv.includes("--log")) {
  try {
    const { appendFileSync, mkdirSync } = await import("node:fs");
    mkdirSync(join(repo, "logs"), { recursive: true });
    appendFileSync(join(repo, "logs", "watch.log"), `${new Date().toISOString()} ${failures === 0 ? "CLEAR" : "FAIL:" + failures}\n`);
  } catch { /* logging must never fail the round */ }
}
process.exit(failures === 0 ? 0 : 1);

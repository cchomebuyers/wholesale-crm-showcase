// server_smoke.test.js — boots the REAL server against the real crm.db and
// hits the money-workflow endpoints. Exists because two real bugs (the
// backups-symlink boot crash and the pro-queue asking_price 503) passed every
// unit test: nothing in the suite ever actually started server.js. This does.
//
// NO_BACKUP=1 so the boot never snapshots the large db (LOOP_PROMPT.md disk
// rule). Throwaway port. The child is killed in every exit path.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const repo = dirname(fileURLToPath(import.meta.url));
const PORT = 4361; // throwaway smoke port
const BASE = `http://127.0.0.1:${PORT}`;

let child = null;

async function up(timeoutMs = 25000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    try {
      const r = await fetch(`${BASE}/api/health`);
      if (r.ok) return true;
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 400));
  }
  return false;
}

before(async () => {
  child = spawn(process.execPath, [join(repo, "server.js")], {
    cwd: repo,
    env: { ...process.env, PORT: String(PORT), NO_BACKUP: "1" },
    stdio: "ignore",
    windowsHide: true,
  });
  const ok = await up();
  assert.ok(ok, `server did not come up on :${PORT} within 25s — boot is broken`);
});

after(() => { try { child?.kill(); } catch { /* already dead */ } });

test("boot: /api/health answers", async () => {
  const r = await fetch(`${BASE}/api/health`);
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.equal(j.ok, true);
  assert.equal(j.app, "wholesale-crm");
});

test("operator UI serves with the command shell + all 12 views", async () => {
  const html = await (await fetch(`${BASE}/`)).text();
  assert.ok(html.includes('id="cubeLauncher"'), "cube launcher present");
  assert.ok(html.includes('id="menuOverlay"'), "overlay nav present");
  const tabs = [...html.matchAll(/data-tab="([^"]+)"/g)].map((m) => m[1]);
  assert.equal(new Set(tabs).size, 12, `expected 12 views, got ${new Set(tabs).size}`);
  assert.ok(tabs.includes("focus"), "focus view registered");
});

test("focus dashboard is mounted inside the CRM", async () => {
  const page = await (await fetch(`${BASE}/focus`)).text();
  assert.ok(page.includes("F.O.C.U.S."), "focus page serves");
  const state = await (await fetch(`${BASE}/api/focus`)).json();
  // The crew can grow (briefing joined the original four) — pin the core four
  // by name instead of an exact count.
  const names = (state.agents || []).map((a) => a.name);
  for (const core of ["momentum", "acquisitions", "underwriting", "outreach"]) {
    assert.ok(names.includes(core), `core agent ${core} visible`);
  }
  assert.ok(state.next && typeof state.next.title === "string", "coach next action present");
  assert.equal(state.history.days.length, 14, "sparkline history");
});

test("pro-queue answers with counts + blocker visibility (no 503)", async () => {
  const r = await fetch(`${BASE}/api/pro-queue?limit=3`);
  assert.equal(r.status, 200, "pro-queue must not 503 against the real schema");
  const j = await r.json();
  assert.ok(j.counts && typeof j.counts === "object");
  if (j.items.length) {
    assert.ok(Array.isArray(j.items[0].why_not_call_now), "blockers exposed");
    assert.ok(!("listing_agent_phone" in j.items[0]), "seller contact not leaked");
  }
});

test("pipeline surface is mounted (stages + runs)", async () => {
  const s = await (await fetch(`${BASE}/api/pipeline/stages`)).json();
  assert.ok(Array.isArray(s.stages) && s.stages.length >= 3);
  assert.ok(s.presets.local.includes("build"));
  const runs = await (await fetch(`${BASE}/api/pipeline/runs`)).json();
  assert.ok(Array.isArray(runs));
});

test("parse-memory endpoint resolves and remembers", async () => {
  const rec = { business_name: "Smoke Co", website: "smoke.example", license_id: "SMK-1" };
  const first = await (await fetch(`${BASE}/api/parse/resolve`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(rec),
  })).json();
  assert.equal(first.kind, "smb");
  const again = await (await fetch(`${BASE}/api/parse/resolve`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...rec, business_name: "Other" }),
  })).json();
  assert.equal(again.source, "memory", "same shape must hit memory");
  // Self-clean: leave no synthetic shape behind (parse_memory holds only
  // real-use learnings — tick-77 purge discipline, enforced here).
  const forgot = await (await fetch(`${BASE}/api/parse/forget`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ signature: again.signature }),
  })).json();
  assert.equal(forgot.forgotten, true, "test must clean up its own shape");
});

test("stats endpoint (dashboard) answers", async () => {
  const r = await fetch(`${BASE}/api/stats`);
  assert.equal(r.status, 200);
});

test("every documented pro-queue filter param answers 200 with a sane subset", async () => {
  // Filter parity contract (docs/fill_properties_pipeline.md): each param the
  // doc promises must work against the real schema — none may 503 or widen
  // the result set beyond the unfiltered total.
  const base = await (await fetch(`${BASE}/api/pro-queue?limit=1`)).json();
  const total = base.total ?? 0;
  const params = [
    "tier=call_now,pay_to_unlock", "min_score=50", "min_grade=50",
    "owner_known=1", "distress=1", "spread=unproven", "signal=absentee", "ready=1",
  ];
  for (const p of params) {
    const r = await fetch(`${BASE}/api/pro-queue?${p}&limit=1`);
    assert.equal(r.status, 200, `${p} must not fail`);
    const j = await r.json();
    assert.ok((j.total ?? 0) <= total, `${p} must be a subset (${j.total} > ${total})`);
    assert.ok(Array.isArray(j.items), `${p} returns items[]`);
  }
});

test("spend gate end-to-end: hold-tier skiptrace is DENIED before any provider call", async () => {
  // A hold-tier property fails skiptraceDecision, so the route returns before
  // skipTraceOne ever runs — zero spend risk regardless of configured keys.
  const q = await (await fetch(`${BASE}/api/pro-queue?tier=hold&limit=1`)).json();
  if (!q.items || !q.items.length) return; // empty db — nothing to assert
  const id = q.items[0].property_id;
  const r = await (await fetch(`${BASE}/api/pro-queue/${id}/skiptrace`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" })).json();
  assert.equal(r.allowed, false, "hold tier must be denied by the spend gate");
  assert.equal(r.spent, false, "no money may move on a denied decision");
  assert.ok(r.reason && r.reason.length > 3, "denial carries a reason");
});

test("call sheet serves CSV and never leaks a phone without a DNC clear", async () => {
  const r = await fetch(`${BASE}/api/pro-queue/call-sheet.csv`);
  assert.equal(r.status, 200);
  const text = await r.text();
  const lines = text.trim().split("\n");
  assert.match(lines[0], /^property_id,tier,priority,owner_name/);
  for (const line of lines.slice(1)) {
    const cells = line.split(","); // phone is col 10 (index 9); quoted fields never contain digits-only phones
    const phone = cells[9] || "";
    const dnc = cells[10] || "";
    if (phone.trim()) assert.equal(dnc, "clear", `phone present without clear: ${line.slice(0, 60)}`);
  }
});

test("ankhor live bridge serves ThingaImportV2 with contacts redacted", async () => {
  const d = await (await fetch(`${BASE}/api/export/ankhor-import?kinds=lead&limit_per_kind=3`)).json();
  assert.equal(d.$schema, "ThingaImportV2");
  assert.ok(Array.isArray(d.thingas) && d.thingas.length > 0);
  assert.equal(d.metadata.contacts_redacted, true, "HTTP surface must always redact");
  const payload = JSON.parse(d.thingas[0].facets.note.content);
  for (const v of Object.values(payload.content)) {
    assert.ok(v !== "3135550100", "raw phone must never appear");
  }
});

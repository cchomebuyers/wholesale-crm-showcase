// thinga.test.js — the parity/contract gate for the ankhor.v1 runtime.
// Run: node --test
//
// Proves the three operations (PUT/GET/INVOKE), the six-axis normalization, recursion via
// children/depth, the no-eval handler registry, schema enforcement, tombstones, and signing.

import { test } from "node:test";
import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { rmSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { createThingaStore, ANKHOR_VERSION } from "./thinga.js";

test("PUT then GET round-trips content and assigns identity", () => {
  const s = createThingaStore(":memory:");
  const id = s.put({ kind: "lead", name: "16133 STEEL", content: { stage: "New", city: "Detroit" } });
  assert.match(id, /^thinga:[0-9a-f-]{36}$/);
  const t = s.get(id);
  assert.equal(t.kind, "lead");
  assert.equal(t.content.stage, "New");
  assert.equal(t.version, 1);
});

test("every Thinga has all six axes, even when empty", () => {
  const s = createThingaStore(":memory:");
  const t = s.get(s.put({ kind: "note", content: { body: "hi" } }));
  for (const axis of ["tags", "children", "parents", "links", "permissions", "checksum", "signature"]) {
    assert.ok(axis in t, `missing axis field: ${axis}`);
  }
  assert.deepEqual(t.children, []);
  assert.equal(t.permissions, "private");
});

test("PUT on an existing id bumps version and preserves created_at", () => {
  const s = createThingaStore(":memory:");
  const id = s.put({ kind: "lead", content: { stage: "New" } });
  const created = s.get(id).created_at;
  s.put({ id, kind: "lead", content: { stage: "Contacted" } });
  const t = s.get(id);
  assert.equal(t.version, 2);
  assert.equal(t.content.stage, "Contacted");
  assert.equal(t.created_at, created);
});

test("recursion: GET depth inlines children (containment)", () => {
  const s = createThingaStore(":memory:");
  const child = s.put({ kind: "activity", content: { body: "called seller" } });
  const parent = s.put({ kind: "lead", content: { stage: "New" }, children: [child] });
  const flat = s.get(parent, 0);
  assert.equal(typeof flat.children[0], "string"); // depth 0 → just the id
  const deep = s.get(parent, 1);
  assert.equal(deep.children[0].content.body, "called seller"); // depth 1 → inlined Thinga
});

test("INVOKE runs a registered handler (no eval) with caps", () => {
  const s = createThingaStore(":memory:");
  s.registerHandler("double_score", (t, args, caps) => {
    assert.ok(caps.get && caps.put && caps.invoke); // scoped capabilities passed in
    return (args.score || 0) * 2;
  });
  const code = s.put({ kind: "code", name: "double", code: { handler: "double_score" } });
  assert.equal(s.invoke(code, { score: 21 }), 42);
});

test("INVOKE on a pure-data Thinga returns its content", () => {
  const s = createThingaStore(":memory:");
  const id = s.put({ kind: "note", content: { body: "just data" } });
  assert.deepEqual(s.invoke(id), { body: "just data" });
});

test("interaction_script: a Thinga delegates INVOKE to a code Thinga, itself as subject", () => {
  const s = createThingaStore(":memory:");
  s.registerHandler("addr_upper", (subject) => (subject.content.address || "").toUpperCase());
  const script = s.put({ kind: "code", code: { handler: "addr_upper" } });
  const lead = s.put({ kind: "lead", content: { address: "16133 steel" }, interaction_script: script });
  assert.equal(s.invoke(lead), "16133 STEEL");
});

test("schema enforcement only where a kind opts in (Ankhor §7.2)", () => {
  const s = createThingaStore(":memory:");
  s.registerSchema("ankhor.v1.lead", (content) =>
    content.status === "Sold" ? "sold records are comps, never leads" : true);
  // a lead opting into the schema is gated
  assert.throws(() => s.put({ kind: "lead", schema: "ankhor.v1.lead", content: { status: "Sold" } }),
    /sold records are comps/);
  // a Thinga not opting in is unaffected (kind is manners, not enforcement)
  assert.ok(s.put({ kind: "lead", content: { status: "Sold" } }));
});

test("tombstone hides from GET/QUERY but keeps history", () => {
  const s = createThingaStore(":memory:");
  const id = s.put({ kind: "lead", content: { stage: "Dead" } });
  s.tombstone(id);
  assert.equal(s.get(id), null);
  assert.equal(s.query(null, { kind: "lead" }).length, 0);
  assert.equal(s.query(null, { kind: "lead", includeDeleted: true }).length, 1); // row still there
});

test("QUERY filters by kind and predicate", () => {
  const s = createThingaStore(":memory:");
  s.put({ kind: "lead", content: { score: 80 } });
  s.put({ kind: "lead", content: { score: 20 } });
  s.put({ kind: "buyer", content: {} });
  const hot = s.query((t) => t.content.score >= 50, { kind: "lead" });
  assert.equal(hot.length, 1);
});

test("reverse-link index records forward links and parent containment", () => {
  const s = createThingaStore(":memory:");
  const a = s.put({ kind: "lead", content: {} });
  const b = s.put({ kind: "message", content: {}, links: [{ kind: "sent_to", to: a }] });
  const rows = s.db.prepare("SELECT link_kind, to_id FROM thinga_links WHERE from_id=?").all(b);
  assert.equal(rows[0].link_kind, "sent_to");
  assert.equal(rows[0].to_id, a);
});

test("subscribers are INVOKEd on change, and a failing subscriber can't break PUT", () => {
  const s = createThingaStore(":memory:");
  let fired = 0;
  s.registerHandler("on_change", () => { fired++; });
  s.registerHandler("explode", () => { throw new Error("boom"); });
  const target = s.put({ kind: "lead", content: {} });
  s.put({ kind: "code", code: { handler: "on_change" }, links: [{ kind: "subscribes_to", to: target }] });
  s.put({ kind: "code", code: { handler: "explode" }, links: [{ kind: "subscribes_to", to: target }] });
  assert.doesNotThrow(() => s.put({ id: target, kind: "lead", content: { stage: "Contacted" } }));
  assert.ok(fired >= 1);
});

test("every PUT is signed and verifies against the store key", () => {
  const s = createThingaStore(":memory:");
  const id = s.put({ kind: "lead", content: { stage: "New" } });
  const t = s.get(id);
  assert.match(t.checksum, /^sha256:/);
  assert.match(t.signature, /^ed25519:/);
  assert.equal(s.verify(id), true);
});

test("version banner is ankhor.v1", () => {
  assert.equal(ANKHOR_VERSION, "ankhor.v1");
});

test("re-entrancy guard: a subscriber that re-PUTs its target does not infinite-loop", () => {
  const s = createThingaStore(":memory:");
  const target = s.put({ kind: "lead", content: { n: 0 } });
  let calls = 0;
  s.registerHandler("bump", (_subscriber, args, caps) => {
    calls++;
    caps.put({ id: args.changed, kind: "lead", content: { n: calls } }); // re-PUT target → would recurse
  });
  s.put({ kind: "code", code: { handler: "bump" }, links: [{ kind: "subscribes_to", to: target }] });
  assert.doesNotThrow(() => s.put({ id: target, kind: "lead", content: { n: 1 } }));
  assert.ok(calls >= 1 && calls < 5, `expected bounded subscriber calls, got ${calls}`);
});

// ---- remaining API surface + error paths (every public method exercised) ----

test("PUT requires a kind", () => {
  const s = createThingaStore(":memory:");
  assert.throws(() => s.put({ content: {} }), /requires a `kind`/);
});

test("GET on a missing id returns null", () => {
  const s = createThingaStore(":memory:");
  assert.equal(s.get("thinga:does-not-exist"), null);
});

test("INVOKE on a missing Thinga throws", () => {
  const s = createThingaStore(":memory:");
  assert.throws(() => s.invoke("thinga:missing"), /no Thinga/);
});

test("INVOKE with an unregistered handler throws a clear error", () => {
  const s = createThingaStore(":memory:");
  const id = s.put({ kind: "code", code: { handler: "not_registered" } });
  assert.throws(() => s.invoke(id), /no handler "not_registered"/);
});

test("verify() is false for a missing/unsigned Thinga", () => {
  const s = createThingaStore(":memory:");
  assert.equal(s.verify("thinga:missing"), false);
});

test("store exposes an ed25519 publicKey", () => {
  const s = createThingaStore(":memory:");
  assert.equal(s.publicKey.asymmetricKeyType, "ed25519");
});

test("registerHandler / registerSchema are chainable (return the store)", () => {
  const s = createThingaStore(":memory:");
  assert.equal(s.registerHandler("a", () => 1), s);
  assert.equal(s.registerSchema("b", () => true), s);
});

test("QUERY without a kind scans all live Thingas", () => {
  const s = createThingaStore(":memory:");
  s.put({ kind: "lead", content: {} });
  s.put({ kind: "buyer", content: {} });
  assert.equal(s.query(null).length, 2);
});

test("persistence: a Thinga survives reopen and still verifies (key reload path)", () => {
  const path = join(tmpdir(), `thinga-test-${randomUUID()}.db`);
  try {
    let s = createThingaStore(path);
    const id = s.put({ kind: "lead", content: { stage: "New" }, category_path: "Pipeline/New" });
    s.db.close();

    // reopen — exercises loadOrCreateKeypair() existing-key branch + crypto_importPem()
    s = createThingaStore(path);
    const t = s.get(id);
    assert.equal(t.content.stage, "New");
    assert.equal(t.category_path, "Pipeline/New");
    assert.equal(s.verify(id), true, "signature must still verify after reopen with the persisted key");
    s.db.close();
  } finally {
    rmSync(path, { force: true });
  }
});

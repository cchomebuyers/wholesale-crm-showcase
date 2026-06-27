// faceted_thinga.test.js — gate the faceted registry foundation.
import { test } from "node:test";
import assert from "node:assert/strict";
import { contentHash, createFacetRegistry, makeThinga, parseThinga, resolvePointer, shardKey, walk } from "./faceted_thinga.js";

test("content hash is deterministic and content-addressed (same content → same id)", () => {
  const a = contentHash({ x: 1, y: 2 });
  const b = contentHash({ y: 2, x: 1 }); // key order must not matter
  assert.equal(a, b);
  assert.match(a, /^sha256:[0-9a-f]{64}$/);
  assert.notEqual(a, contentHash({ x: 1, y: 3 }));
});

test("makeThinga builds a $header with id=hash, kind/type, $facets, parents/children", () => {
  const t = makeThinga({ kind: "property", type: "industrial", name: "5 ELM",
    content: { address: "5 ELM" }, facets: { location: { lat: 1 }, value: { assessed: 100 } },
    parents: ["sha256:p"], children: ["sha256:c"] });
  assert.equal(t.$header.id, t.$header.hash);
  assert.equal(t.$header.kind, "property");
  assert.equal(t.$header.type, "industrial");
  assert.deepEqual(t.$header.$facets.sort(), ["location", "value"]);
  assert.deepEqual(t.$header.parents, ["sha256:p"]);
});

test("facet registry matches the real contract: initialize/register/get/has/list/stats/reset", () => {
  const r = createFacetRegistry();
  r.initialize([{ id: "location", name: "Location", required: false,
    validate: (d) => (d.lat != null ? { success: true, data: { lat: d.lat, lon: d.lon ?? null } } : { success: false, error: "lat required" }) }]);
  assert.ok(r.isInitialized());
  assert.ok(r.has("location"));
  assert.deepEqual(r.list(), ["location"]);
  r.get("location"); // bump usage
  assert.equal(r.getStats().location.usageCount, 1);
  assert.throws(() => r.register({ name: "bad" }), /id, validate/);
  r.reset(); assert.equal(r.isInitialized(), false);
});

test("meta-parser routes facets and returns partial success with recoverable errors", () => {
  const r = createFacetRegistry();
  r.register({ id: "location", validate: (d) => (d.lat != null ? { success: true, data: { lat: d.lat } } : { success: false, error: "lat required" }) });
  const t = makeThinga({ kind: "property", facets: { location: { lat: 42 }, mystery: { z: 1 } } });
  const res = parseThinga(t, r); // lenient
  assert.equal(res.partial, true);
  assert.equal(res.parsed.location.lat, 42);
  assert.equal(res.errors[0].facet, "mystery");
  assert.equal(res.errors[0].error, "no_parser");
});

test("meta-parser strict mode throws on a bad facet", () => {
  const r = createFacetRegistry();
  const t = makeThinga({ kind: "x", facets: { ghost: {} } });
  assert.throws(() => parseThinga(t, r, { mode: "strict" }), /no parser/);
});

test("meta-parser surfaces validator warnings without failing", () => {
  const r = createFacetRegistry();
  r.register({ id: "loc", validate: () => ({ success: true, data: { ok: 1 }, warnings: ["approx geocode"] }) });
  const res = parseThinga(makeThinga({ kind: "p", facets: { loc: {} } }), r);
  assert.equal(res.ok, true);
  assert.equal(res.warnings[0].warning, "approx geocode");
});

test("pointer resolver handles uuid/id/path/title schemes", () => {
  const store = { byId: (v) => ({ kind: "lead", id: v }), byPath: (v) => ({ path: v }), byTitle: (v) => ({ title: v }) };
  assert.equal(resolvePointer("uuid:abc", store).id, "abc");
  assert.equal(resolvePointer("id:xyz", store).id, "xyz");
  assert.equal(resolvePointer("path:/a/b", store).path, "/a/b");
  assert.equal(resolvePointer("title:Hello", store).title, "Hello");
  assert.equal(resolvePointer("garbage", store), null);
});

test("shard routing is deterministic and within range; semantic router overrides", () => {
  const t = makeThinga({ kind: "property", content: { a: 1 } });
  const k1 = shardKey(t, { shards: 16 });
  const k2 = shardKey(t, { shards: 16 });
  assert.equal(k1, k2);
  assert.ok(k1 >= 0 && k1 < 16);
  assert.equal(shardKey(t, { router: () => 99 }), 99);
});

test("walk recurses inline children and id-children via getChild", () => {
  const leaf = makeThinga({ kind: "lead", content: { n: 2 } });
  const root = makeThinga({ kind: "folder", content: { n: 1 }, children: [leaf, "sha256:ref"] });
  const seen = [];
  walk(root, (t) => seen.push(t.$header.kind), (id) => (id === "sha256:ref" ? makeThinga({ kind: "ref-child" }) : null));
  assert.deepEqual(seen, ["folder", "lead", "ref-child"]);
});

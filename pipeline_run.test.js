// pipeline_run.test.js — the Fill-Properties chain manifest + selection logic.
// Covers the pure, deterministic surface (stage manifest integrity, presets, stage
// selection, and CLI-arg construction). runPipeline() itself spawns child processes
// and is exercised live, not unit-tested here.
import { test } from "node:test";
import assert from "node:assert/strict";
import { PIPELINE_STAGES, PIPELINE_PRESETS, resolveStageIds } from "./pipeline_run.js";

const ids = PIPELINE_STAGES.map((s) => s.id);

test("every stage has a well-formed shape", () => {
  for (const s of PIPELINE_STAGES) {
    assert.ok(s.id && typeof s.id === "string", "id");
    assert.ok(s.label && typeof s.label === "string", "label");
    assert.match(s.script, /^tools\/.+\.mjs$/, `script path: ${s.script}`);
    assert.equal(typeof s.args, "function", "args fn");
    assert.ok(Array.isArray(s.args({})), "args returns an array");
    assert.ok(s.args({}).every((a) => typeof a === "string"), "args are strings");
    assert.equal(typeof s.optional, "boolean", "optional flag");
  }
});

test("stage ids are unique", () => {
  assert.equal(new Set(ids).size, ids.length);
});

test("the local re-tier core is required, network stages are optional", () => {
  const byId = Object.fromEntries(PIPELINE_STAGES.map((s) => [s.id, s]));
  for (const req of ["grade", "build", "export"]) assert.equal(byId[req].optional, false, `${req} required`);
  for (const opt of ["harvest", "context", "geocode", "owners", "arv", "buyers"]) assert.equal(byId[opt].optional, true, `${opt} optional`);
});

test("presets reference only real stage ids", () => {
  for (const [name, list] of Object.entries(PIPELINE_PRESETS)) {
    for (const id of list) assert.ok(ids.includes(id), `${name} → ${id} exists`);
  }
});

test("local preset = every no-network stage, in manifest order", () => {
  assert.deepEqual(PIPELINE_PRESETS.local, ["geo_apply", "portfolio", "grade", "build", "export"]);
  // Nothing in local may touch the network — that's the preset's contract.
  for (const id of PIPELINE_PRESETS.local) {
    assert.equal(PIPELINE_STAGES.find((s) => s.id === id).network, false, `${id} must be offline`);
  }
});

test("full preset is the whole manifest in order", () => {
  assert.deepEqual(PIPELINE_PRESETS.full, ids);
});

test("resolveStageIds: preset selection", () => {
  assert.deepEqual(resolveStageIds({ preset: "local" }), ["geo_apply", "portfolio", "grade", "build", "export"]);
  assert.deepEqual(resolveStageIds({ preset: "full" }), ids);
});

test("resolveStageIds defaults to full when no/unknown preset", () => {
  assert.deepEqual(resolveStageIds({}), ids);
  assert.deepEqual(resolveStageIds({ preset: "nope" }), ids);
});

test("resolveStageIds with explicit stageIds keeps manifest order and drops unknowns", () => {
  // input order reversed + a bogus id; output must follow manifest order, bogus dropped
  assert.deepEqual(resolveStageIds({ stageIds: ["build", "grade"] }), ["grade", "build"]);
  assert.deepEqual(resolveStageIds({ stageIds: ["bogus", "export"] }), ["export"]);
});

test("explicit stageIds win over preset", () => {
  assert.deepEqual(resolveStageIds({ preset: "full", stageIds: ["build"] }), ["build"]);
});

test("build stage threads hot/min score into CLI flags", () => {
  const build = PIPELINE_STAGES.find((s) => s.id === "build");
  const args = build.args({ hotScore: 80, minScore: 55 });
  assert.ok(args.includes("--persist"));
  assert.ok(args.includes("--hot-score=80"));
  assert.ok(args.includes("--min-score=55"));
});

test("build stage falls back to default thresholds", () => {
  const build = PIPELINE_STAGES.find((s) => s.id === "build");
  const args = build.args({});
  assert.ok(args.includes("--hot-score=70"));
  assert.ok(args.includes("--min-score=60"));
});

test("harvest stage threads pages/max-sources/min-score", () => {
  const harvest = PIPELINE_STAGES.find((s) => s.id === "harvest");
  const args = harvest.args({ pages: 2, maxSources: 4, minScore: 65 });
  assert.ok(args.includes("--pages=2"));
  assert.ok(args.includes("--max-sources=4"));
  assert.ok(args.includes("--import"));
  assert.ok(args.includes("--min-score=65"));
});

// tools/prove_rulesreg.test.js — gate the substrate against real data.
// Proves a real rulesreg subtree round-trips folder → Thingas → folder, byte-identical.

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { proveRoundtrip } from "./prove_rulesreg.mjs";

const TARGET = join(import.meta.dirname, "..", "..", "rulesreg", "_scraping");

test("rulesreg/_scraping round-trips folder → Thingas → folder, byte-identical", { skip: !existsSync(TARGET) }, () => {
  const r = proveRoundtrip(TARGET);
  assert.ok(r.files > 0, "expected at least one file in the subtree");
  assert.ok(r.thingaCount > r.files, "expected folder Thingas in addition to file Thingas");
  assert.deepEqual(r.diffs, [], "round-trip must be byte-identical");
  assert.equal(r.ok, true);
});

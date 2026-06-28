import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildEcosystemSnapshot,
  normalizeSearchPlan,
  selectConnectorsForPlan,
} from "./ecosystem_search_plan.js";

const conn = (id, type, extra = {}) => ({ id, type, async search() { return []; }, ...extra });

test("search plans select arbitrary connector ids without fixed counts", () => {
  const registry = {
    a: conn("a", "listings"),
    b: conn("b", "violations"),
    c: conn("c", "public-contact"),
  };
  const { connectors, plan } = selectConnectorsForPlan(registry, { includeConnectorIds: ["c", "a"] });
  assert.deepEqual(connectors.map((c) => c.id), ["a", "c"]);
  assert.equal(plan.maxConnectors, null);
});

test("search plans include and exclude source types", () => {
  const registry = {
    a: conn("a", "listings"),
    b: conn("b", "violations"),
    c: conn("c", "comps"),
    d: conn("d", "violations", { enabled: false }),
  };
  const { connectors } = selectConnectorsForPlan(registry, {
    includeSourceTypes: ["violations", "comps"],
    excludeSourceTypes: ["comps"],
  });
  assert.deepEqual(connectors.map((c) => c.id), ["b"]);
});

test("maxConnectors is optional execution policy, not schema shape", () => {
  assert.equal(normalizeSearchPlan({}).maxConnectors, null);
  assert.equal(normalizeSearchPlan({ maxConnectors: 2 }).maxConnectors, 2);
  const registry = Object.fromEntries(Array.from({ length: 5 }, (_, i) => [`s${i}`, conn(`s${i}`, "property")]));
  assert.equal(selectConnectorsForPlan(registry, {}).connectors.length, 5);
  assert.equal(selectConnectorsForPlan(registry, { maxConnectors: 3 }).connectors.length, 3);
});

test("ecosystem snapshot combines participants and selected connectors", () => {
  const snap = buildEcosystemSnapshot({
    registry: { a: conn("a", "listings"), b: conn("b", "violations") },
    participants: [{ id: "HUMAN", kind: "human" }, { id: "MODEL_A", kind: "agent" }],
    searchPlan: { includeSourceTypes: ["violations"] },
  });
  assert.equal(snap.counts.connectors_total, 2);
  assert.equal(snap.counts.connectors_selected, 1);
  assert.equal(snap.counts.participants, 2);
  assert.equal(snap.connectors[0].id, "b");
  assert.equal(snap.participants[0].kind, "human");
});


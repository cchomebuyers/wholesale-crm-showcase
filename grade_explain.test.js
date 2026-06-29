// grade_explain.test.js -- the grade must be explainable, not an opaque number.
import { test } from "node:test";
import assert from "node:assert/strict";
import { gradeBadge, topFactors, explainGrade } from "./grade_explain.js";
import { gradeProperty } from "./property_score.js";

test("gradeBadge maps score to A/B/C/D", () => {
  assert.equal(gradeBadge(85), "A");
  assert.equal(gradeBadge(60), "B");
  assert.equal(gradeBadge(40), "C");
  assert.equal(gradeBadge(10), "D");
  assert.equal(gradeBadge(null), "?");
});

test("topFactors ranks by absolute points and drops zeros", () => {
  const factors = [
    { factor: "distress_base", points: 31 },
    { factor: "owner_signal", points: 40 },
    { factor: "value_equity", points: 0 },
    { factor: "data_completeness", points: 2 },
  ];
  const t = topFactors(factors, 2);
  assert.deepEqual(t.map((f) => f.factor), ["owner_signal", "distress_base"]);
  assert.ok(!t.some((f) => f.points === 0));
});

test("explainGrade composes a readable why from a real gradeProperty result", () => {
  const g = gradeProperty({ source: "cook-il-violations", distress_score: 68, owner_name: "3144 WALTON PROPERTIES", owner_mailing: "1626 W LAKE ST", address: "3138 W WALTON ST", arv: 538183, mao: 321728 });
  const s = explainGrade(g);
  assert.match(s, /^Grade \d+ \([ABCD]\):/);
  assert.match(s, /driven by/);
  assert.match(s, /owner signals|source distress|value & spread/);
});

test("explainGrade surfaces a negative driver for an institutional owner", () => {
  const g = gradeProperty({ source: "cook-il-violations", distress_score: 68, owner_name: "CHICAGO TRANSIT AUTHOR", address: "1 A ST" });
  const s = explainGrade(g);
  assert.match(s, /held back by/);
  assert.equal(gradeBadge(g.grade), "D");
});

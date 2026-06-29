// property_score.test.js -- frontier #8: the grade must DIFFERENTIATE same-source rows.
import { test } from "node:test";
import assert from "node:assert/strict";
import { gradeProperty, summarizeGrades } from "./property_score.js";

// Two cook-il-violations rows with identical flat lead_score=64 must NOT grade the same:
// an absentee LLC owner with a wide spread is a far better lead than an owner-occupied peer.
test("differentiates two rows that share a flat per-source score", () => {
  const base = { source: "cook-il-violations", lead_score: 64, distress_score: 68, motivation_score: 58 };
  const absenteeEntity = gradeProperty({ ...base, address: "3138 W WALTON ST", owner_name: "3144 WALTON PROPERTIES", owner_mailing: "1626 W LAKE ST", arv: 538183, mao: 321728 });
  const ownerOccupied = gradeProperty({ ...base, address: "7001 S EBERHART AVE", owner_name: "S FINCH", owner_mailing: "7001 S EBERHART", arv: 253803, mao: 122662 });
  assert.ok(absenteeEntity.grade > ownerOccupied.grade, `absentee/entity (${absenteeEntity.grade}) should outrank owner-occupied (${ownerOccupied.grade})`);
  assert.ok(absenteeEntity.reasons.some((r) => /absentee/i.test(r)));
});

test("institutional/govt owner is forced to a hold tier hint regardless of source score", () => {
  const g = gradeProperty({ source: "cook-il-violations", lead_score: 64, distress_score: 68, owner_name: "CHICAGO TRANSIT AUTHOR", address: "2842 W BELDEN AVE" });
  assert.equal(g.tier_hint, "hold");
  assert.ok(g.grade < 35);
});

test("ARV + wide ARV->MAO headroom raises the grade", () => {
  const noValue = gradeProperty({ source: "x", distress_score: 60, owner_name: "JANE DOE", address: "1 MAIN ST" });
  const wide = gradeProperty({ source: "x", distress_score: 60, owner_name: "JANE DOE", address: "1 MAIN ST", arv: 200000, mao: 100000 });
  assert.ok(wide.grade > noValue.grade);
  assert.ok(wide.factors.find((f) => f.factor === "value_equity").points >= 12); // 8 ARV + >=4 headroom
});

test("grade stays within 0..100 and exposes transparent factors", () => {
  const g = gradeProperty({ source: "x", distress_score: 100, owner_name: "MAPLE COURT LLC", owner_mailing: "32 N DEAN ST", address: "1120 E 47TH ST", arv: 300000, mao: 150000, year_built: 1920, square_footage: 2000, city: "Chicago" });
  assert.ok(g.grade >= 0 && g.grade <= 100);
  const names = g.factors.map((f) => f.factor);
  assert.deepEqual(names, ["distress_base", "owner_signal", "value_equity", "data_completeness", "portfolio"]);
});

test("portfolio membership raises the grade (bulk seller = stronger lead)", () => {
  const p = { source: "cook-il-violations", distress_score: 68, owner_name: "LORBER ENTERPRISES LLC", owner_mailing: "1 OTHER ST", address: "100 MAIN ST", arv: 200000, mao: 100000 };
  const single = gradeProperty(p, { portfolioCount: 1 });
  const bulk = gradeProperty(p, { portfolioCount: 5 });
  assert.ok(bulk.grade > single.grade, `bulk (${bulk.grade}) should outrank single (${single.grade})`);
  assert.ok(bulk.reasons.some((r) => /portfolio/i.test(r)));
  assert.equal(single.factors.find((f) => f.factor === "portfolio").points, 0);
});

test("a parcel-only row with no owner/value grades low (research/hold), not flat-26", () => {
  const g = gradeProperty({ source: "santaclara-ca-parcels", lead_score: 26, address: "500 PARCEL WAY" });
  assert.ok(g.grade <= 30);
  assert.ok(["research", "hold"].includes(g.tier_hint));
});

test("summarizeGrades proves a batch is no longer flat", () => {
  const flat = summarizeGrades([26, 26, 26, 26]);
  assert.equal(flat.distinct, 1);
  assert.equal(flat.spread, 0);
  const varied = summarizeGrades([{ grade: 31 }, { grade: 48 }, { grade: 72 }]);
  assert.equal(varied.distinct, 3);
  assert.ok(varied.spread > 0);
});

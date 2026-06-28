import { test } from "node:test";
import assert from "node:assert/strict";
import {
  leadEngineSettingsWrites,
  leadEngineTickDecision,
  normalizeLeadEngineSettings,
} from "./lead_engine_scheduler.js";

test("normalizes lead-engine scheduler defaults and clamps numeric limits", () => {
  const s = normalizeLeadEngineSettings({
    lead_engine_auto_hours: "999",
    lead_engine_city: " Detroit ",
    lead_engine_state: " MI ",
    lead_engine_plan_id: "distress-contact",
    lead_engine_source_limit: "-12",
    lead_engine_result_limit: "9999",
    lead_engine_shortlist_limit: "0",
    lead_engine_dispatch_council: "1",
  });

  assert.equal(s.autoHours, 168);
  assert.equal(s.city, "Detroit");
  assert.equal(s.state, "MI");
  assert.equal(s.planId, "distress-contact");
  assert.equal(s.sourceLimit, 0);
  assert.equal(s.resultLimitPerSource, 500);
  assert.equal(s.shortlistLimit, 1);
  assert.equal(s.dispatchCouncil, true);
});

test("sanitizes settings POST body into persisted setting keys", () => {
  assert.deepEqual(leadEngineSettingsWrites({
    city: " Cleveland ",
    state: "OH",
    zip: "",
    planId: " on-market ",
    autoHours: "24",
    sourceLimit: "500",
    resultLimitPerSource: "2",
    shortlistLimit: "abc",
    dispatchCouncil: true,
  }), {
    lead_engine_city: "Cleveland",
    lead_engine_state: "OH",
    lead_engine_zip: "",
    lead_engine_plan_id: "on-market",
    lead_engine_auto_hours: "24",
    lead_engine_source_limit: "100",
    lead_engine_result_limit: "2",
    lead_engine_shortlist_limit: "25",
    lead_engine_dispatch_council: "1",
  });
});

test("scheduler stays disabled without cadence or target", () => {
  assert.equal(leadEngineTickDecision({ autoHours: 0, city: "Detroit" }).action, "disabled");
  assert.equal(leadEngineTickDecision({ autoHours: 12, city: "", zip: "" }).action, "disabled");
});

test("scheduler primes the clock on the first eligible tick", () => {
  const d = leadEngineTickDecision({ autoHours: 12, city: "Detroit", lastRun: null });
  assert.equal(d.action, "prime_clock");
});

test("scheduler waits until interval elapses, then runs", () => {
  const now = Date.parse("2026-06-28T12:00:00.000Z");
  const wait = leadEngineTickDecision({
    autoHours: 12,
    city: "Detroit",
    lastRun: "2026-06-28T06:30:00.000Z",
  }, now);
  assert.equal(wait.action, "wait");
  assert.equal(wait.nextRunAt, "2026-06-28T18:30:00.000Z");

  const run = leadEngineTickDecision({
    autoHours: 12,
    city: "Detroit",
    lastRun: "2026-06-27T23:59:00.000Z",
  }, now);
  assert.equal(run.action, "run");
});

test("invalid last-run timestamp runs instead of wedging the loop", () => {
  const d = leadEngineTickDecision({ autoHours: 1, zip: "48235", lastRun: "not-a-date" });
  assert.equal(d.action, "run");
});

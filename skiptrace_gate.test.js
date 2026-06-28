// skiptrace_gate.test.js -- spend discipline for paid skip-trace.
import { test } from "node:test";
import assert from "node:assert/strict";
import { skiptraceDecision, summarizeSkiptrace } from "./skiptrace_gate.js";

const pay = (signals) => ({ tier: "pay_to_unlock", signals });

test("approves spend when owner known + distress + (ARV or demand) on a spend tier", () => {
  const d = skiptraceDecision(
    { owner_name: "MAPLE COURT LLC", address: "1120 E 47TH ST", owner_mailing: "32 N DEAN ST" },
    pay({ distress_present: true, arv: true, buyer_demand: true, absentee_owner: true }),
  );
  assert.equal(d.allowed, true);
  assert.equal(d.max_cost, 0.15);
  assert.equal(d.skiptrace_input.owner_name, "MAPLE COURT LLC");
  assert.match(d.reason, /owner known/);
  assert.match(d.compliance_note, /outreach_allowed:false/);
});

test("denies when owner unknown (do free owner-join first)", () => {
  const d = skiptraceDecision({ address: "1 Main St" }, pay({ distress_present: true, arv: true }));
  assert.equal(d.allowed, false);
  assert.match(d.reason, /owner unknown/);
});

test("denies research/hold tiers (free enrichment first)", () => {
  assert.equal(skiptraceDecision({ owner_name: "X" }, { tier: "research", signals: { distress_present: true, arv: true } }).allowed, false);
  assert.equal(skiptraceDecision({ owner_name: "X" }, { tier: "hold", signals: {} }).allowed, false);
});

test("denies when no ARV and no buyer demand", () => {
  const d = skiptraceDecision({ owner_name: "JANE OWNER" }, pay({ distress_present: true, arv: false, buyer_demand: false }));
  assert.equal(d.allowed, false);
  assert.match(d.reason, /no ARV and no buyer demand/);
});

test("never spends on institutional/govt owners", () => {
  const d = skiptraceDecision({ owner_name: "CHICAGO TRANSIT AUTHOR" }, pay({ institutional_owner: true, distress_present: true, arv: true }));
  assert.equal(d.allowed, false);
  assert.match(d.reason, /institutional/);
});

test("summarizeSkiptrace estimates spend to unlock", () => {
  const ds = [
    skiptraceDecision({ owner_name: "OWNER ONE LLC" }, pay({ distress_present: true, arv: true })),
    skiptraceDecision({ owner_name: "OWNER TWO LLC" }, pay({ distress_present: true, buyer_demand: true })),
    skiptraceDecision({}, pay({ distress_present: true, arv: true })), // denied (no owner)
  ];
  const s = summarizeSkiptrace(ds);
  assert.equal(s.allowed, 2);
  assert.equal(s.denied, 1);
  assert.equal(s.est_max_spend, 0.3);
});

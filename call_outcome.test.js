// call_outcome.test.js — the post-dial paper trail.
import { test } from "node:test";
import assert from "node:assert/strict";
import { CALL_OUTCOMES, normalizeCallOutcome, summarizeOutcomes } from "./call_outcome.js";

test("every outcome normalizes with a concrete next action", () => {
  for (const outcome of CALL_OUTCOMES) {
    const input = { outcome, seller_price: 100000, offer_amount: 90000, follow_up_date: "2026-07-09" };
    const r = normalizeCallOutcome(input);
    assert.ok(r.ok, `${outcome}: ${r.error}`);
    assert.ok(r.record.next_action && r.record.next_action.length > 5, `${outcome} has next_action`);
  }
});

test("unknown outcome rejected", () => {
  assert.equal(normalizeCallOutcome({ outcome: "maybe" }).ok, false);
  assert.equal(normalizeCallOutcome({}).ok, false);
});

test("seller_price requires a positive price", () => {
  assert.equal(normalizeCallOutcome({ outcome: "seller_price" }).ok, false);
  assert.equal(normalizeCallOutcome({ outcome: "seller_price", seller_price: -5 }).ok, false);
  const ok = normalizeCallOutcome({ outcome: "seller_price", seller_price: 185000 });
  assert.ok(ok.ok);
  assert.equal(ok.record.seller_price, 185000);
});

test("offer_made requires amount AND follow-up date", () => {
  assert.equal(normalizeCallOutcome({ outcome: "offer_made", offer_amount: 90000 }).ok, false);
  const ok = normalizeCallOutcome({ outcome: "offer_made", offer_amount: 90000, follow_up_date: "2026-07-10" });
  assert.ok(ok.ok);
  assert.equal(ok.record.follow_up_date, "2026-07-10");
});

test("follow_up requires YYYY-MM-DD", () => {
  assert.equal(normalizeCallOutcome({ outcome: "follow_up", follow_up_date: "next tuesday" }).ok, false);
  assert.ok(normalizeCallOutcome({ outcome: "follow_up", follow_up_date: "2026-08-01" }).ok);
});

test("do_not_call suppresses outreach — the compliance flag rides the record", () => {
  const r = normalizeCallOutcome({ outcome: "do_not_call" });
  assert.ok(r.ok);
  assert.equal(r.record.outreach_suppressed, true);
  assert.match(r.record.next_action, /STOP/);
});

test("summarize: latest outcome wins, do_not_call is sticky forever", () => {
  const rows = [
    { outcome: "follow_up", follow_up_date: "2026-07-12" },
    { outcome: "do_not_call" },
    { outcome: "no_answer" },
  ];
  const s = summarizeOutcomes(rows);
  assert.equal(s.attempts, 3);
  assert.equal(s.last_outcome, "follow_up");
  assert.equal(s.outreach_suppressed, true, "DNC anywhere in history suppresses");
  assert.match(s.next_action, /STOP/);
});

test("summarize surfaces the seller price from history", () => {
  const s = summarizeOutcomes([
    { outcome: "offer_made", follow_up_date: "2026-07-15" },
    { outcome: "seller_price", seller_price: 172000 },
  ]);
  assert.equal(s.seller_price, 172000);
  assert.equal(s.follow_up_date, "2026-07-15");
});

test("empty history is a clean slate", () => {
  const s = summarizeOutcomes([]);
  assert.equal(s.attempts, 0);
  assert.equal(s.outreach_suppressed, false);
});

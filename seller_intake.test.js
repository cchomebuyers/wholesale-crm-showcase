import { test } from "node:test";
import assert from "node:assert/strict";
import { buildSellerIntakeQueue } from "./seller_intake.js";

test("buildSellerIntakeQueue prioritizes first-party callable cash-offer leads", () => {
  const out = buildSellerIntakeQueue({
    consentRecords: [
      {
        id: 1,
        created_at: "2026-06-29T09:00:00.000Z",
        name: "Jane Seller",
        phone: "3135550100",
        address: "10 Main St",
        channels: JSON.stringify(["call", "sms"]),
        source: "first_party_landing",
        offer: "cash offer",
        legal_basis: "first_party_express_consent",
      },
      {
        id: 2,
        created_at: "2026-06-29T09:01:00.000Z",
        name: "Email Seller",
        email: "seller@example.com",
        channels: JSON.stringify(["email"]),
        source: "first_party_landing",
        offer: "question",
      },
    ],
  });

  assert.equal(out.summary.consent_records, 2);
  assert.equal(out.summary.first_party_contactable, 2);
  assert.equal(out.items[0].id, 1);
  assert.equal(out.items[0].priority, "hot");
  assert.equal(out.items[0].compliance.outreach_allowed, true);
  assert.deepEqual(out.items[0].compliance.allowed_channels, ["call", "sms"]);
  assert.equal(out.items[0].next_action, "call seller about cash offer");
  assert.equal(out.citations[0].module, "consent.js#makeConsentRecord");
});

test("buildSellerIntakeQueue handles malformed channel payloads as review-only", () => {
  const out = buildSellerIntakeQueue({
    consentRecords: [{ id: 3, name: "No Channel", channels: "[]" }],
  });

  assert.equal(out.items[0].priority, "review");
  assert.equal(out.items[0].compliance.outreach_allowed, false);
  assert.equal(out.items[0].next_action, "review consent record before outreach");
});

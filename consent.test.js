// consent.test.js -- first-party consent is the cleanest contact route.
import { test } from "node:test";
import assert from "node:assert/strict";
import { makeConsentRecord, consentToContactCandidate } from "./consent.js";
import { complianceCheck } from "./compliance_gate.js";

test("valid consent with call+sms produces a record with chosen channels", () => {
  const r = makeConsentRecord({ name: "Jane Seller", phone: "(313) 555-0100", consent: true, channels: ["call", "sms"], offer: "cash offer" });
  assert.equal(r.valid, true);
  assert.deepEqual(r.channels, ["call", "sms"]);
  assert.equal(r.phone, "3135550100");
  assert.equal(r.legal_basis, "first_party_express_consent");
});

test("no opt-in checkbox -> invalid", () => {
  assert.equal(makeConsentRecord({ name: "Jane", phone: "3135550100", channels: ["call"] }).valid, false);
});

test("consented to a channel but missing its contact field -> invalid", () => {
  const r = makeConsentRecord({ name: "Jane", consent: true, channels: ["email"] }); // no email
  assert.equal(r.valid, false);
  assert.match(r.reason, /email/);
});

test("FIRST-PARTY CONSENT FLIPS outreach_allowed:true through the compliance gate", () => {
  const consent = makeConsentRecord({ name: "Jane Seller", phone: "3135550100", consent: true, channels: ["call", "sms"] });
  const candidate = consentToContactCandidate(consent);
  const call = complianceCheck(candidate, { channels: ["call"] });
  assert.equal(call.outreach_allowed, true);          // consent = lawful call basis (no paid skiptrace)
  const sms = complianceCheck(candidate, { channels: ["sms"] });
  assert.equal(sms.outreach_allowed, true);           // sms consent present
});

test("channels NOT consented stay blocked by the gate", () => {
  const consent = makeConsentRecord({ name: "Jane", phone: "3135550100", consent: true, channels: ["call"] }); // call only
  const candidate = consentToContactCandidate(consent);
  const sms = complianceCheck(candidate, { channels: ["sms"] });
  assert.equal(sms.outreach_allowed, false);          // never consented to SMS
  const email = complianceCheck(candidate, { channels: ["email"] });
  assert.equal(email.outreach_allowed, false);
});

test("consentToContactCandidate returns null on invalid consent", () => {
  assert.equal(consentToContactCandidate({ valid: false }), null);
});

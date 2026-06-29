// compliance_gate.test.js -- the authoritative outreach gate.
import { test } from "node:test";
import assert from "node:assert/strict";
import { complianceCheck, gateContactCandidate } from "./compliance_gate.js";

test("default deny: unknown DNC + no consent blocks call/sms/email", () => {
  const r = complianceCheck({ phone: "3135550100", email: "a@b.com" });
  assert.equal(r.outreach_allowed, true); // mail is allowed by default
  assert.deepEqual(r.allowed_channels, ["mail"]);
  assert.ok(r.per_channel.find((c) => c.channel === "call" && !c.allowed));
});

test("call allowed only when phone present AND DNC clear", () => {
  const blocked = complianceCheck({ phone: "3135550100", dnc_status: "" }, { channels: ["call"] });
  assert.equal(blocked.outreach_allowed, false);
  const listed = complianceCheck({ phone: "3135550100", dnc_status: "listed" }, { channels: ["call"] });
  assert.equal(listed.outreach_allowed, false);
  const ok = complianceCheck({ phone: "3135550100", dnc_status: "clear" }, { channels: ["call"] });
  assert.equal(ok.outreach_allowed, true);
});

test("sms requires express consent even if DNC clear", () => {
  const noConsent = complianceCheck({ phone: "3135550100", dnc_status: "clear" }, { channels: ["sms"] });
  assert.equal(noConsent.outreach_allowed, false);
  const consent = complianceCheck({ phone: "3135550100", dnc_status: "clear", sms_consent: true }, { channels: ["sms"] });
  assert.equal(consent.outreach_allowed, true);
});

test("email requires consent", () => {
  assert.equal(complianceCheck({ email: "a@b.com" }, { channels: ["email"] }).outreach_allowed, false);
  assert.equal(complianceCheck({ email: "a@b.com", email_consent: true }, { channels: ["email"] }).outreach_allowed, true);
});

test("mail is allowed without DNC/consent (not restricted)", () => {
  assert.equal(complianceCheck({}, { channels: ["mail"] }).outreach_allowed, true);
});

test("opt-out blocks every channel except nothing (hard stop)", () => {
  const r = complianceCheck({ phone: "3135550100", email: "a@b.com", dnc_status: "clear", sms_consent: true, email_consent: true, opt_out: true });
  assert.equal(r.outreach_allowed, false);
  assert.ok(r.per_channel.every((c) => !c.allowed));
});

test("gateContactCandidate forces source claims back to blocked default", () => {
  const lying = gateContactCandidate({ phone: "3135550100", outreach_allowed: true, compliance_status: "verified" });
  assert.equal(lying.outreach_allowed, false);
  assert.equal(lying.compliance_status, "unchecked");
  assert.ok(lying.compliance_note);
});

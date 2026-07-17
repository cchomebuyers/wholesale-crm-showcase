import test from "node:test";
import assert from "node:assert/strict";
import { classifyRecipient, pickTemplate, mergeEmailFields, emailReady } from "./email_agent.js";

test("classifyRecipient: listing-agent tagged name → realtor", () => {
  assert.equal(classifyRecipient({ seller_name: "Jane Doe (listing agent)" }), "realtor");
});

test("classifyRecipient: acquisitions source → realtor", () => {
  assert.equal(classifyRecipient({ seller_name: "Jane Doe", source: "Acquisitions (RentCast)" }), "realtor");
});

test("classifyRecipient: csv/skip-traced owner → homeowner", () => {
  assert.equal(classifyRecipient({ seller_name: "John Smith", source: "Code violations CSV" }), "homeowner");
  assert.equal(classifyRecipient({}), "homeowner");
});

const TEMPLATES = [
  { id: 4, name: "Cash offer — listing agent", audience: "offer" },
  { id: 5, name: "Cash LOI (Letter of Intent)", audience: "offer" },
  { id: 6, name: "Cash offer — homeowner", audience: "offer" },
  { id: 1, name: "Cold seller — first touch", audience: "leads" },
];

test("pickTemplate: override id wins regardless of type", () => {
  assert.equal(pickTemplate(TEMPLATES, "homeowner", 5).id, 5);
});

test("pickTemplate: homeowner gets the homeowner offer template", () => {
  assert.equal(pickTemplate(TEMPLATES, "homeowner").id, 6);
});

test("pickTemplate: realtor gets the first non-homeowner offer template", () => {
  assert.equal(pickTemplate(TEMPLATES, "realtor").id, 4);
});

test("pickTemplate: falls back to first offer template, then null", () => {
  assert.equal(pickTemplate([TEMPLATES[0]], "homeowner").id, 4);
  assert.equal(pickTemplate([], "realtor"), null);
});

test("mergeEmailFields: fills offer terms, cleans agent tag, leaves unknowns", () => {
  const lead = { seller_name: "Jane Doe (listing agent)", address: "123 Main St", city: "Detroit", arv: 150000 };
  const out = mergeEmailFields(
    "Hi {{first_name}}, offer {{offer}} on {{address}}{{city_clause}}. ARV {{arv}}. EMD {{earnest}}, close {{close_days}} days. {{mystery}} — {{my_name}} {{my_phone}}",
    lead,
    { myName: "Sonny", myPhone: "555-0100", offer: 42000, earnest: 1000, closeDays: 30 },
  );
  assert.equal(out,
    "Hi Jane, offer $42,000 on 123 Main St in Detroit. ARV $150,000. EMD $1,000, close 30 days. {{mystery}} — Sonny 555-0100");
});

test("mergeEmailFields: {{date}} is filled", () => {
  const out = mergeEmailFields("Dated {{date}}.", {}, { date: "July 10, 2026" });
  assert.equal(out, "Dated July 10, 2026.");
});

test("emailReady: needs email + price, no offer out, not dead/closed", () => {
  assert.equal(emailReady({ seller_email: "a@b.com", mao: 40000, stage: "New" }), true);
  assert.equal(emailReady({ seller_email: "a@b.com", offer_amount: 30000, stage: "Contacted" }), true);
  assert.equal(emailReady({ seller_email: "", mao: 40000, stage: "New" }), false);
  assert.equal(emailReady({ seller_email: "a@b.com", stage: "New" }), false);
  assert.equal(emailReady({ seller_email: "a@b.com", mao: 40000, stage: "Dead" }), false);
  assert.equal(emailReady({ seller_email: "a@b.com", mao: 40000, stage: "New", offer_sent_at: "2026-07-01" }), false);
});

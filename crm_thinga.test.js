// crm_thinga.test.js — gate the CRM↔substrate bridge (the lead spec, enforced once).

import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { mountCrmSubstrate, mirrorLead, mirrorActivity, mirrorEmail, childrenOfLead,
  leadToThinga, leadCategoryPath, leadThingaId } from "./crm_thinga.js";

const leadRow = (over = {}) => ({
  id: 1, stage: "New", status: null,
  seller_name: "Jane", seller_phone: "(313) 555-0100", seller_email: "jane@example.com",
  address: "16133 STEEL, Detroit, MI 48235", city: "Detroit", state: "MI", zip: "48235",
  arv: 90000, mao: 45000, source: "Detroit code violations", motivation: "Code violation",
  ...over,
});

test("a normal lead mirrors to kind:lead under Pipeline/<stage>", () => {
  const store = mountCrmSubstrate(new DatabaseSync(":memory:"));
  const id = mirrorLead(store, leadRow());
  const t = store.get(id);
  assert.equal(t.kind, "lead");
  assert.equal(t.category_path, "Pipeline/New");
  assert.equal(t.content.crm_id, 1);
  assert.equal(t.schema, "ankhor.v1.lead");
});

test("a SOLD record routes to kind:comps, never a lead", () => {
  const store = mountCrmSubstrate(new DatabaseSync(":memory:"));
  const t = store.get(mirrorLead(store, leadRow({ stage: "Closed" })));
  assert.equal(t.kind, "comps");
  assert.equal(t.category_path, "Comps");
  assert.equal(t.schema, null);
});

test("a no-contact lead routes to the research queue, never dropped", () => {
  const store = mountCrmSubstrate(new DatabaseSync(":memory:"));
  const t = store.get(mirrorLead(store, leadRow({ seller_phone: "", seller_email: "" })));
  assert.equal(t.kind, "lead");
  assert.equal(t.category_path, "Prospects/pending_research");
});

test("the ankhor.v1.lead schema REJECTS a sold record forced in as a lead", () => {
  const store = mountCrmSubstrate(new DatabaseSync(":memory:"));
  assert.throws(
    () => store.put({ kind: "lead", schema: "ankhor.v1.lead", content: { status: "Sold" } }),
    /comps .* never leads/,
  );
});

test("mirror is idempotent — same row → same id, version bumps not duplicates", () => {
  const store = mountCrmSubstrate(new DatabaseSync(":memory:"));
  const id1 = mirrorLead(store, leadRow());
  const id2 = mirrorLead(store, leadRow({ stage: "Contacted" }));
  assert.equal(id1, id2);
  assert.equal(store.query(null, { kind: "lead" }).length, 1);
  assert.equal(store.get(id1).version, 2);
  assert.equal(store.get(id1).category_path, "Pipeline/Contacted");
});

test("injected handlers register as code Thingas (no eval)", () => {
  const store = mountCrmSubstrate(new DatabaseSync(":memory:"), {
    handlers: { score: (t) => (t.content.arv > 50000 ? "hot" : "cold") },
  });
  const code = store.put({ kind: "code", code: { handler: "score" } });
  const lead = store.get(mirrorLead(store, leadRow()));
  // invoke the score handler against the lead's content via a code Thinga
  store.registerHandler("score_lead", (subject) => (subject.content.arv > 50000 ? "hot" : "cold"));
  const scriptLead = store.put({ kind: "lead", content: { arv: 90000 }, interaction_script:
    store.put({ kind: "code", code: { handler: "score_lead" } }) });
  assert.equal(store.invoke(scriptLead), "hot");
});

test("leadToThinga / leadCategoryPath are pure and stable", () => {
  const row = leadRow();
  assert.equal(leadCategoryPath(row), "Pipeline/New");
  assert.deepEqual(leadToThinga(row), leadToThinga(row));
});

// ---- iter 5: activities + emails as children/links of their lead ----

test("an activity mirrors to a child Thinga of its lead (containment via reverse index)", () => {
  const store = mountCrmSubstrate(new DatabaseSync(":memory:"));
  mirrorLead(store, leadRow());
  const aid = mirrorActivity(store, { id: 10, lead_id: 1, created_at: "2026-06-26T00:00:00Z", type: "call", body: "spoke to seller" });
  const t = store.get(aid);
  assert.equal(t.kind, "activity");
  assert.deepEqual(t.parents, [leadThingaId(1)]);
  // reverse-link index records the child_of edge
  const incoming = store.incomingLinks(leadThingaId(1), "child_of");
  assert.ok(incoming.some((l) => l.from_id === aid));
});

test("an inbound email threads to its lead as received_from; outbound as sent_to", () => {
  const store = mountCrmSubstrate(new DatabaseSync(":memory:"));
  mirrorLead(store, leadRow());
  const inb = store.get(mirrorEmail(store, { id: 1, lead_id: 1, direction: "in", subject: "re: offer", snippet: "ok", from_addr: "jane@x.com", to_addr: "me@x.com" }));
  const out = store.get(mirrorEmail(store, { id: 2, lead_id: 1, direction: "out", subject: "offer", snippet: "hi", from_addr: "me@x.com", to_addr: "jane@x.com" }));
  assert.equal(inb.kind, "message");
  assert.equal(inb.links[0].kind, "received_from");
  assert.equal(out.links[0].kind, "sent_to");
  assert.equal(inb.links[0].to, leadThingaId(1));
});

test("childrenOfLead returns the lead's activities and messages", () => {
  const store = mountCrmSubstrate(new DatabaseSync(":memory:"));
  mirrorLead(store, leadRow());
  mirrorActivity(store, { id: 10, lead_id: 1, created_at: "2026-06-26T00:00:00Z", type: "note", body: "n" });
  mirrorEmail(store, { id: 1, lead_id: 1, direction: "out", subject: "s", snippet: "x", from_addr: "me", to_addr: "jane" });
  const kids = childrenOfLead(store, 1);
  const kinds = kids.map((k) => k.kind).sort();
  assert.deepEqual(kinds, ["activity", "message"]);
});

test("an email with no lead_id mirrors without links (unthreaded)", () => {
  const store = mountCrmSubstrate(new DatabaseSync(":memory:"));
  const t = store.get(mirrorEmail(store, { id: 5, lead_id: null, direction: "in", subject: "spam", snippet: "" }));
  assert.deepEqual(t.links, []);
  assert.deepEqual(t.parents, []);
});

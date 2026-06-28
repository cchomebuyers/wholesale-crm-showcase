// crm_thinga.test.js — gate the CRM↔substrate bridge (the lead spec, enforced once).

import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { mountCrmSubstrate, mirrorLead, mirrorActivity, mirrorEmail, childrenOfLead,
  mirrorTask, mirrorNote, mirrorNotification, mirrorBuyer, mirrorTemplate, mirrorSetting,
  mirrorProperty, mirrorCampaign, mirrorPlan, isSensitiveSetting,
  leadToThinga, leadCategoryPath, leadThingaId, planThingaId } from "./crm_thinga.js";

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

// ---- iter 6: tasks + notes + notifications → kinds ----

test("a task mirrors to kind:task, a child of its lead, with a due_date", () => {
  const store = mountCrmSubstrate(new DatabaseSync(":memory:"));
  mirrorLead(store, leadRow());
  const t = store.get(mirrorTask(store, { id: 3, lead_id: 1, title: "Follow up", due_date: "2026-07-01", done: 0 }));
  assert.equal(t.kind, "task");
  assert.equal(t.due_date, "2026-07-01");
  assert.equal(t.category_path, "Tasks/Open");
  assert.deepEqual(t.parents, [leadThingaId(1)]);
  assert.ok(childrenOfLead(store, 1).some((c) => c.kind === "task"));
});

test("a done task lands under Tasks/Done; a lead-less task has no parent", () => {
  const store = mountCrmSubstrate(new DatabaseSync(":memory:"));
  assert.equal(store.get(mirrorTask(store, { id: 1, lead_id: null, title: "x", done: 1 })).category_path, "Tasks/Done");
  assert.deepEqual(store.get(mirrorTask(store, { id: 2, lead_id: null, title: "y", done: 0 })).parents, []);
});

test("a day-note mirrors to kind:note under Calendar/<day>, keyed by day", () => {
  const store = mountCrmSubstrate(new DatabaseSync(":memory:"));
  const t = store.get(mirrorNote(store, { day: "2026-06-26", body: "call backs" }));
  assert.equal(t.kind, "note");
  assert.equal(t.id, "thinga:note-2026-06-26");
  assert.equal(t.category_path, "Calendar/2026-06-26");
  assert.equal(t.due_date, "2026-06-26");
});

test("a notification mirrors to kind:notification, linked 'about' its property", () => {
  const store = mountCrmSubstrate(new DatabaseSync(":memory:"));
  const t = store.get(mirrorNotification(store, { id: 7, type: "hot", title: "🔥", body: "deal", property_id: 42, read: 0 }));
  assert.equal(t.kind, "notification");
  assert.equal(t.category_path, "Notifications/Unread");
  assert.deepEqual(t.links, [{ kind: "about", to: "thinga:property-42" }]);
  // reverse index lets the (future) property Thinga find what's about it
  assert.equal(store.incomingLinks("thinga:property-42", "about")[0].from_id, t.id);
});

// ---- iter 7: buyers + templates + settings → kinds ----

test("a buyer mirrors to kind:buyer with its buy-box and areas as tags", () => {
  const store = mountCrmSubstrate(new DatabaseSync(":memory:"));
  const t = store.get(mirrorBuyer(store, { id: 4, name: "Cash Co", phone: "313", email: "c@co.com", areas: "48235; 48224", property_types: "SFR", max_price: 80000, cash: 1 }));
  assert.equal(t.kind, "buyer");
  assert.equal(t.category_path, "Buyers");
  assert.deepEqual(t.tags, ["48235", "48224"]);
  assert.equal(t.content.max_price, 80000);
});

test("a template mirrors to kind:template, filed by audience", () => {
  const store = mountCrmSubstrate(new DatabaseSync(":memory:"));
  const t = store.get(mirrorTemplate(store, { id: 2, name: "Cold seller", subject: "Hi", body: "{{first_name}}", audience: "leads" }));
  assert.equal(t.kind, "template");
  assert.equal(t.category_path, "Templates/leads");
  assert.equal(t.content.body, "{{first_name}}");
});

test("non-secret settings mirror; secrets are skipped (never enter the substrate)", () => {
  const store = mountCrmSubstrate(new DatabaseSync(":memory:"));
  const ok = mirrorSetting(store, "buyer_pct", "70");
  assert.equal(store.get(ok).content.value, "70");
  // secrets return null and write nothing
  assert.equal(mirrorSetting(store, "gmail_app_password", "hunter2"), null);
  assert.equal(mirrorSetting(store, "rentcast_api_key", "sk-xyz"), null);
  assert.equal(mirrorSetting(store, "reso_token", "tok"), null);
  assert.equal(store.query(null, { kind: "setting" }).length, 1); // only buyer_pct
});

test("isSensitiveSetting flags passwords/keys/tokens/secrets", () => {
  for (const k of ["gmail_app_password", "rentcast_api_key", "anthropic_api_key", "reso_token", "client_secret"]) {
    assert.equal(isSensitiveSetting(k), true, k);
  }
  for (const k of ["buyer_pct", "rehab_per_sqft", "my_name", "email_footer"]) {
    assert.equal(isSensitiveSetting(k), false, k);
  }
});

// ---- iter 8: properties + campaigns → kinds (campaign = code Thinga) ----

test("a property mirrors to kind:property with scores, linked to campaign + imported lead", () => {
  const store = mountCrmSubstrate(new DatabaseSync(":memory:"));
  const t = store.get(mirrorProperty(store, { id: 9, formatted_address: "5 ELM", city: "Detroit", lead_score: 72, arv: 90000, mao: 45000, campaign_id: 3, imported_lead_id: 2, review_status: "New" }));
  assert.equal(t.kind, "property");
  assert.equal(t.category_path, "Acquisitions/New");
  assert.equal(t.content.lead_score, 72);
  const linkKinds = t.links.map((l) => l.kind).sort();
  assert.deepEqual(linkKinds, ["found_by", "imported_to"]);
  assert.equal(store.incomingLinks("thinga:lead-2", "imported_to")[0].from_id, t.id);
});

test("a campaign mirrors to a CODE Thinga with a run handler and recurrence when active", () => {
  const store = mountCrmSubstrate(new DatabaseSync(":memory:"));
  const t = store.get(mirrorCampaign(store, { id: 3, name: "Detroit SFR", active: 1, city: "Detroit", price_max: 60000 }));
  assert.equal(t.kind, "campaign");
  assert.equal(t.category_path, "Campaigns/Active");
  assert.deepEqual(t.code, { handler: "run_campaign" });
  assert.deepEqual(t.recurrence, { pattern: "daily" });
});

test("an inactive campaign is paused with no recurrence", () => {
  const store = mountCrmSubstrate(new DatabaseSync(":memory:"));
  const t = store.get(mirrorCampaign(store, { id: 4, name: "Paused", active: 0 }));
  assert.equal(t.category_path, "Campaigns/Paused");
  assert.equal(t.recurrence, null);
});

test("INVOKE on a campaign Thinga calls its registered run handler", () => {
  const store = mountCrmSubstrate(new DatabaseSync(":memory:"));
  let ran = null;
  store.registerHandler("run_campaign", (t) => { ran = t.content.crm_id; return { found: 7 }; });
  const id = mirrorCampaign(store, { id: 5, name: "Run me", active: 1 });
  assert.deepEqual(store.invoke(id), { found: 7 });
  assert.equal(ran, 5);
});

test("a search plan is a normal kind:plan Thinga and generated records can be its children", () => {
  const store = mountCrmSubstrate(new DatabaseSync(":memory:"));
  const pid = mirrorPlan(store, {
    id: "distress-contact",
    name: "Distress + public contact",
    includeSourceTypes: ["violations", "property", "public-contact"],
    costPolicy: "free_first",
  });
  const plan = store.get(pid);
  assert.equal(pid, planThingaId("distress-contact"));
  assert.equal(plan.kind, "plan");
  assert.equal(plan.schema, "ankhor.v1.plan");

  const child = store.put({
    id: "thinga:test-property",
    kind: "realEstate",
    schema: "realEstate.facets.v1",
    parents: [pid],
    content: { parser_family: "realEstate.faceted.v1", facets: { property: { address: "5 ELM" } } },
  });
  assert.equal(store.incomingLinks(pid, "child_of")[0].from_id, child);
});

// ankhor_bridge.test.js — CRM thinga → ankhor88 ThingaImportV2 mapping.
import { test } from "node:test";
import assert from "node:assert/strict";
import { crmThingaToImportV2Thinga, buildThingaImportV2, toAnkhorCategoryPath, CONTACT_FIELDS } from "./ankhor_bridge.js";

const LEAD_ROW = {
  id: "thinga:lead-1", kind: "lead", name: "123 TEST ST, Detroit, MI", version: 1,
  category_path: "Pipeline/New",
  content: JSON.stringify({ crm_id: 1, stage: "New", seller_phone: "3135550100", seller_email: "t@e.com", address: "123 TEST ST" }),
  axes: JSON.stringify({ tags: ["hot"], links: [{ to: "thinga:buyer-1" }], parents: [], children: [] }),
};
const PROP_ROW = {
  id: "thinga:property-9", kind: "property", name: "9 OAK AVE", version: 1,
  category_path: "Properties/Cook",
  content: JSON.stringify({ arv: 200000, owner_name: "Jane Doe" }),
  axes: JSON.stringify({ tags: [], links: [], parents: [], children: [] }),
};

test("category path converts to ankhor ' > ' form under CRM root", () => {
  assert.equal(toAnkhorCategoryPath("Pipeline/New"), "CRM > Pipeline > New");
  assert.equal(toAnkhorCategoryPath(null), "CRM > Uncategorized");
});

test("lead maps to a task with stage-derived status", () => {
  const t = crmThingaToImportV2Thinga(LEAD_ROW);
  assert.equal(t.$type, "task");
  assert.equal(t.title, "123 TEST ST, Detroit, MI");
  assert.equal(t.category_path, "CRM > Pipeline > New");
  assert.equal(t.facets.task.status, "pending");
});

test("non-lead maps to a note with lossless JSON payload", () => {
  const t = crmThingaToImportV2Thinga(PROP_ROW);
  assert.equal(t.$type, "note");
  const payload = JSON.parse(t.facets.note.content);
  assert.equal(payload.id, "thinga:property-9");
  assert.equal(payload.content.arv, 200000);
});

test("contacts are REDACTED by default (deny-until-checked posture)", () => {
  const t = crmThingaToImportV2Thinga(LEAD_ROW);
  const payload = JSON.parse(t.facets.note.content);
  assert.equal(payload.content.seller_phone, "[redacted:contact]");
  assert.equal(payload.content.seller_email, "[redacted:contact]");
  assert.equal(payload.content.address, "123 TEST ST"); // non-contact survives
});

test("withContacts:true preserves contacts for operator-side export", () => {
  const t = crmThingaToImportV2Thinga(LEAD_ROW, { withContacts: true });
  const payload = JSON.parse(t.facets.note.content);
  assert.equal(payload.content.seller_phone, "3135550100");
});

test("document shape matches ThingaImportV2 with derived + ancestor categories", () => {
  const doc = buildThingaImportV2([LEAD_ROW, PROP_ROW]);
  assert.equal(doc.$schema, "ThingaImportV2");
  assert.ok(Array.isArray(doc.categories) && Array.isArray(doc.thingas));
  assert.equal(doc.thingas.length, 2);
  const catNames = doc.categories.map((c) => (c.parent_path ? c.parent_path + " > " : "") + c.name);
  assert.ok(catNames.includes("CRM > Pipeline > New"));
  assert.ok(catNames.includes("CRM > Pipeline"), "ancestor created");
  assert.ok(catNames.includes("CRM"), "root created");
  assert.equal(doc.metadata.contacts_redacted, true);
});

test("settings thingas are never exported", () => {
  const doc = buildThingaImportV2([{ ...PROP_ROW, kind: "setting" }]);
  assert.equal(doc.thingas.length, 0);
});

test("links/tags survive in the payload (graph edges not lost)", () => {
  const t = crmThingaToImportV2Thinga(LEAD_ROW);
  const payload = JSON.parse(t.facets.note.content);
  assert.deepEqual(payload.tags, ["hot"]);
  assert.equal(payload.links[0].to, "thinga:buyer-1");
});

test("every contact field name is covered by redaction", () => {
  const content = Object.fromEntries(CONTACT_FIELDS.map((f) => [f, "x"]));
  const row = { ...PROP_ROW, content: JSON.stringify(content) };
  const payload = JSON.parse(crmThingaToImportV2Thinga(row).facets.note.content);
  for (const f of CONTACT_FIELDS) assert.equal(payload.content[f], "[redacted:contact]", f);
});

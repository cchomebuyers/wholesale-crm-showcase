// workspace_api.test.js — spec testing checklist, API half:
//   delete + restore a lead · deal cannot save without clause answer ·
//   buyer matching returns correct set on a known fixture · one-tap cadence.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import express from "express";
import { DatabaseSync } from "node:sqlite";
import { mountWorkspace } from "./workspace_api.mjs";

async function boot() {
  const dir = mkdtempSync(join(tmpdir(), "ws-test-"));
  const dbPath = join(dir, "crm.db");
  const db = new DatabaseSync(dbPath);
  db.exec(`
    CREATE TABLE leads (id INTEGER PRIMARY KEY AUTOINCREMENT, created_at TEXT, updated_at TEXT,
      stage TEXT DEFAULT 'New', seller_name TEXT, seller_phone TEXT, seller_email TEXT,
      address TEXT, city TEXT, state TEXT, zip TEXT, property_type TEXT, motivation TEXT,
      source TEXT, next_followup TEXT, asking_price REAL, arv REAL, repair_estimate REAL,
      assignment_fee REAL, offer_amount REAL, contract_price REAL, offer_sent_at TEXT, active INTEGER DEFAULT 1);
    CREATE TABLE activities (id INTEGER PRIMARY KEY AUTOINCREMENT, lead_id INTEGER, created_at TEXT, type TEXT, body TEXT);
    CREATE TABLE buyers (id INTEGER PRIMARY KEY AUTOINCREMENT, created_at TEXT, name TEXT, phone TEXT, email TEXT,
      areas TEXT, property_types TEXT, max_price REAL, cash INTEGER DEFAULT 1, notes TEXT);
    CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT);
  `);
  db.close();
  const app = express();
  app.use(express.json());
  mountWorkspace(app, { dbPath });
  const server = app.listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  const base = () => `http://127.0.0.1:${server.address().port}`;
  return { base, server, dbPath };
}
const j = (r) => r.json();

test("lead lifecycle: create → patch → soft-delete → trash → restore", async () => {
  const { base, server } = await boot();
  const { id } = await j(await fetch(`${base()}/api/ws/leads`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ address: "1 Test St", city: "Detroit" }) }));
  assert.ok(id);
  // dead requires revive date
  const dead = await fetch(`${base()}/api/ws/leads/${id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ stage: "Dead" }) });
  assert.equal(dead.status, 400, "killing a lead without a revive date is blocked");
  // soft delete + restore
  await fetch(`${base()}/api/ws/leads/${id}`, { method: "DELETE" });
  let leads = await j(await fetch(`${base()}/api/ws/leads`));
  assert.equal(leads.leads.length, 0, "deleted lead leaves the board");
  const trash = await j(await fetch(`${base()}/api/ws/trash`));
  assert.equal(trash.length, 1, "recoverable from trash");
  await fetch(`${base()}/api/ws/leads/${id}/restore`, { method: "POST" });
  leads = await j(await fetch(`${base()}/api/ws/leads`));
  assert.equal(leads.leads.length, 1, "restored");
  server.close();
});

test("deal cannot be saved without answering the assignment clause", async () => {
  const { base, server } = await boot();
  const { id } = await j(await fetch(`${base()}/api/ws/leads`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ address: "2 Deal St" }) }));
  const noAnswer = await fetch(`${base()}/api/ws/deals`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ lead_id: id, contract_price: 100000 }) });
  assert.equal(noAnswer.status, 400, "blocked without clause");
  const falseAnswer = await fetch(`${base()}/api/ws/deals`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ lead_id: id, assignment_clause_confirmed: false }) });
  assert.equal(falseAnswer.status, 400, "blocked when unconfirmed");
  const okr = await j(await fetch(`${base()}/api/ws/deals`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ lead_id: id, contract_price: 100000, assignment_fee_target: 10000, closing_date: "2026-08-01", assignment_clause_confirmed: true }) }));
  assert.ok(okr.ok);
  const deals = await j(await fetch(`${base()}/api/ws/deals`));
  assert.equal(deals.length, 1);
  assert.equal(deals[0].address, "2 Deal St");
  server.close();
});

test("buyer matching: known fixture returns correct ranked set", async () => {
  const { base, server } = await boot();
  const post = (path, body) => fetch(`${base()}${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const { id: leadId } = await j(await post("/api/ws/leads", { address: "3 Match Ave", city: "Detroit", seller_name: "M" }));
  await fetch(`${base()}/api/ws/leads/${leadId}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ property_type: "single_family" }) });
  // buyer A: matches everything, PoF + closed-before, high responsiveness → top
  await post("/api/ws/buyers", { name: "A", areas: "detroit", property_types: "single_family", max_price: 200000, pof: 1, closed_before: 1, responsiveness: 5 });
  // buyer B: matches, but low signals → ranked below A
  await post("/api/ws/buyers", { name: "B", areas: "detroit", max_price: 200000, responsiveness: 2 });
  // buyer C: price cap too low → excluded
  await post("/api/ws/buyers", { name: "C", areas: "detroit", max_price: 50000 });
  // buyer D: wrong area → excluded
  await post("/api/ws/buyers", { name: "D", areas: "cleveland", max_price: 500000 });
  const { id: dealId } = await j(await post("/api/ws/deals", { lead_id: leadId, contract_price: 90000, assignment_fee_target: 10000, assignment_clause_confirmed: true }));
  const matches = await j(await fetch(`${base()}/api/ws/deals/${dealId}/matches`));
  assert.deepEqual(matches.map((m) => m.name), ["A", "B"], "C (price) and D (area) excluded, A outranks B");
  assert.ok(matches[0].match.weight > matches[1].match.weight);
  const blast = await j(await post(`/api/ws/deals/${dealId}/blast`, {}));
  assert.equal(blast.blasted, 2, "blast logs an activity per matched buyer");
  server.close();
});

test("one-tap log reschedules by cadence and offer-made advances stage", async () => {
  const { base, server } = await boot();
  const post = (path, body) => fetch(`${base()}${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const { id } = await j(await post("/api/ws/leads", { address: "4 Cadence Ct" }));
  const r1 = await j(await post("/api/ws/log", { lead_id: id, type: "call_no_answer" }));
  assert.equal(r1.next_followup, new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10), "+2 days");
  const r2 = await j(await post("/api/ws/log", { lead_id: id, type: "offer_made" }));
  assert.equal(r2.next_followup, new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10), "+3 days");
  const leads = await j(await fetch(`${base()}/api/ws/leads`));
  assert.equal(leads.leads[0].stage, "Offer Made", "offer one-tap advances stage");
  // cadence editable via settings
  await fetch(`${base()}/api/ws/settings`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ cadence: { call_no_answer: 5 } }) });
  const r3 = await j(await post("/api/ws/log", { lead_id: id, type: "call_no_answer" }));
  assert.equal(r3.next_followup, new Date(Date.now() + 5 * 86400000).toISOString().slice(0, 10), "custom cadence respected");
  server.close();
});

test("analytics returns the four numbers + bySource", async () => {
  const { base, server } = await boot();
  const a = await j(await fetch(`${base()}/api/ws/analytics`));
  for (const k of ["contactedThisWeek", "offersMade", "underContract", "projectedFees", "bySource"]) assert.ok(k in a, k);
  server.close();
});

// focus-data.test.js — KPI math + task writes against a seeded temp db.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DatabaseSync } from "node:sqlite";
import { openFocusDb, loadGoals, cutoff9amET, todayStart } from "./focus-data.mjs";

function seedDb() {
  const dir = mkdtempSync(join(tmpdir(), "focus-test-"));
  const path = join(dir, "crm.db");
  const db = new DatabaseSync(path);
  db.exec(`
    CREATE TABLE leads (
      id INTEGER PRIMARY KEY AUTOINCREMENT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
      stage TEXT NOT NULL DEFAULT 'New', seller_name TEXT, address TEXT,
      assignment_fee REAL, fee_collected REAL, next_followup TEXT,
      offer_sent_at TEXT, active INTEGER DEFAULT 1
    );
    CREATE TABLE tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT, lead_id INTEGER, created_at TEXT NOT NULL,
      title TEXT NOT NULL, due_date TEXT, done INTEGER DEFAULT 0
    );
    CREATE TABLE activities (
      id INTEGER PRIMARY KEY AUTOINCREMENT, lead_id INTEGER NOT NULL, created_at TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'note', body TEXT
    );
    CREATE TABLE properties (
      id INTEGER PRIMARY KEY AUTOINCREMENT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
      address TEXT, formatted_address TEXT, city TEXT
    );
    CREATE TABLE call_outcomes (
      id INTEGER PRIMARY KEY AUTOINCREMENT, property_id INTEGER NOT NULL, created_at TEXT NOT NULL,
      outcome TEXT NOT NULL, next_action TEXT, seller_price REAL, offer_amount REAL,
      follow_up_date TEXT, outreach_suppressed INTEGER DEFAULT 0, notes TEXT
    );
  `);
  const now = new Date().toISOString();
  const yesterday = new Date(Date.now() - 2 * 86400000).toISOString();
  const today = todayStart();
  const lead = db.prepare(
    "INSERT INTO leads (created_at, updated_at, stage, seller_name, address, assignment_fee, next_followup, offer_sent_at, active) VALUES (?,?,?,?,?,?,?,?,?)");
  lead.run(now, now, "Contacted", "Ann", "1 Elm St", 10000, today, now, 1);        // today: new + offer + followup due
  lead.run(now, now, "New", "Bob", "2 Oak St", 5000, null, null, 1);               // today: new
  lead.run(yesterday, yesterday, "Offer", "Cal", "3 Pine St", 7500, null, null, 1); // old, still open
  lead.run(yesterday, yesterday, "Closed", "Dee", "4 Fir St", null, null, null, 1); // closed
  db.prepare("UPDATE leads SET fee_collected=4200 WHERE seller_name='Dee'").run();
  // stage advance today (counts) + lead-created marker (must NOT count)
  const act = db.prepare("INSERT INTO activities (lead_id, created_at, type, body) VALUES (?,?,?,?)");
  act.run(1, now, "stage_change", "Stage: New → Contacted");
  act.run(2, now, "stage_change", "Lead created — stage: New");
  // calls: one today, one old; call follow-up due today; a suppressed one that must not appear
  db.prepare("INSERT INTO properties (created_at, updated_at, address, city) VALUES (?,?,?,?)").run(now, now, "9 Maple St", "Detroit");
  db.prepare("INSERT INTO properties (created_at, updated_at, address, city) VALUES (?,?,?,?)").run(now, now, "11 Birch St", "Detroit");
  const co = db.prepare(
    "INSERT INTO call_outcomes (property_id, created_at, outcome, follow_up_date, outreach_suppressed) VALUES (?,?,?,?,?)");
  co.run(1, now, "no_answer", today, 0);
  co.run(2, yesterday, "interested", today, 1); // suppressed → excluded
  co.run(1, yesterday, "voicemail", null, 0);   // older outcome for prop 1 — latest (id 1? no, MAX id) decides
  db.close();
  return path;
}

test("computeKpis mirrors /api/stats semantics", () => {
  const store = openFocusDb(seedDb());
  const k = store.computeKpis(loadGoals());
  assert.equal(k.newLeads.done, 2);
  assert.equal(k.calls.done, 1);
  assert.equal(k.offers.done, 1);
  assert.equal(k.stageAdvances.done, 1); // 'Lead created' marker excluded
  assert.equal(k.pipelineFees, 22500);   // open leads only (Closed excluded)
  assert.equal(k.collectedFees, 4200);
  // follow-ups: 1 lead due + call follow-ups where the LATEST outcome per property has a due date
  const due = store.followupsDue();
  assert.equal(due.leads.length, 1);
  assert.ok(due.calls.every((c) => c.property_id !== 2), "suppressed property never appears");
  assert.equal(k.followups.remaining, due.leads.length + due.calls.length);
  store.close();
});

test("cutoff9amET is a valid ISO instant not after now", () => {
  const c = cutoff9amET();
  assert.ok(!Number.isNaN(Date.parse(c)));
  assert.ok(new Date(c) <= new Date());
});

test("task add / addOnce / toggle round-trip", () => {
  const store = openFocusDb(seedDb());
  const a = store.addTaskOnce("Call the next seller");
  assert.equal(a.skipped, false);
  const b = store.addTaskOnce("Call the next seller"); // exact-title dedupe while open
  assert.equal(b.skipped, true);
  assert.equal(b.id, a.id);
  assert.equal(store.listTasks().length, 1);
  store.toggleTask(a.id);
  assert.equal(store.listTasks().length, 0, "done tasks leave the open list");
  assert.equal(store.tasksDoneToday(), 1);
  const c = store.addTaskOnce("Call the next seller"); // done → no longer blocks re-adding
  assert.equal(c.skipped, false);
  store.close();
});

test("missing tables degrade to zeros, never throw", () => {
  const dir = mkdtempSync(join(tmpdir(), "focus-empty-"));
  const store = openFocusDb(join(dir, "crm.db")); // brand-new empty db, no tables
  const k = store.computeKpis(loadGoals());
  assert.equal(k.newLeads.done, 0);
  assert.equal(k.followups.remaining, 0);
  assert.deepEqual(store.listTasks(), []);
  store.close();
});

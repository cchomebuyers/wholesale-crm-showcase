// tools/seed_demo.mjs -- build a demo crm.db with fabricated data so a fresh
// clone boots into a populated app and the suite runs green without any real
// business data. Every name, phone, email, and address below is invented:
// phones use the 555 reserved range, emails use example.com, and street names
// are fictional. Nothing here touches a live API.
//
// Run: node tools/seed_demo.mjs [--fresh]   (--fresh deletes the db first)

import { spawn } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { mountCrmSubstrate, mirrorLead, mirrorBuyer, mirrorProperty } from "../crm_thinga.js";

const repo = join(dirname(fileURLToPath(import.meta.url)), "..");
const DB = process.env.CRM_DB || join(repo, "crm.db");
const fresh = process.argv.includes("--fresh");

const iso = (daysAgo = 0) =>
  new Date(Date.now() - daysAgo * 864e5).toISOString();

// Deterministic pseudo-random so the demo looks the same on every machine.
let seed = 42;
const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
const pick = (a) => a[Math.floor(rnd() * a.length)];
const between = (lo, hi) => Math.round(lo + rnd() * (hi - lo));

const STREETS = ["Larkspur", "Fenwick", "Ridgemont", "Halloway", "Sutter",
  "Ellingham", "Bramble", "Marchmont", "Kestrel", "Wexford", "Dunmore", "Ashgrove"];
const TYPES = ["Single Family", "Duplex", "Townhouse"];
const SOURCES = ["code-violations", "tax-delinquent", "absentee-owner", "driving-for-dollars", "cold-list"];
const MOTIVATIONS = ["inherited, wants out", "tired landlord", "relocating", "behind on taxes", "vacant since 2024"];
const STAGES = ["New", "Contacted", "Follow-Up", "Offer Made", "Under Contract", "Assigned", "Closed"];
const FIRST = ["Dana", "Marcus", "Priya", "Elena", "Terrence", "Nadia", "Owen", "Camille", "Victor", "Simone"];
const LAST = ["Whitfield", "Okonkwo", "Ramsey", "Delgado", "Fairbanks", "Nakamura", "Boyle", "Iverson"];

const addr = (i) => `${between(1000, 19999)} ${STREETS[i % STREETS.length]} ${pick(["St", "Ave", "Rd"])}`;
const person = () => `${pick(FIRST)} ${pick(LAST)}`;
const phone = () => `(313) 555-${String(between(1000, 9999)).padStart(4, "0")}`;
const email = (n) => `${n.split(" ")[0].toLowerCase()}.${n.split(" ")[1].toLowerCase()}@example.com`;

// 1. Let the server create the real schema, then shut it down.
async function ensureSchema() {
  if (fresh) for (const f of [DB, `${DB}-wal`, `${DB}-shm`]) if (existsSync(f)) rmSync(f);
  if (existsSync(DB)) return;
  const port = 4300 + (process.pid % 500); // avoid collisions with other local servers
  const child = spawn(process.execPath, [join(repo, "server.js")], {
    cwd: repo,
    env: { ...process.env, PORT: String(port), NO_BACKUP: "1" },
    stdio: "ignore",
  });
  try {
    const t0 = Date.now();
    while (Date.now() - t0 < 25000) {
      try {
        if ((await fetch(`http://127.0.0.1:${port}/api/health`)).ok) return;
      } catch { /* not up yet */ }
      await new Promise((r) => setTimeout(r, 300));
    }
    throw new Error("server did not boot, so the schema was never created");
  } finally {
    child.kill("SIGKILL");
  }
}

await ensureSchema();
const db = new DatabaseSync(DB);
const thinga = mountCrmSubstrate(db);

const count = (t) => db.prepare(`SELECT COUNT(*) c FROM ${t}`).get().c;
if (count("leads") > 0 && !fresh) {
  console.log("crm.db already has leads; pass --fresh to rebuild the demo.");
  process.exit(0);
}

// 2. Leads spread across the pipeline, a few closed with collected fees.
const insLead = db.prepare(`INSERT INTO leads
  (created_at, updated_at, stage, seller_name, seller_phone, seller_email,
   address, city, state, zip, property_type, beds, baths, sqft,
   asking_price, arv, repair_estimate, offer_amount, contract_price,
   assignment_fee, motivation, source, notes)
  VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);

for (let i = 0; i < 24; i++) {
  const name = person();
  const stage = i < 7 ? STAGES[i % 4] : pick(STAGES);
  const arv = between(85, 180) * 1000;
  const repairs = between(15, 55) * 1000;
  const offer = Math.round(arv * 0.7 - repairs);
  const closed = stage === "Closed";
  insLead.run(
    iso(between(2, 90)), iso(between(0, 2)), stage,
    name, phone(), email(name),
    addr(i), "Detroit", "MI", String(between(48201, 48239)),
    pick(TYPES), String(between(2, 5)), String(between(1, 3)), String(between(900, 2200)),
    between(40, 120) * 1000, arv, repairs,
    offer, closed ? offer : null,
    closed ? between(6, 14) * 1000 : between(5, 12) * 1000,
    pick(MOTIVATIONS), pick(SOURCES), "Demo record - fabricated data, not a real person.",
  );
}

// 3. Cash buyers.
const insBuyer = db.prepare(`INSERT INTO buyers
  (created_at, name, phone, email, areas, property_types, max_price, cash, notes)
  VALUES (?,?,?,?,?,?,?,?,?)`);
for (const b of ["Ironwood Property Group", "Fairhaven Rehab Co", "Northgate Holdings",
  "Bluecrest Ventures", "Sable & Finch Homes"]) {
  insBuyer.run(iso(between(10, 200)), b, phone(), `acquisitions@${b.split(" ")[0].toLowerCase()}.example.com`,
    "Detroit, Dearborn", "Single Family, Duplex", between(90, 260) * 1000, 1,
    "Demo record - fabricated company.");
}

// 4. Properties, which is what the pro-queue is built from.
const insProp = db.prepare(`INSERT INTO properties
  (addr_key, created_at, updated_at, last_seen, source, formatted_address, address,
   city, state, zip, county, latitude, longitude, property_type, bedrooms, bathrooms,
   square_footage, year_built, status, price, lead_score, motivation_score,
   distress_score, arv, repair_estimate, rent_estimate, review_status)
  VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);

for (let i = 0; i < 60; i++) {
  const a = addr(i + 3);
  const arv = between(70, 190) * 1000;
  insProp.run(
    `${a}|detroit|mi`.toLowerCase(), iso(between(1, 60)), iso(0), iso(0),
    pick(SOURCES), a, a, "Detroit", "MI", String(between(48201, 48239)), "Wayne County",
    42.33 + rnd() * 0.1, -83.05 - rnd() * 0.1,
    pick(TYPES), between(2, 5), between(1, 3), between(850, 2400), between(1915, 1975),
    "Active", between(35, 130) * 1000,
    between(35, 92), between(30, 90), between(25, 95),
    arv, between(12, 60) * 1000, between(800, 1700),
    pick(["New", "New", "Reviewed"]),
  );
}

// A fee only counts as collected at closing, so mark the closed deals paid and
// stamp the ones that got an offer out. Without this the demo shows a pipeline
// that never earns anything.
db.exec(`UPDATE leads SET fee_collected = assignment_fee,
           fee_collected_at = updated_at WHERE stage = 'Closed'`);
db.exec(`UPDATE leads SET offer_sent_at = updated_at
         WHERE stage IN ('Offer Made','Under Contract','Assigned','Closed')`);

// 5. Mirror the rows into the thinga substrate, the same way the API does on
// write. Seeding with raw SQL skips the app's write path, so without this the
// substrate-backed endpoints would serve an empty graph.
for (const r of db.prepare("SELECT * FROM leads").all()) mirrorLead(thinga, r);
for (const r of db.prepare("SELECT * FROM buyers").all()) mirrorBuyer(thinga, r);
for (const r of db.prepare("SELECT * FROM properties").all()) mirrorProperty(thinga, r);

console.log(`seeded: ${count("leads")} leads, ${count("buyers")} buyers, ${count("properties")} properties, ${count("thingas")} thingas`);
db.close();

// 5. Build the pro-queue from those properties so the queue endpoints answer 200.
await new Promise((resolve, reject) => {
  const p = spawn(process.execPath, [join(repo, "tools/build_pro_queue.mjs"), "--persist"], {
    cwd: repo,
    env: { ...process.env, PIPELINE_RUN: "1", CRM_DB: DB },
    stdio: "inherit",
  });
  p.on("exit", (c) => (c === 0 ? resolve() : reject(new Error(`build_pro_queue exited ${c}`))));
});

console.log("demo database ready. Start the app with: npm start");

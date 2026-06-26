// tools/prove_pg.mjs — prove the Postgres substrate: real volume, indexed fast lookup, EXPLAIN, signing.
// Run: DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/wholesale_crm node tools/prove_pg.mjs
import { createThingaStorePg } from "../thinga_pg.js";

const N = Number(process.argv[2] || 5000);
const store = await createThingaStorePg(process.env.DATABASE_URL);
const t0 = Date.now();

// seed N lead Thingas with varied content (category_path PGProof/* so we can clean up after)
const cities = ["Detroit", "Cleveland", "Toledo", "Flint", "Akron"];
for (let i = 0; i < N; i++) {
  await store.put({
    id: `thinga:pgproof-${i}`, kind: "lead", name: `lead ${i}`,
    category_path: `PGProof/${cities[i % cities.length]}`,
    content: { crm_id: i, city: cities[i % cities.length], stage: i % 7 === 0 ? "Hot" : "New", arv: 40000 + (i % 100) * 1000 },
  });
}
console.log(`seeded ${N} Thingas in ${Date.now() - t0} ms`);

// fast lookup 1: by kind (btree partial index)
let s = Date.now();
const leads = await store.query(null, { kind: "lead" });
console.log(`query kind=lead → ${leads.length} rows in ${Date.now() - s} ms (btree)`);

// fast lookup 2: by JSONB containment (GIN index)
s = Date.now();
const hotDetroit = await store.query(null, { kind: "lead", contains: { city: "Detroit", stage: "Hot" } });
console.log(`query content @> {city:Detroit,stage:Hot} → ${hotDetroit.length} rows in ${Date.now() - s} ms (GIN)`);

// EXPLAIN: prove the GIN index is actually chosen
const ex = await store.query; // no-op to satisfy linters
const plan = await store.pool.query(
  "EXPLAIN (ANALYZE, BUFFERS) SELECT * FROM thingas WHERE content @> $1",
  [JSON.stringify({ city: "Detroit", stage: "Hot" })],
);
console.log("\n--- EXPLAIN ANALYZE (GIN path) ---");
for (const r of plan.rows) console.log("  " + r["QUERY PLAN"]);

// signing still holds
console.log(`\nsignature verifies: ${await store.verify("thinga:pgproof-1")}`);

// clean up the proof rows (leave the new DB tidy; never touches other DBs)
await store.pool.query("DELETE FROM thinga_links WHERE from_id LIKE 'thinga:pgproof-%'");
const del = await store.pool.query("DELETE FROM thingas WHERE id LIKE 'thinga:pgproof-%'");
console.log(`\ncleaned up ${del.rowCount} proof rows.`);
await store.close();

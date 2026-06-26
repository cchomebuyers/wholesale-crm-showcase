// source_health.js — auto-run every data-source connector, test the response, and record EVERY metric
// to Postgres. Builds "a database of what APIs are good / which ones get leads" — no manual testing.
//
// Per run we capture: ok, lead count, leads-with-contact, latency, error + error class, the probe
// target, and a sample result. `health()` aggregates a full scoreboard (success rate, avg/min/max
// latency, totals, last status). All button-driven from the UI — nothing typed by hand.

import pg from "pg";

// A reasonable probe target per connector type (so nothing has to be typed).
function probeTarget(conn) {
  if (conn.type === "violations") return { days: 7 };
  if (conn.type === "comps") return { address: "13335 STRATHMOOR, Detroit, MI" };
  return { city: "Detroit", state: "MI", status: "Active" }; // listings
}

// Does a normalized lead carry a usable contact? (the "which ones actually get leads" signal)
function hasContact(o) {
  if (!o || typeof o !== "object") return false;
  return Boolean(o.phone || o.email || o.seller_phone || o.seller_email ||
    o.listing_agent_phone || o.listing_agent_email);
}

const errorKind = (msg) => {
  const m = String(msg || "").toLowerCase();
  if (m.includes("timed out")) return "timeout";
  if (m.includes("api key") || m.includes("token") || m.includes("401") || m.includes("subscription")) return "auth/quota";
  if (m.includes("429") || m.includes("rate limit")) return "rate_limit";
  if (m.includes("econn") || m.includes("network") || m.includes("fetch")) return "network";
  return msg ? "error" : null;
};

const withTimeout = (p, ms, label) =>
  Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(`${label} timed out after ${ms}ms`)), ms))]);

export function createSourceHealth(connectionString, getRegistry) {
  if (!connectionString) return null; // Postgres not configured → feature disabled
  const pool = new pg.Pool({ connectionString, max: 5 });

  async function init() {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS source_runs (
        id            BIGSERIAL PRIMARY KEY,
        source_id     TEXT NOT NULL,
        source_type   TEXT,
        region        TEXT,
        ok            BOOLEAN NOT NULL,
        leads         INTEGER NOT NULL DEFAULT 0,
        with_contact  INTEGER NOT NULL DEFAULT 0,
        latency_ms    INTEGER,
        error         TEXT,
        error_kind    TEXT,
        target        JSONB,
        sample        JSONB,
        ran_at        TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS idx_source_runs_src ON source_runs (source_id, ran_at DESC);
      CREATE INDEX IF NOT EXISTS idx_source_runs_ok  ON source_runs (ok, ran_at DESC);
    `);
  }

  // Run one connector for a target, record a fully-metriced row, return {summary, results}.
  async function runAndRecord(conn, target = probeTarget(conn)) {
    const started = Date.now();
    let ok = false, error = null, results = [];
    try {
      const result = await withTimeout(conn.search(target), 30000, conn.id);
      results = Array.isArray(result) ? result : (result ? [result] : []);
      ok = true;
    } catch (e) {
      error = String(e.message || e).slice(0, 400);
    }
    const latency_ms = Date.now() - started;
    const with_contact = results.filter(hasContact).length;
    const summary = {
      source_id: conn.id, source_type: conn.type, region: conn.region, ok,
      leads: results.length, with_contact, latency_ms, error, error_kind: errorKind(error),
      target, sample: results[0] || null,
    };
    await pool.query(
      `INSERT INTO source_runs (source_id, source_type, region, ok, leads, with_contact, latency_ms, error, error_kind, target, sample)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [summary.source_id, summary.source_type, summary.region, summary.ok, summary.leads, summary.with_contact,
       summary.latency_ms, summary.error, summary.error_kind, JSON.stringify(target), summary.sample ? JSON.stringify(summary.sample) : null],
    );
    return { summary, results };
  }

  // Probe = run with the default target; metrics only.
  const probeOne = async (conn) => (await runAndRecord(conn)).summary;
  async function probeAll() {
    const registry = getRegistry();
    const out = [];
    for (const conn of Object.values(registry)) out.push(await probeOne(conn));
    return out;
  }

  // The scoreboard — one row per source, every metric aggregated over all recorded runs.
  async function health() {
    const r = await pool.query(`
      SELECT source_id, source_type, region,
             COUNT(*)                                    AS runs,
             SUM(CASE WHEN ok THEN 1 ELSE 0 END)         AS successes,
             ROUND(100.0*SUM(CASE WHEN ok THEN 1 ELSE 0 END)/COUNT(*),0) AS success_rate,
             ROUND(AVG(latency_ms))                      AS avg_latency_ms,
             MIN(latency_ms)                             AS min_latency_ms,
             MAX(latency_ms)                             AS max_latency_ms,
             SUM(leads)                                  AS total_leads,
             SUM(with_contact)                           AS total_with_contact,
             MAX(ran_at)                                 AS last_ran,
             (ARRAY_AGG(ok           ORDER BY ran_at DESC))[1] AS last_ok,
             (ARRAY_AGG(leads        ORDER BY ran_at DESC))[1] AS last_leads,
             (ARRAY_AGG(with_contact ORDER BY ran_at DESC))[1] AS last_with_contact,
             (ARRAY_AGG(latency_ms   ORDER BY ran_at DESC))[1] AS last_latency_ms,
             (ARRAY_AGG(error        ORDER BY ran_at DESC))[1] AS last_error,
             (ARRAY_AGG(error_kind   ORDER BY ran_at DESC))[1] AS last_error_kind
      FROM source_runs
      GROUP BY source_id, source_type, region
      ORDER BY total_leads DESC, success_rate DESC
    `);
    return r.rows;
  }

  // Recent raw runs (for a detail/history view) — newest first.
  async function recent(limit = 50) {
    const r = await pool.query(
      "SELECT source_id, source_type, ok, leads, with_contact, latency_ms, error_kind, error, ran_at FROM source_runs ORDER BY ran_at DESC LIMIT $1",
      [Math.min(500, limit)],
    );
    return r.rows;
  }

  return { pool, init, probeOne, probeAll, runAndRecord, health, recent };
}

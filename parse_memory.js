// parse_memory.js — the memory unit the generic parser consults BEFORE parsing.
//
// The vision (dev/ankhor88-crm-compatibility.md, "memory unit"): when a parse
// is triggered, first check memory for "how did we parse this shape last
// time?"; only run detection when memory misses, then remember the outcome.
// This makes parser choice O(1) for every shape seen before, and makes the
// system's parsing knowledge inspectable data instead of code.
//
// A "shape" is the sorted set of field names — parsing is decided by shape,
// never by values, so no PII enters the memory. Detection scores a record's
// fields against every kind registered in parser_registry.js (fieldJoins
// keys are the schema's parseable surface).
//
// Storage: one small table. Pure logic split from I/O so it tests in-memory.

import { listKinds, fieldJoinsFor } from "./parser_registry.js";

// Stable, dependency-free signature of a record's SHAPE (field names only).
export function signatureOf(record) {
  const fields = Object.keys(record || {}).map((f) => f.toLowerCase().trim()).sort();
  let h = 5381;
  const s = fields.join("|");
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return "shape:" + (h >>> 0).toString(16) + ":" + fields.length;
}

// Score every registered kind by field overlap; best match wins.
// Returns { kind, score, matched } or null when nothing overlaps.
export function detectKind(record, kinds = listKinds()) {
  const fields = new Set(Object.keys(record || {}).map((f) => f.toLowerCase().trim()));
  let best = null;
  for (const kind of kinds) {
    const joins = fieldJoinsFor(kind);
    if (!joins) continue;
    const joinFields = Object.keys(joins).map((f) => f.toLowerCase());
    const matched = joinFields.filter((f) => fields.has(f));
    if (!matched.length) continue;
    // Coverage of the schema's joinable surface, weighted by absolute matches
    // so a 2-field toy schema can't beat a 7-field real match on ratio alone.
    const score = matched.length + matched.length / joinFields.length;
    if (!best || score > best.score) best = { kind, score, matched };
  }
  return best;
}

// The memory unit. `db` is a node:sqlite DatabaseSync (file or :memory:).
export function createParseMemory(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS parse_memory (
    signature TEXT PRIMARY KEY,
    kind TEXT NOT NULL,
    config_json TEXT,
    hits INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    last_used TEXT
  );`);

  const recallStmt = db.prepare("SELECT signature, kind, config_json, hits FROM parse_memory WHERE signature = ?");
  const touchStmt = db.prepare("UPDATE parse_memory SET hits = hits + 1, last_used = ? WHERE signature = ?");
  const insertStmt = db.prepare("INSERT OR REPLACE INTO parse_memory (signature, kind, config_json, hits, created_at, last_used) VALUES (?,?,?,COALESCE((SELECT hits FROM parse_memory WHERE signature = ?),0),?,?)");

  return {
    recall(signature) {
      const row = recallStmt.get(signature);
      if (!row) return null;
      touchStmt.run(new Date().toISOString(), signature);
      return { signature: row.signature, kind: row.kind, config: row.config_json ? JSON.parse(row.config_json) : null, hits: row.hits + 1 };
    },

    remember(signature, kind, config = null) {
      const now = new Date().toISOString();
      insertStmt.run(signature, kind, config ? JSON.stringify(config) : null, signature, now, now);
      return { signature, kind, config };
    },

    forget(signature) {
      db.prepare("DELETE FROM parse_memory WHERE signature = ?").run(signature);
    },

    // The button-click entry point: memory first, detection on miss, remember.
    // Returns { kind, source: "memory"|"detected"|null, signature, score? }.
    resolve(record, opts = {}) {
      const signature = signatureOf(record);
      const hit = this.recall(signature);
      if (hit) return { kind: hit.kind, source: "memory", signature, config: hit.config, hits: hit.hits };
      const det = detectKind(record, opts.kinds);
      if (!det) return { kind: null, source: null, signature };
      this.remember(signature, det.kind, { matched: det.matched });
      return { kind: det.kind, source: "detected", signature, score: det.score, matched: det.matched };
    },

    stats() {
      const rows = db.prepare("SELECT kind, COUNT(*) shapes, SUM(hits) hits FROM parse_memory GROUP BY kind ORDER BY hits DESC").all();
      return rows.map((r) => ({ kind: r.kind, shapes: r.shapes, hits: r.hits || 0 }));
    },
  };
}

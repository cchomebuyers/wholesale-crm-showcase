// dnc_records.js — persisted DNC/consent check results (audit P1 #2).
//
// compliance_gate.js is deny-by-default: a phone is not callable until a
// DNC/consent check says so. This module is where those verdicts LIVE once a
// check happens (federal/state DNC list lookup, provider API, or a documented
// manual check). A stored "clear" is what flips the queue's
// dnc_consent_missing blocker; "listed"/"refused" locks the number.
//
// Staleness: DNC lists churn — a clear older than MAX_AGE_DAYS no longer
// counts (treated as unchecked). Deny-by-default always wins on doubt.

export const DNC_STATUSES = ["clear", "listed", "refused", "unknown"];
export const MAX_AGE_DAYS = 30;

/** Normalize a phone to bare digits (US 10-digit; strips leading 1). */
export function normalizePhone(phone) {
  const d = String(phone || "").replace(/\D+/g, "");
  if (d.length === 11 && d.startsWith("1")) return d.slice(1);
  return d.length === 10 ? d : null;
}

export function createDncStore(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS dnc_records (
    phone TEXT PRIMARY KEY,
    status TEXT NOT NULL,
    source TEXT NOT NULL,
    channels_json TEXT,
    checked_at TEXT NOT NULL,
    notes TEXT
  );`);

  return {
    /** Store a check result. source = who verified (e.g. "federal-dnc",
     *  "provider:batchdata", "manual:operator"). channels = ["call","sms",...]. */
    record({ phone, status, source, channels = null, notes = null }) {
      const p = normalizePhone(phone);
      if (!p) return { ok: false, error: "phone must normalize to 10 digits" };
      if (!DNC_STATUSES.includes(status)) return { ok: false, error: `status must be one of ${DNC_STATUSES.join(", ")}` };
      if (!source || !String(source).trim()) return { ok: false, error: "source is required — an unattributed DNC verdict is worthless" };
      db.prepare(`INSERT INTO dnc_records (phone, status, source, channels_json, checked_at, notes)
        VALUES (?,?,?,?,?,?)
        ON CONFLICT(phone) DO UPDATE SET status=excluded.status, source=excluded.source,
          channels_json=excluded.channels_json, checked_at=excluded.checked_at, notes=excluded.notes`)
        .run(p, status, String(source).trim(), channels ? JSON.stringify(channels) : null, new Date().toISOString(), notes);
      return { ok: true, phone: p, status };
    },

    /** Look up the CURRENT verdict. A stale "clear" degrades to unchecked
     *  (null) — deny-by-default. "listed"/"refused" never expire. */
    lookup(phone, { maxAgeDays = MAX_AGE_DAYS, now = Date.now() } = {}) {
      const p = normalizePhone(phone);
      if (!p) return null;
      const row = db.prepare("SELECT * FROM dnc_records WHERE phone = ?").get(p);
      if (!row) return null;
      const ageDays = (now - Date.parse(row.checked_at)) / 864e5;
      const stale = ageDays > maxAgeDays;
      if (row.status === "clear" && stale) return { ...shape(row), stale: true, effective_status: null };
      return { ...shape(row), stale, effective_status: row.status };
    },

    /** Bulk map phone -> effective_status for queue hydration (one query). */
    statusMap({ maxAgeDays = MAX_AGE_DAYS, now = Date.now() } = {}) {
      const m = new Map();
      for (const row of db.prepare("SELECT phone, status, checked_at FROM dnc_records").all()) {
        const ageDays = (now - Date.parse(row.checked_at)) / 864e5;
        if (row.status === "clear" && ageDays > maxAgeDays) continue; // stale clear = unchecked
        m.set(row.phone, row.status);
      }
      return m;
    },

    stats() {
      return db.prepare("SELECT status, COUNT(*) n FROM dnc_records GROUP BY status").all();
    },
  };
}

function shape(row) {
  return {
    phone: row.phone, status: row.status, source: row.source,
    channels: row.channels_json ? JSON.parse(row.channels_json) : null,
    checked_at: row.checked_at, notes: row.notes || null,
  };
}

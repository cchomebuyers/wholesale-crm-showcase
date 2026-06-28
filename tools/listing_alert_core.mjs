import { normalizePropertyRecord } from "./property_harvest_core.mjs";

export function emptyCursor() {
  return { seen: {}, sources: {} };
}

export function listingIdentity(row = {}) {
  return String(row.source_id || row.addr_key || row.formatted_address || row.address || "").trim();
}

export function isNewListing(row = {}, cursor = {}, sourceId = row.source || "unknown") {
  const id = listingIdentity(row);
  if (!id) return false;
  const seen = new Set(cursor.seen?.[sourceId] || []);
  return !seen.has(id);
}

export function updateListingCursor(cursor = emptyCursor(), sourceId, rows = [], result = {}) {
  const next = {
    ...cursor,
    seen: { ...(cursor.seen || {}) },
    sources: { ...(cursor.sources || {}) },
  };
  const prior = new Set(next.seen[sourceId] || []);
  for (const row of rows) {
    const id = listingIdentity(row);
    if (id) prior.add(id);
  }
  next.seen[sourceId] = [...prior].slice(-10000);
  const old = next.sources[sourceId] || {};
  next.sources[sourceId] = {
    last_success_at: result.ok === false ? old.last_success_at || null : new Date().toISOString(),
    source_error_count: result.ok === false ? Number(old.source_error_count || 0) + 1 : 0,
    last_seen_listing_id: rows.map(listingIdentity).filter(Boolean).at(-1) || old.last_seen_listing_id || null,
    last_seen_modification_timestamp: newestTimestamp(rows) || old.last_seen_modification_timestamp || null,
  };
  return next;
}

export function newestTimestamp(rows = []) {
  const fields = ["modification_timestamp", "ModificationTimestamp", "updated_at", "updatedDate", "listed_date", "listedDate"];
  let newest = null;
  for (const r of rows) {
    for (const f of fields) {
      if (!r || !r[f]) continue;
      const t = Date.parse(r[f]);
      if (!Number.isFinite(t)) continue;
      if (newest == null || t > newest) newest = t;
    }
  }
  return newest == null ? null : new Date(newest).toISOString();
}

export function normalizeNewListings(rows = [], conn, cursor = {}, harvestedAt = new Date().toISOString()) {
  return rows
    .map((r) => normalizePropertyRecord(r, conn, harvestedAt))
    .filter(Boolean)
    .filter((r) => isNewListing(r, cursor, conn.id));
}

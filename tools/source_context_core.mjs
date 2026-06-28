export function inferStateFromSourceId(sourceId = "") {
  const m = String(sourceId).toLowerCase().match(/(?:^|-)([a-z]{2})(?:-|$)/);
  if (!m) return null;
  return m[1].toUpperCase();
}

export function buildSourceContext(rows = []) {
  const ctx = new Map();
  for (const row of rows) {
    const source = row.source_id || row.id;
    if (!source) continue;
    ctx.set(source, {
      state: row.state || inferStateFromSourceId(source),
      county: row.county || row.name || null,
      county_fips: row.county_fips || null,
      source_type: row.source_type || row.type || null,
      has_owner: Boolean(row.has_owner),
      has_owner_mailing: Boolean(row.has_owner_mailing || row.has_owner_mailing_address),
      legal_status: row.legal_status || "public_official_api",
    });
  }
  return ctx;
}

export function enrichPropertyContext(row = {}, context = new Map()) {
  const src = row.source || row.source_id;
  const meta = context.get(src) || {};
  const state = row.state || meta.state || inferStateFromSourceId(src);
  const county = row.county || meta.county || null;
  const enriched = {
    ...row,
    state: state || null,
    county,
    county_fips: row.county_fips || meta.county_fips || null,
    legal_status: row.legal_status || meta.legal_status || "public_official_api",
  };
  enriched.context_enrichment = {
    source_registry_match: Boolean(context.get(src)),
    filled_state: !row.state && Boolean(enriched.state),
    filled_county: !row.county && Boolean(enriched.county),
    owner_available_in_source: Boolean(meta.has_owner),
    owner_mailing_available_in_source: Boolean(meta.has_owner_mailing),
  };
  return enriched;
}

const clean = (v) => {
  if (v == null) return null;
  const s = String(v).trim();
  return s ? s : null;
};

const isHttpUrl = (v) => /^https?:\/\//i.test(String(v || ""));

export function displayAddress(row = {}) {
  return [
    clean(row.formatted_address) || clean(row.address),
    clean(row.city),
    clean(row.state),
    clean(row.zip),
  ].filter(Boolean).join(", ");
}

export function extractListingPhotoUrls(row = {}) {
  const urls = [];
  for (const field of ["photo_url", "image_url", "thumbnail_url", "primary_photo_url"]) {
    const v = clean(row[field]);
    if (isHttpUrl(v)) urls.push(v);
  }
  for (const field of ["photos", "photo_urls", "images", "media", "Media"]) {
    const v = row[field];
    if (Array.isArray(v)) {
      for (const item of v) {
        if (typeof item === "string" && isHttpUrl(item)) urls.push(item);
        if (item && typeof item === "object") {
          for (const key of ["url", "href", "MediaURL", "media_url", "thumbnail_url"]) {
            if (isHttpUrl(item[key])) urls.push(item[key]);
          }
        }
      }
    }
  }
  return [...new Set(urls)];
}

export function buildStreetViewUrl(row = {}, apiKey) {
  const address = displayAddress(row);
  if (!address || !clean(apiKey)) return null;
  const u = new URL("https://maps.googleapis.com/maps/api/streetview");
  u.searchParams.set("size", "640x400");
  u.searchParams.set("location", address);
  u.searchParams.set("return_error_code", "true");
  u.searchParams.set("key", apiKey);
  return u.toString();
}

export function createPhotoCandidates(row = {}, opts = {}) {
  const fetchedAt = opts.now || new Date().toISOString();
  const sourceId = clean(row.source_id) || clean(row.parcel_id) || clean(row.addr_key) || null;
  const candidates = [];

  for (const url of extractListingPhotoUrls(row)) {
    candidates.push({
      photo_url: url,
      photo_source: "listing_media",
      photo_license_note: opts.listingLicenseNote || "Listing media from licensed feed/provider; display/cache rights must come from source agreement.",
      photo_fetched_at: fetchedAt,
      cache_allowed: Boolean(opts.listingCacheAllowed),
      display_allowed: Boolean(opts.listingDisplayAllowed || row.photo_display_allowed),
      source_record_id: sourceId,
    });
  }

  const assessorUrl = clean(row.assessor_photo_url) || clean(row.county_photo_url);
  if (isHttpUrl(assessorUrl)) {
    candidates.push({
      photo_url: assessorUrl,
      photo_source: "county_assessor",
      photo_license_note: opts.assessorLicenseNote || "Official county assessor image URL; verify county display and caching terms before use.",
      photo_fetched_at: fetchedAt,
      cache_allowed: Boolean(opts.assessorCacheAllowed),
      display_allowed: Boolean(opts.assessorDisplayAllowed),
      source_record_id: sourceId,
    });
  }

  const streetViewUrl = buildStreetViewUrl(row, opts.googleStreetViewApiKey);
  if (streetViewUrl) {
    candidates.push({
      photo_url: streetViewUrl,
      photo_source: "google_street_view_static",
      photo_license_note: "Google Street View Static API URL only; do not cache, and display/use must follow Google Maps Platform terms.",
      photo_fetched_at: fetchedAt,
      cache_allowed: false,
      display_allowed: Boolean(opts.streetViewDisplayAllowed),
      source_record_id: sourceId,
    });
  }

  return candidates;
}

export function photoMetadataForProperty(row = {}, opts = {}) {
  const candidates = createPhotoCandidates(row, opts);
  const primary = candidates.find((c) => c.display_allowed) || candidates[0] || null;
  return {
    addr_key: row.addr_key || row.key || null,
    address: clean(row.formatted_address) || clean(row.address),
    source: clean(row.source),
    source_id: clean(row.source_id),
    generated_at: opts.now || new Date().toISOString(),
    has_photo_candidate: candidates.length > 0,
    primary_photo_url: primary?.photo_url || null,
    primary_photo_source: primary?.photo_source || null,
    candidates,
  };
}

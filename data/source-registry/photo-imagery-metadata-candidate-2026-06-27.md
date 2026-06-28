# Lawful Photo / Imagery Metadata Source Candidate — 2026-06-27

**Focus task:** Lawful photo/imagery metadata source candidate (one candidate track, bounded loop).
**Queue position:** Third focus item. Owner/tax-roll pilot LOCKED (Maricopa, iter 22); on-market feed candidate drafted (iter 33). This loop advances the remaining photo/imagery-metadata item.

## Why imagery *metadata* (not the image) is the lawful target

For wholesale lead triage we need a **freshness / provenance signal** — "how old is the structure as last officially imaged" — not a redistributable image asset. Capturing metadata only (capture date, source, parcel ref, license) keeps the layer lightweight and avoids redistributing MLS-governed or ToS-restricted imagery. Image bytes are NOT ingested into the CRM from governed sources; only public-record or public-domain imagery metadata is captured.

## Candidate A (primary): County Property Appraiser parcel / building photos — official public record

**Lawful basis:** In several states (notably FL under Ch. 119, and many TX / NC / GA appraiser offices) the property appraiser's parcel photograph taken for assessment purposes is a public record. Public parcel-search portals expose a per-parcel photo URL plus assessment year. This pairs directly with the locked owner/tax-roll appraiser path (same official .gov domain, same APN key) — no new access channel.

**Official URL / access path (patterns; verify per county before connector build):**
- Miami-Dade Property Appraiser: `https://www.miamidade.gov/pa/` (parcel search → photo)
- Hillsborough County Property Appraiser: `https://www.hcpafl.org/`
- Orange County Property Appraiser (FL): `https://www.ocpafl.org/`
- Access is per-parcel public search (no bulk imagery dump in most cases). For batch, file a public-records request to the appraiser's office for parcel-photo metadata (APN → photo URL → assessment_year).

**Metadata fields captured (this layer):**
- `apn` / `parcel_id` — join key to tax-roll
- `photo_url` — official appraiser-hosted; not re-hosted
- `photo_date` / `assessment_year` — freshness anchor
- `source_domain` — official .gov
- `license` — public_record (jurisdiction-specific; do not re-host beyond CRM-internal)

**Freshness field:** `photo_date` if published, else `assessment_year` (appraiser photo typically refreshed on reassessment cycle). Year-granular; record `last_fetched` per APN.

**Robots / terms note:** Honor robots.txt and county terms-of-use; prefer public parcel-search path and/or a public-records request over crawl; rate-limit; do not hot-link images in external-facing surfaces (CRM-internal reference only). Owner PII already gated per tax-roll policy.

**Rejection criteria (this candidate):**
- County terms prohibit CRM/wholesale reuse of the photo → do not store `photo_url`; metadata-only at most.
- No photo exposed (parcel search returns no image) → flag `photo_url:null`; do not fabricate.
- Source is a people-search/aggregator re-hosting appraiser photos → reject.
- No assessable freshness field (no `assessment_year` / `photo_date`) → reject as stale.

## Candidate B (secondary, metadata-only): USDA NAIP / USGS The National Map orthoimagery — public domain

**Lawful basis:** USDA NAIP and USGS orthoimagery are U.S. Government public-domain products; metadata (capture/acquisition date, tile URL, bbox) is freely redistributable.

**Official URL / access path:**
- USGS The National Map: `https://apps.nationalmap.gov/`
- NAIP via USDA/FSA or via USGS TNM services
- Access: bulk download + REST/WMS/WCS services with acquisition-date metadata.

**Metadata fields:** `acquisition_date` (freshness anchor), `tile_url`, `bbox`/lat-lon, `source`=NAIP/USGS, `license`=public_domain.

**Freshness field:** `acquisition_date` (NAIP is typically a 1–3 year cycle, state-dependent).

**Robots / terms note:** Public domain; no redistribution restriction; still rate-limit bulk downloads.

**Rejection criteria:** tile has no `acquisition_date` → reject; resolution too coarse to confirm structure presence → flag as ortho-only (no façade signal).

## Candidate C (governed metadata-only, gated): Google Street View Metadata API

**Lawful basis:** Street View **Metadata API** returns `pano_id` + capture `date` + lat/lng WITHOUT returning an image; metadata-only usage is governed by Google Maps Platform ToS. Image bytes (Street View Static API) require a separate ToS/branding review and are NOT ingested in this loop.

**Endpoint:** `https://maps.googleapis.com/maps/api/streetview/metadata?location={lat,lng}&key={API_KEY}` → `{pano_id, date, location, copyright, status}`.

**Metadata fields:** `pano_id`, `date` (YYYY-MM, freshness anchor), `lat/lng`, `copyright`, `status` (OK / ZERO_RESULTS).

**Freshness field:** `date` (street-level recency signal — complements the appraiser's year-granular photo).

**Robots / terms note:** Google Maps Platform ToS apply; API key required; metadata-only stored (`pano_id` + `date`) — no image bytes, no re-hosting. `status:ZERO_RESULTS` → `pano_id:null`.

**Rejection criteria:** ToS review blocks metadata storage → reject; `status:ZERO_RESULTS` (no coverage) → flag, not a hard reject; any plan to store image bytes without ToS sign-off → reject.

## Recommended pilot (next loop)
Lock ONE county property appraiser that (a) exposes parcel photo URLs via public search AND (b) publishes `assessment_year`, to pilot the imagery-metadata join (APN → `photo_url` → `photo_date`/`assessment_year`). Carry NAIP `acquisition_date` as a cross-check freshness layer for counties with no appraiser photo. Street View metadata-only remains gated pending ToS confirmation.

## Files / provenance
- This report: `data/source-registry/photo-imagery-metadata-candidate-2026-06-27.md`
- Reuses join key (APN) from: `data/source-registry/pilot-manifest-taxroll-maricopa-2026-06-27.md` — NOT re-inspected this loop (bounded).
- Inspected this loop: `data/source-registry/owner-taxroll-candidate-2026-06-27.md` (read in full to confirm APN join-key reuse + appraiser-path pairing).
- Intentionally skipped this loop (bounded): `data/source-registry/property-intelligence-status.md`.

## Exclusions
No scraping of Zillow/Redfin/Realtor/CoStar or people-search/aggregator imagery. No MLS photo ingestion (IDX-governed, out of scope for this lawful-discovery track).

# Lawful Photo / Imagery Metadata Source Candidate — NOAA NGS Emergency Response Imagery (2026-06-28)

**Focus task:** Lawful photo/imagery metadata source candidate (one new candidate track, bounded loop).
**Queue position:** Photo/imagery-metadata lane is the least-mature focus item (sidecar `with candidate: 0`, `gaps: 13933` per `data/source-registry/property-intelligence-status.md`). Existing lawful photo/imagery candidates cover county appraiser parcel photos (A), USDA NAIP/USGS TNM orthoimagery (B), and Google Street View metadata (C) — see `data/source-registry/photo-imagery-metadata-candidate-2026-06-27.md`. This loop adds a NEW official public-domain aerial-photography metadata candidate: **NOAA NGS Emergency Response Imagery**.

## Why this candidate (distress + freshness signal, metadata-only)

For wholesale lead triage, a **post-disaster aerial-photography freshness layer** yields two lawful signals from a single official public-domain source:
1. **Distress signal** — parcels in a NOAA storm-imagery event footprint that show structural damage in the captured imagery are a lawful motivated-seller indicator derived entirely from public records (no people-search, no purchased lists).
2. **Freshness anchor** — the official `capture_date` per image tiles the structure-as-last-officially-imaged vintage, complementing the year-granular appraiser photo (Candidate A) and the NAIP 1–3yr cycle (Candidate B).

Only **metadata** is captured into the CRM registry (event name, capture_date, image bbox/centroid, image_url on the official NOAA host, license). Image bytes are NOT re-hosted; the official NOAA URL is referenced (CRM-internal). This mirrors Candidate C's metadata-only discipline.

## Candidate D (new): NOAA National Geodetic Survey (NGS) Emergency Response Imagery — official public domain

**Lawful basis:** NOAA / NGS Remote Sensing Division aerial imagery is a work of the U.S. Government — public domain (17 U.S.C. §105). Freely redistributable; no reuse restriction. Captured post-hurricane / post-flood / post-wildfire events as an official federal emergency-response mission.

**Official URLs / provenance:**
- NOAA NGS Remote Sensing Division home: `https://ngs.noaa.gov/RSD/`
- Emergency Response Imagery archive (per-event): `https://storms.ngs.noaa.gov/`
- NOAA NGS storm imagery index (KML/GeoJSON per event): published alongside each event on `storms.ngs.noaa.gov`.

**Access path (official, public-domain; no scraping of Zillow/Redfin/CoStar/aggregators):**
- Per-event browse + bulk download of geo-referenced JPEGs directly from `storms.ngs.noaa.gov`.
- Per-event KML/GeoJSON spatial index (image footprint polygons + capture metadata) — use this as the bulk metadata path; resolve parcel centroids against the index to find intersecting images.
- No API key required (public domain). Rate-limit bulk downloads; cite NOAA/NGS.

**Metadata fields captured (this layer):**
- `event_name` — NOAA storm/event identifier (e.g., hurricane name + year)
- `capture_date` — official image capture date (freshness anchor; YYYY-MM-DD when published)
- `image_url` — official NOAA-hosted (not re-hosted)
- `image_bbox` / `centroid_lat,lng` — spatial join key to parcels
- `source_domain` — `storms.ngs.noaa.gov` (official .gov)
- `license` — `public_domain` (USG work)
- `damage_flag` — derived at triage time (not stored as raw image): `possible_damage` / `no_obvious_damage` / `not_imaged` (human-in-the-loop; not auto-stored)

**Freshness field:** `capture_date` (event-driven, post-disaster). Record `last_fetched` per event index pull. Pair with appraiser `assessment_year` (Candidate A) to bound structure vintage on both sides.

**Join to existing pilots:** Spatial join on parcel centroid (lat/lng) from the 8 verified county tax-roll pilots — strongest fit for the FL pilots (Miami-Dade FL, Hillsborough FL) which sit in the Atlantic/Gulf storm-imagery footprint. APN → parcel centroid → intersecting NOAA image → `capture_date` + `damage_flag`.

**Robots / terms note:** Public domain (USG work); honor `robots.txt` and rate-limit bulk downloads; cite NOAA/NGS as source. Do not re-host image bytes on external-facing surfaces (CRM-internal reference via official URL). No scraping of commercial weather/aggregator imagery.

**Rejection criteria (this candidate):**
- Event index has no per-image `capture_date` → reject as stale/unfresh.
- Image footprint falls outside a pilot county → drop (out of scope for this pilot).
- Resolution insufficient to assess structural damage at parcel scale → flag `damage_flag:not_imaged`; keep `capture_date` metadata only.
- Source re-hosted by a non-NOAA aggregator → reject; pull from `storms.ngs.noaa.gov` directly.
- Only pre-event / non-event imagery available for a county → retain freshness metadata, set `damage_flag:null`.

## Recommended pilot (next loop)
Lock ONE FL pilot county already in the tax-roll manifest set (Hillsborough FL or Miami-Dade FL) that intersects a recent NOAA NGS storm event; pull the event GeoJSON index, spatial-join parcel centroids, and capture `capture_date` + `image_url` + `damage_flag` metadata for a sample APN set. No image bytes ingested. This advances the photo/imagery-metadata lane toward the same connector-ready bar as the owner/tax-roll lane (8 manifests) and the on-market lane (RESO/HUD/USDA/GSA pilots).

## Files / provenance
- This report: `data/source-registry/photo-imagery-metadata-candidate-noaa-ngs-2026-06-28.md`
- Inspected this loop: `data/source-registry/photo-imagery-metadata-candidate-2026-06-27.md` (read in full to confirm Candidates A/B/C and that NOAA NGS is a new, non-duplicate track).
- Join-key provenance (not re-inspected this loop): the 8 county tax-roll pilot manifests listed in `data/source-registry/owner-taxroll-candidate-2026-06-27.md` (parcel centroid = lat/lng).
- Intentionally skipped this loop (bounded): `data/source-registry/property-intelligence-status.md` (tool-generated snapshot; queue context already captured in loop 160 STATUS entry).

## Exclusions
No scraping of Zillow/Redfin/Realtor/CoStar or people-search/aggregator imagery. No MLS photo ingestion (IDX-governed, out of scope). Official/public `.gov` sources only; metadata-only (no governed image bytes ingested); owner PII gated; B2B files preserved; no hostile scraping.

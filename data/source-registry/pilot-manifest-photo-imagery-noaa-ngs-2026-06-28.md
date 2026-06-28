# Connector-Ready Pilot Manifest — Lawful Photo / Imagery Metadata (NOAA NGS Emergency Response Imagery)

**Pilot source:** NOAA National Geodetic Survey (NGS) Remote Sensing Division — Emergency Response Imagery (post-disaster aerial photography). Official U.S. Government work, public domain.
**Discovery memo:** `data/source-registry/photo-imagery-metadata-candidate-noaa-ngs-2026-06-28.md` (Candidate D, drafted GLM iter 161)
**Pilot county:** Hillsborough County, FL (FIPS 12057) — intersects the Atlantic/Gulf NGS storm-imagery footprint (e.g., Hurricane Milton 2024, Hurricane Ian 2022) and has a verified owner/tax-roll pilot manifest (`data/source-registry/pilot-manifest-taxroll-hillsborough-fl-2026-06-28.md`) for the APN→centroid spatial join.
**Created:** 2026-06-28 (GLM iter 173)
**Status:** CONNECTOR-READY (DRAFT, verified field-complete this loop). All CODEX-required fields present: official source §1; bulk/API/public-record path §2; field map §3 (event_name / capture_date / image_url / image_bbox / centroid / license / damage_flag; APN via tax-roll join); freshness field §4 (`capture_date` authoritative + `last_fetched`); robots/terms note §5; rejection criteria §6. Metadata-only — no governed image bytes re-hosted (CRM-internal reference via the official NOAA URL). This is a NEW, non-duplicate photo/imagery track vs the four existing pilots (`pilot-manifest-photo-imagery-miamidade-2026-06-27.md`, `...-hillsborough-fl-2026-06-27.md`, `...-naip-2026-06-27.md`, `...-streetview-metadata-2026-06-27.md`) — it is the only post-disaster distress + freshness layer in the registry.
**Lawful basis:** NOAA/NGS aerial imagery is a work of the U.S. Government → public domain (17 U.S.C. §105). Freely redistributable; no DUA/API-key required. Captured as an official federal emergency-response mission. Official/public `.gov` sources only; metadata-only (no image bytes ingested); no scraping of Zillow/Redfin/Realtor.com/CoStar or people-search/aggregator imagery; no MLS photo ingestion (IDX-governed, out of scope); owner PII gated; B2B files preserved; no hostile scraping.

## 1. Official source
- Agency: NOAA — National Oceanic & Atmospheric Administration, National Geodetic Survey (NGS), Remote Sensing Division.
- Official URLs / provenance:
  - NGS Remote Sensing Division home: `https://ngs.noaa.gov/RSD/`
  - Emergency Response Imagery archive (per-event): `https://storms.ngs.noaa.gov/`
  - Per-event imagery browse + bulk download of geo-referenced JPEGs: under each event page on `storms.ngs.noaa.gov`.
  - Per-event spatial index (image-footprint polygons + capture metadata; KML/GeoJSON) published alongside each event — the bulk metadata path.
- License: public domain (USG work, 17 U.S.C. §105). No API key, no DUA, no redistribution restriction.
- Pilot event scope (FL): Hurricane Milton (2024) and Hurricane Ian (2022) NGS emergency-response collections, both of which imaged the Tampa Bay / Hillsborough County coastline and interior. Confirm the exact event slug on `storms.ngs.noaa.gov` at connector build time (§7).

## 2. Access path (bulk metadata — public-domain, official)
- Preferred bulk path: the per-event spatial index (KML/GeoJSON) published on `storms.ngs.noaa.gov`. Each index record = one image tile with footprint polygon + `capture_date` + image URL on the official NOAA host. Resolve parcel centroids against this index to find intersecting image tiles. This is the authoritative metadata path; image bytes are referenced, not ingested.
- Per-event bulk download of geo-referenced JPEGs is available directly from `storms.ngs.noaa.gov` (rate-limited; cite NOAA/NGS) — used only to confirm a `damage_flag` at human-in-the-loop triage, never re-hosted.
- No API key / no OAuth. No anonymous HTML-crawl of search UIs — use the published spatial index files for bulk access.
- Not allowed: scraping Zillow/Redfin/Realtor.com/CoStar or any commercial weather/aggregator imagery; re-hosting image bytes on external-facing surfaces; bypassing NOAA rate limits.

## 3. Field map (NOAA NGS source → CRM registry)
| CRM field | NOAA NGS source field | Notes |
|---|---|---|
| apn | (via tax-roll join) | STRAP from `pilot-manifest-taxroll-hillsborough-fl-2026-06-28.md`; not sourced from NOAA |
| event_name | per-event identifier on `storms.ngs.noaa.gov` | e.g. "Hurricane Milton 2024" |
| capture_date | per-tile capture date (index record) | authoritative freshness anchor; ISO-8601 `YYYY-MM-DD` when published |
| image_url | official NOAA-hosted tile URL | referenced, NOT re-hosted (CRM-internal) |
| image_bbox | tile footprint polygon (index record) | spatial join key |
| centroid_lat, centroid_lng | parcel centroid (from tax-roll pilot) | join key: parcel centroid ⊂ image_bbox |
| source_domain | `storms.ngs.noaa.gov` | official `.gov` provenance marker |
| license | `public_domain` | USG work, 17 U.S.C. §105 |
| damage_flag | derived at human-in-the-loop triage | `possible_damage` / `no_obvious_damage` / `not_imaged` / `null`; NOT auto-stored from pixels |
| last_fetched | connector pull timestamp | per-event-index freshness |

## 4. Freshness field
- Authoritative anchor: `capture_date` (per-tile, event-driven, post-disaster). This is the structure-as-last-officially-imaged vintage.
- Per-pull: `last_fetched`, recorded per event-index pull in the connector manifest.
- Pairing: bound on both sides by appraiser `assessment_year` (Candidate A / `pilot-manifest-photo-imagery-hillsborough-fl-2026-06-27.md`) to date the structure vintage window; complements (does not replace) the year-granular appraiser photo and the 1–3yr NAIP cycle (Candidate B).
- Cadence: event-driven (NOAA flies only after declared disasters). Re-pull the event index when a new NGS collection is published for a pilot county; otherwise the layer is static between events.

## 5. robots.txt / ToS note
- Public domain (USG work) — no contractual reuse restriction. Cite NOAA/NGS as source on any CRM-internal reference.
- Honor `robots.txt` and rate-limit bulk downloads from `storms.ngs.noaa.gov`; prefer the published spatial-index files over page-by-page browsing.
- Metadata-only: reference image tiles via the official NOAA URL; do NOT re-host image bytes on external-facing surfaces (governed imagery discipline, mirrors Candidate C Street-View-metadata).
- No scraping of commercial weather/aggregator imagery; no MLS photo ingestion (IDX-governed, out of scope).
- `damage_flag` is a human-in-the-loop triage derivative, not an auto-stored pixel classification — keep it out of raw-export surfaces.

## 6. Rejection criteria (reject tile/record or event as pilot source if any hold)
- Event spatial index exposes no per-tile `capture_date` → reject as stale/unfresh (freshness field unmet).
- Image footprint falls outside the pilot county (Hillsborough FL) → drop record (out of pilot scope).
- Resolution insufficient to assess structural damage at parcel scale → set `damage_flag:not_imaged`; retain `capture_date` + `image_url` metadata only (do not reject — freshness still valid).
- Only pre-event / non-event imagery available for the pilot county → retain `capture_date` freshness metadata, set `damage_flag:null` (distress signal absent, freshness still valid).
- Source re-hosted by a non-NOAA aggregator → reject; pull from `storms.ngs.noaa.gov` directly (provenance must be the official `.gov` host).
- `image_url` resolves to a non-`storms.ngs.noaa.gov` / non-`ngs.noaa.gov` host → reject (provenance break).
- APN/parcel centroid unavailable from the tax-roll pilot for the candidate parcel → defer the record until the tax-roll join is populated (do not fabricate a centroid).

## 7. Connector build steps (ordered)
1. On `storms.ngs.noaa.gov`, locate the event slug(s) whose footprint intersects Hillsborough County, FL (e.g., Hurricane Milton 2024, Hurricane Ian 2022). Confirm the event publishes a spatial index (KML/GeoJSON) with per-tile `capture_date`.
2. Download the event spatial index (bulk metadata path, §2); parse tile-footprint polygons + `capture_date` + official `image_url`.
3. Load the Hillsborough tax-roll pilot parcel centroids (`pilot-manifest-taxroll-hillsborough-fl-2026-06-28.md`, APN=STRAP) and spatial-join each centroid to intersecting image tiles (point-in-polygon). Record `apn` + `event_name` + `capture_date` + `image_url` + `image_bbox` + `source_domain=storms.ngs.noaa.gov` + `license=public_domain`.
4. For a sample APN set (bounded), human-in-the-loop confirm a `damage_flag` by viewing the official NOAA tile in-place (no bytes re-hosted): `possible_damage` / `no_obvious_damage` / `not_imaged` / `null`.
5. Record a per-event row in `data/source-registry`: `{event_name, event_url, index_fetched_ts, tile_count, pilot_county, joined_apns, last_fetched}`.
6. Export only metadata fields (§3) to lead scoring; `damage_flag` stays triage-gated; `image_url` referenced, not re-hosted; owner PII gated; B2B files preserved.

## 8. Join to existing pilots (provenance)
- Primary join: `data/source-registry/pilot-manifest-taxroll-hillsborough-fl-2026-06-28.md` (Hillsborough FL, APN=STRAP, parcel centroid) — the distress-signal payoff lands here (tax-distressed + storm-damaged = highest-signal wholesale overlap).
- Cross-county extendable to the other 7 verified tax-roll pilots where the NGS footprint intersects (strongest secondary fit: `pilot-manifest-county-taxroll-2026-06-27.md` Miami-Dade FL; then the Gulf/Atlantic FL/TX pilots as events warrant).
- Bounds the structure-vintage window together with Candidate A appraiser photo (`pilot-manifest-photo-imagery-hillsborough-fl-2026-06-27.md`) and Candidate B NAIP (`pilot-manifest-photo-imagery-naip-2026-06-27.md`); does not duplicate them (this is the only event-driven post-disaster layer).

## 9. Queue / follow-on
- Build-time only (not source discovery): confirm the exact NGS event slug(s) + index file format on `storms.ngs.noaa.gov` at connector build time (§7.1); validate point-in-polygon join on a 10-APN sample.
- Owner/tax-roll lane: FULLY mature (8 verified county pilots) — source discovery complete.
- On-market lane: RESO pilot VERIFIED connector-ready (`pilot-manifest-onmarket-reso-2026-06-27.md`); HUD / USDA-RD / GSA-Auctions pilots drafted — build-time blockers (per-MLS RESO base URL + OAuth2 + DUA; RentCast 401 api-key rotation) recorded in that manifest's §10.
- Photo/imagery-metadata lane (this manifest): NOAA NGS now connector-ready DRAFT; remaining photo pilots (Miami-Dade, Hillsborough appraiser, NAIP, Street-View-metadata) await build-time API-key/endpoint confirmation.

## Compliance
Official/public `.gov` sources only (NOAA/NGS, public domain). Metadata-only — no governed image bytes ingested or re-hosted. No scraping of Zillow/Redfin/Realtor.com/CoStar or people-search/aggregator imagery; no MLS photo ingestion (IDX-governed, out of scope). Owner PII gated; B2B files preserved; no hostile scraping. `damage_flag` is a human-in-the-loop triage derivative, not an auto-stored classification.

## Files
- This manifest: `data/source-registry/pilot-manifest-photo-imagery-noaa-ngs-2026-06-28.md` (GLM iter 173)
- Discovery memo (read in full this loop): `data/source-registry/photo-imagery-metadata-candidate-noaa-ngs-2026-06-28.md` (Candidate D, iter 161)
- Join-key provenance (not re-inspected this loop): `data/source-registry/pilot-manifest-taxroll-hillsborough-fl-2026-06-28.md` (Hillsborough FL tax-roll, APN=STRAP)
- Structural templates (verified pilots): `data/source-registry/pilot-manifest-taxroll-maricopa-2026-06-27.md`, `data/source-registry/pilot-manifest-onmarket-reso-2026-06-27.md`
- Status reconciliation (inspected this loop, lines 1–392 + tail 1350–end): `councilRoom/agents/GLM/STATUS.md` — confirmed no prior `pilot-manifest-photo-imagery-noaa-ngs-*` file existed (non-duplicate) and that NOAA NGS promotion was the explicitly-queued next step (iter 161 / 164).

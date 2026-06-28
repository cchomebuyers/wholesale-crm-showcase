# Connector-Ready Pilot Manifest — Lawful Photo / Imagery Metadata Source (Google Street View Metadata API)

**Pilot source:** Google Street View **Metadata** API (Google Maps Platform) — official, API-key-gated, **metadata-only** (pano_id + capture date). Image bytes are NOT ingested into the CRM from this source.
**Discovery memo:** `data/source-registry/photo-imagery-metadata-candidate-2026-06-27.md` (Candidate C)
**Created:** 2026-06-27 (GLM iter 115)
**Status:** DRAFT CONNECTOR-READY (GLM iter 115). Metadata-only freshness layer (street-level pano capture date / provenance); no Street View image bytes are stored or redistributed.
**Why this loop:** The photo gap is the only open *discovery* lane. `data/source-registry/property-intelligence-status.md` reports "photo candidates JSONL: 13933 rows, with candidate: 0, gaps: 13933" and lists as a Current Blocker: "photo sidecar is gap-only until lawful media sources or a **Street View key** are configured." The Miami-Dade appraiser façade pilot (`pilot-manifest-photo-imagery-miamidade-2026-06-27.md`, VERIFIED iter 46) covers ONE county; the NAIP ortho pilot (`pilot-manifest-photo-imagery-naip-2026-06-27.md`, DRAFT iter 109) gives a coarse national "imaged date" but not a street-level façade capture date. Street View Metadata is the missing **national street-level** freshness layer — it returns a `date` (YYYY-MM) + `pano_id` for a parcel centroid wherever a public outdoor panorama exists. This manifest closes the source-discovery side of the "Street View key" blocker; provisioning the key itself is build-time.
**Lawful basis:** Official, sanctioned Google Maps Platform API accessed with a provisioned API key under the Google Maps Platform Terms of Service. Not scraping; no Zillow/Redfin/Realtor.com/CoStar; no people-search/aggregator imagery; no MLS/IDX image ingestion. Metadata (pano_id + capture date) is stored as a freshness/provenance signal; Street View **image bytes** are never ingested or redistributed. Owner/agent PII stays gated; B2B files preserved.

## 1. Official source
- Provider: Google — Google Maps Platform, Street View Static API family (Metadata endpoint).
- Metadata endpoint (official): `https://maps.googleapis.com/maps/api/streetview/metadata`
  - Parameters: `location=LAT,LNG` (or `pano=PANO_ID`), `radius=50` (meters, search tolerance), `source=outdoor` (prefer outdoor panoramas; avoids indoor business photos), `key=API_KEY`.
  - Response (JSON): `status` (`OK` | `ZERO_RESULTS` | `OVER_QUERY_LIMIT` | `REQUEST_DENIED` | `INVALID_REQUEST`), `pano_id`, `date` (YYYY-MM, pano capture date), `location` (lat/lng), `copyright`.
- Console / key provisioning (official): `https://console.cloud.google.com/google/maps-apis` — enable "Street View API" on a Maps Platform project; API key + billing account required.
- ToS (official): `https://cloud.google.com/maps-platform/terms` and Street View-specific guidelines (`https://developers.google.com/maps/documentation/streetview/policies`).
- Provenance: official Google Maps Platform; metadata derived from the API response is stored as a freshness signal per the Maps Platform ToS. Reuses the APN ↔ situs ↔ lat/lng join key established by the tax-roll + Miami-Dade photo pilots — no new access channel, only a new (national street-level) freshness layer.

## 2. Access path (API-key gated, metadata-only)
- Per-parcel point query: `GET https://maps.googleapis.com/maps/api/streetview/metadata?location={lat},{lng}&radius=50&source=outdoor&key={API_KEY}` → JSON `{status, pano_id, date, location, copyright}`. Capture `pano_id` + `date` only (metadata); do NOT call the Street View Static **image** endpoint for byte ingestion.
- Auth: valid Google Maps Platform API key with the Street View API enabled + an active billing account. Store the key in the connector secret store; never commit it.
- Rate-limit / quota: honor per-second and per-day quota (Maps Platform rate limits + usage billing); exponential backoff on `OVER_QUERY_LIMIT`; no concurrent bursts. Batch the 13,933-row gap over scheduled runs, not a single burst.
- Allowed: storing `pano_id` + `date` + `location` + `copyright` provenance as a freshness signal keyed by APN.
- Not allowed: ingesting/caching Street View image bytes into a redistributable CRM image store; bulk-redistributing API-derived content beyond ToS; bypassing quota; presenting the metadata as a stored photo (it is a capture-date freshness signal; the image itself is fetched on-demand from Google under ToS, if at all).

## 3. Field map (source → CRM, **metadata only**)
| CRM field | Source field (expected) | Notes |
|---|---|---|
| apn / parcel_id | (join via parcel lat/lng → pano location) | join key to tax-roll + Miami-Dade/NAIP photo pilots |
| lat / lng | Parcel centroid / situs geo | geo key sent to the metadata endpoint |
| pano_id | `pano_id` | provenance; references the panorama (image bytes NOT stored) |
| capture_date | `date` (YYYY-MM) | freshness anchor (primary) — street-level pano capture date |
| pano_location | `location` (lat/lng) | actual pano position (may differ from parcel centroid within radius) |
| source | `google_streetview_metadata` | official provenance |
| license | `google_maps_platform_tos` | ToS-governed; image bytes not redistributed |
| status_flag | `status` (`OK` / `ZERO_RESULTS`) | `ZERO_RESULTS` = no public pano within radius (rural/gap) |
| (aux) last_fetched | connector pull timestamp | per-APN freshness |

## 4. Freshness field
- Authoritative anchor: `capture_date` = API `date` field (YYYY-MM, the panorama capture date). Street-level façade granularity — distinguishes from NAIP `acquisition_date` (ortho, coarse) and Miami-Dade `photo_date` (county appraiser façade, single county).
- Per-pull: `last_fetched`, recorded per APN in the connector manifest.
- Cadence: re-query the metadata endpoint on a scheduled cycle (e.g., quarterly) for parcels with `status=OK`; treat a stale `capture_date` as a freshness flag, not an auto-reject. Panorama coverage and re-shoot cadence vary by area (urban re-shot frequently; rural rarely or never).
- `ZERO_RESULTS` flag: no public pano within `radius` → no street-level freshness signal for that APN; fall back to NAIP `acquisition_date` (ortho) where available. Not a source reject.

## 5. robots.txt / ToS note
- Source is an official, key-gated Google Maps Platform API — not a scraped web page; `robots.txt` does not govern API access (API ToS does). Still: no scraping of Google Maps UI / Street View embeds; use the documented Metadata endpoint only.
- **Metadata-only scope**: store `pano_id` + `capture_date` + `pano_location` + `copyright` as a freshness/provenance signal. Do NOT ingest or cache Street View image bytes into the CRM image store. If a façade image is ever shown to a user, fetch it live from the Street View Static API under the Maps Platform ToS (no long-term caching of image bytes beyond ToS limits, no modification, no bulk redistribution).
- Rate-limit all calls; honor quota and `OVER_QUERY_LIMIT` backoff; no concurrent bursts.
- API key stored in the connector secret store; never logged or committed.
- Do not present the metadata row as a stored CRM photo — it is a capture-date freshness signal; flag as `streetview_metadata` so lead scoring distinguishes it from a county appraiser façade photo.
- Owner PII: this layer adds none (geo + pano capture date only); existing gating unchanged. Contacts remain gated.

## 6. Rejection criteria (reject source/area if any hold)
- API key invalid / `REQUEST_DENIED` / billing not enabled → block the connector (build-time fix; not a source reject).
- `status=ZERO_RESULTS` for a parcel → flag `no_pano`, fall back to NAIP ortho; do NOT reject the source (pano coverage is inherently partial).
- Metadata response lacks `date` (`capture_date`) for an `OK` pano → reject that row (cannot establish freshness).
- Source provenance is a third-party mirror / scraper of Street View rather than the official `maps.googleapis.com` endpoint → reject.
- Any plan to ingest/cache Street View image bytes into a redistributable CRM image store → reject (metadata-only is the pilot scope; live-fetch under ToS only).
- ToS terms at build time forbid storing derived metadata beyond a threshold → re-scope to live-fetch-only and re-evaluate; do not violate Maps Platform ToS.

## 7. Connector build steps (ordered)
1. Provision a Google Maps Platform API key with the Street View API enabled + active billing account; store in the connector secret store. (Resolves the "Street View key" Current Blocker in `property-intelligence-status.md`.)
2. Validate the metadata endpoint against a known urban + a known rural parcel centroid: confirm `OK` returns `pano_id` + `date`; confirm `ZERO_RESULTS` for the rural point; confirm quota/backoff behavior.
3. Per-parcel: `GET .../metadata?location={lat},{lng}&radius=50&source=outdoor&key=KEY` → capture `pano_id`, `date` (→ `capture_date`), `location`, `copyright`, `status`. Validate field map against §3; if `OK` but `date` missing → §6 reject that row.
4. Rate-limit + batch the 13,933-row gap over scheduled runs; exponential backoff on `OVER_QUERY_LIMIT`; log `ZERO_RESULTS` as `no_pano` (fall back to NAIP).
5. Record service status + ToS/metadata-only note; confirm no Street View image-byte ingestion.
6. Seed an imagery-metadata row in `data/source-registry` keyed by source_id: `{source_id: google-streetview-metadata, coverage: national_pano_partial, access_method: maps_platform_api_key_metadata_only, cadence: quarterly_resync, last_fetched, api_key_status, status}`.
7. Join to the tax-roll pilot on `APN` (via lat/lng) to attach a national street-level capture-date signal to tax-distressed parcels; `capture_date` available to lead scoring; `streetview_metadata` flag distinguishes from county appraiser façade photos where present.
8. Reconcile against the other photo pilots: prefer Miami-Dade appraiser `photo_date` (façade) where present; else Street View `capture_date` (street-level) where `status=OK`; else NAIP `acquisition_date` (ortho freshness). Three-tier freshness fallback.

## 8. Relationship to existing pilots
- `data/source-registry/pilot-manifest-photo-imagery-miamidade-2026-06-27.md` (VERIFIED iter 46): county appraiser façade-photo metadata, ONE county, per-parcel/PR. Street View Metadata is the **national street-level** complement that covers parcels the single-county appraiser pilot cannot.
- `data/source-registry/pilot-manifest-photo-imagery-naip-2026-06-27.md` (DRAFT iter 109): national public-domain **ortho** freshness (coarse "imaged date", not façade). Street View Metadata adds **street-level façade** capture date where a public pano exists; the two form a national two-tier fallback (street-level pano → ortho).
- `data/source-registry/pilot-manifest-taxroll-maricopa-2026-06-27.md` (LOCKED iter 22/37) + Miami-Dade/Santa Clara CA/Harris/Clark tax-roll pilots: provide the APN ↔ lat/lng join key reused here.
- `data/source-registry/pilot-manifest-onmarket-reso-2026-06-27.md` (VERIFIED iter 44; §10 blocker path iter 108): on-market lane, independent; Street View does not ingest MLS/IDX media.

## 9. Queue / follow-on
- Owner/tax-roll lane — ACHIEVED/superseded (5 VERIFIED county pilots incl. Santa Clara CA which directly targets the CA-dominated harvest owner gap); build-time URL/PR confirmation only.
- On-market feed — VERIFIED connector-ready; build-time per-MLS RESO base URL + OAuth2/DUA + RentCast API-key fix (§10, iter 108).
- Photo/imagery metadata — Miami-Dade VERIFIED (iter 46); NAIP national ortho DRAFT (iter 109); **Street View Metadata national street-level DRAFT this loop (iter 115)**. Next: provision the Maps Platform API key (build-time, resolves Current Blocker) and run the §2 validation query; then verify current USGS TNM service names + NAIP state-year cycle.

## Files
- This manifest: `data/source-registry/pilot-manifest-photo-imagery-streetview-metadata-2026-06-27.md` (iter 115).
- Discovery memo: `data/source-registry/photo-imagery-metadata-candidate-2026-06-27.md` (Candidate C).
- Status gap evidence: `data/source-registry/property-intelligence-status.md` ("photo candidates JSONL: 13933 rows, with candidate: 0, gaps: 13933"; Current Blockers: "photo sidecar is gap-only until lawful media sources or a Street View key are configured").
- County appraiser façade-photo pilot: `data/source-registry/pilot-manifest-photo-imagery-miamidade-2026-06-27.md`.
- National ortho freshness pilot: `data/source-registry/pilot-manifest-photo-imagery-naip-2026-06-27.md`.
- APN join-key reuse: `data/source-registry/pilot-manifest-taxroll-maricopa-2026-06-27.md` (§8 appraiser path).

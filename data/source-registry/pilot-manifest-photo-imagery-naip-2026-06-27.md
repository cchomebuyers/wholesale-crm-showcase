# Connector-Ready Pilot Manifest — Lawful Photo / Imagery Metadata Source (NAIP / USGS National Map)

**Pilot source:** USDA Farm Service Agency (FSA) NAIP orthoimagery, distributed via USGS The National Map — official **public-domain** imagery **metadata** (NOT image bytes).
**Discovery memo:** `data/source-registry/photo-imagery-metadata-candidate-2026-06-27.md` (Candidate B)
**Created:** 2026-06-27 (GLM iter 109)
**Status:** DRAFT CONNECTOR-READY (GLM iter 109). Metadata-only layer (capture date / provenance / tile ref / license); image bytes are NOT ingested into the CRM from this source.
**Why this loop:** The Miami-Dade appraiser-photo pilot (`pilot-manifest-photo-imagery-miamidade-2026-06-27.md`, VERIFIED iter 46) covers ONE county via per-parcel search / Ch.119 PR request, so it cannot close the photo gap reported in `data/source-registry/property-intelligence-status.md`: "photo candidates JSONL: 13933 rows, with candidate: 0, gaps: 13933" and "photo sidecar is gap-only until lawful media sources or a Street View key are configured." NAIP is a **national-coverage, public-domain** freshness layer — the scalable lawful path to a structure-imaged date for every CRM parcel regardless of county. Exact tile/REST endpoints confirm at connector build time (source-discovery loop, not build time).
**Lawful basis:** NAIP and USGS orthoimagery are U.S. Government public-domain products (USDA FSA + USGS). Metadata (acquisition date, tile URL, bbox) is freely redistributable. Official/public sources only (.gov); no hostile scraping; no Zillow/Redfin/Realtor.com/CoStar; no people-search/aggregator imagery; no MLS/IDX image ingestion. Owner PII stays gated; B2B files preserved.

## 1. Official source
- Agencies: USDA Farm Service Agency Aerial Photography Field Office (FSA APFO) produces NAIP; USGS The National Map (TNM) distributes it.
- USGS TNM portal (official): `https://apps.nationalmap.gov/`
- TNM Downloader (official, bulk/area selection): `https://apps.nationalmap.gov/downloader/`
- USGS TNM REST/OWS services (official): `https://services.nationalmap.gov/arcgis/rest/services` (e.g., USGSNAIPPlus, USGSImageryOnly — verify current service name at build time)
- FSA APFO NAIP program page (official): `https://www.fsa.usda.gov/programs-and-services/aerial-photography/imagery-programs/naip-imagery/`
- Provenance: U.S. Government public-domain imagery; reuse/redistribution unrestricted. Reuses the APN ↔ situs ↔ lat/lng join key established by the tax-roll + Miami-Dade photo pilots — no new access channel, only a new (national) freshness layer.

## 2. Access path (public-domain bulk / REST)
- Preferred (batch metadata): TNM Downloader — select area by county/bbox, product = "Imagery – NAIP", download tile index/footprints with per-tile `acquisition_date`. Metadata (tile footprint + date) is the pilot target; image bytes are reference-only and NOT ingested into the CRM image store.
- Preferred (REST/WMS, point query): USGS TNM imagery WMS/REST — query parcel centroid lat/lng against the NAIP layer to resolve the covering tile + `acquisition_date`. Use for per-parcel freshness join at scale; rate-limit.
- Preferred (national tile index): NAIP tile footprint / index shapefile (per state, per year) distributed via FSA APFO / TNM — join parcel lat/lng → covering tile → `acquisition_date`. This is the most efficient batch path for the 13,933-row gap.
- Auth: none (public domain, open services). Rate-limit all calls; no concurrent bursts; honor any posted service usage guidance.
- Not allowed: re-hosting large image mosaics; bypassing rate limits; presenting coarse ortho as a façade/structure photo (ortho gives "imaged date" only, not a building façade — flag accordingly).

## 3. Field map (source → CRM, **metadata only**)
| CRM field | Source field (expected) | Notes |
|---|---|---|
| apn / parcel_id | (join via parcel lat/lng → covering tile) | join key to tax-roll + Miami-Dade photo pilots |
| lat / lng | Parcel centroid / situs geo | geo key to resolve covering NAIP tile |
| acquisition_date | NAIP tile capture date (YYYY or YYYY-MM) | freshness anchor (primary) |
| tile_url / tile_id | TNM tile reference | provenance; stored as reference, not ingested as bytes |
| source | `naip_usgs_tnm` / `usda_fsa_apfo` | official provenance |
| license | `public_domain_usgov` | unrestricted redistribution |
| resolution_m | NAIP resolution (e.g., 0.6m / 1m) | quality flag (coarse vs fine) |
| (aux) last_fetched | connector pull timestamp | per-APN freshness |

## 4. Freshness field
- Authoritative anchor: `acquisition_date` (NAIP tile capture date). NAIP is flown on a ~1–3 year cycle, state-dependent; the acquisition year is the freshness signal.
- Per-pull: `last_fetched`, recorded per APN (or per tile footprint) in the connector manifest.
- Cadence: re-resolve covering tile + `acquisition_date` on each new NAIP cycle for the state; treat `acquisition_date` older than the current published cycle for the state as stale-flag, not auto-reject (ortho still confirms structure-imaged presence).
- Granularity note: year-granular (sometimes YYYY-MM); complements, does not replace, the Miami-Dade appraiser `photo_date` where available.

## 5. robots.txt / ToS note
- Public-domain U.S. Government data; no redistribution restriction. Still honor any posted USGS TNM service-usage / rate-limit guidance and `robots.txt`.
- Rate-limit bulk downloads and REST point queries; no concurrent bursts; use the official TNM Downloader / REST endpoints only.
- **Metadata-only scope**: store `acquisition_date` + `tile_url`/`tile_id` + `resolution_m` as a freshness/provenance signal; do NOT ingest large orthoimage mosaics into the CRM image store (reference the tile URL instead).
- Do not present NAIP ortho as a building façade photo — it is an "imaged date" freshness layer; flag as `ortho_only` so lead scoring does not treat it as a structure façade.
- Owner PII: this layer adds none (geo + capture date only); existing gating unchanged.

## 6. Rejection criteria (reject source/county if any hold)
- Tile/footprint has no `acquisition_date` → reject (cannot establish freshness).
- TNM service / FSA index down or withdrawn for the state-year → flag and retry next cycle (not a hard reject of the source).
- Resolution too coarse to confirm structure presence (e.g., legacy 2m+) → flag as `ortho_only` (no façade signal), do not reject outright.
- Source provenance traces to a third-party/aggregator re-host rather than official USGS TNM / FSA APFO → reject.
- Any plan to ingest orthoimage bytes into a redistributable CRM image store → reject (metadata-only is the pilot scope; reference the tile URL instead).

## 7. Connector build steps (ordered)
1. Verify current USGS TNM service names + Downloader product path for "Imagery – NAIP" (official `.gov`); confirm a sample county bbox returns tile footprints with `acquisition_date`.
2. Obtain the NAIP tile-footprint index (per state-year) via FSA APFO / TNM; load as a spatial layer.
3. Spatial-join CRM parcel centroids (lat/lng) → covering NAIP tile → capture `acquisition_date`, `tile_url`/`tile_id`, `resolution_m`; validate field map against §3; if `acquisition_date` missing → §6 reject for that tile.
4. Record service status + rate-limit note; confirm metadata-only scope (no orthoimage-byte ingestion).
5. Seed an imagery-metadata row in `data/source-registry` keyed by source_id: `{source_id: naip-usgs-tnm, coverage: national, access_method: tnm_downloader+tile_index_spatial_join, cadence: naip_cycle_1_3yr, last_fetched, robots_txt_status, status}`.
6. Join to the tax-roll pilot on `APN` (via lat/lng) to attach a national structure-imaged-date signal to tax-distressed parcels; `acquisition_date` available to lead scoring; `ortho_only` flag distinguishes from county appraiser façade photos where present.
7. Reconcile against the Miami-Dade photo pilot: where Miami-Dade `photo_date` exists, prefer it (façade); otherwise fall back to NAIP `acquisition_date` (ortho freshness).

## 8. Relationship to existing pilots
- `data/source-registry/pilot-manifest-photo-imagery-miamidade-2026-06-27.md` (VERIFIED iter 46): county appraiser façade-photo metadata, one county, per-parcel/PR. NAIP is the **national** freshness backfill that covers the 13,933-row gap the single-county appraiser pilot cannot.
- `data/source-registry/pilot-manifest-taxroll-maricopa-2026-06-27.md` (LOCKED iter 22/37) + Miami-Dade/Harris/Clark tax-roll pilots: provide the APN ↔ lat/lng join key reused here.
- `data/source-registry/pilot-manifest-onmarket-reso-2026-06-27.md` (VERIFIED iter 44; §10 blocker path iter 108): on-market lane, independent; NAIP does not ingest MLS/IDX media.

## 9. Queue / follow-on
- Owner/tax-roll lane — ACHIEVED/superseded (4 VERIFIED county pilots); build-time URL/PR confirmation only.
- On-market feed — VERIFIED connector-ready; build-time per-MLS RESO base URL + OAuth2/DUA + RentCast API-key fix (§10, iter 108).
- Photo/imagery metadata — Miami-Dade VERIFIED (iter 46); NAIP national backfill DRAFTED this loop (iter 109); Google Street View **Metadata** API remains gated pending Google Maps Platform ToS sign-off + API key (metadata-only, no image bytes). Next loop: verify current TNM service names + NAIP state-year cycle, or advance Street View metadata ToS path.

## Files
- This manifest: `data/source-registry/pilot-manifest-photo-imagery-naip-2026-06-27.md` (iter 109).
- Discovery memo: `data/source-registry/photo-imagery-metadata-candidate-2026-06-27.md` (Candidate B).
- Status gap evidence: `data/source-registry/property-intelligence-status.md` ("photo candidates JSONL: 13933 rows, with candidate: 0, gaps: 13933"; "photo sidecar is gap-only until lawful media sources or a Street View key are configured").
- County appraiser façade-photo pilot: `data/source-registry/pilot-manifest-photo-imagery-miamidade-2026-06-27.md`.
- APN join-key reuse: `data/source-registry/pilot-manifest-taxroll-maricopa-2026-06-27.md` (§8 appraiser path).

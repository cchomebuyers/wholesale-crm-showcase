# Lawful Photo / Imagery Metadata Source Candidate — NY State GIS Clearinghouse Orthoimagery (2026-06-28)

**Focus task:** Lawful photo/imagery metadata source candidate (one new candidate track, bounded loop).
**GLM iteration:** 193
**Queue position / rationale:** Photo/imagery lane is the remaining focus item with an open source-discovery blocker. `data/source-registry/property-intelligence-status.md` (inspected this loop) records: "photo candidates JSONL: 13933 rows, with candidate: 0, gaps: 13933" and "photo sidecar is gap-only until lawful media sources or a Street View key are configured." Existing lawful photo-metadata pilots on disk (Miami-Dade + Hillsborough county appraiser façade photos; NAIP national ortho via USGS TNM; NOAA NGS coastal/aerial; Google Street View metadata — gated) leave a gap for a **state-GIS statewide orthoimagery** layer that is typically higher-resolution and more recent than the NAIP cycle. NY is a high-volume harvest state (`nyc-ny-violations`: 1027 rows in the status report's Top Sources) with no NY-state imagery manifest on disk, so this candidate directly targets that population. Owner/tax-roll lane is FULLY mature (8 verified county pilots); on-market RESO is VERIFIED CONNECTOR-READY — both out of source-discovery scope this loop.

**Scope rule:** metadata-only (capture date / provenance / tile ref / license / resolution). Image bytes are NOT ingested into the CRM image store from this source — tile URL is stored as a reference, not re-hosted.

## 1. Official source
- Agency: New York State GIS Program Office / NYS Information Technology Services (NYSGIS), in partnership with USDA FSA / USGS for statewide orthoimagery acquisition.
- NYS GIS Clearinghouse (official `.gov`): `https://gis.ny.gov/`
- NYSGIS data gateway / orthoimagery download (official): `https://gis.ny.gov/gateway/`
- NYS GIS ArcGIS REST services (official, for point/tile queries): `https://gis.ny.gov/arcgis/rest/services` (verify current service name at connector build time — NYS publishes year-tagged orthoimagery map services, e.g. a state orthoimagery mosaic service; service names rotate by acquisition year).
- Provenance: official NYS `.gov` orthoimagery program; usage terms permit public/programmatic use (see §5). Distinct from the national NAIP/USGS TNM layer already piloted (`pilot-manifest-photo-imagery-naip-2026-06-27.md`) — NYS orthoimagery is frequently leaf-off, higher-resolution (e.g. 0.5ft–1ft in many counties), and refreshed on a county-rotating cycle, so it provides a more recent structure-imaged-date for NY parcels than the coarser/older NAIP cycle.
- Reuses the `apn` ↔ `situs` ↔ `lat/lng` join key established by the owner/tax-roll pilots — no new access channel, only a new (NY-state) freshness layer.

## 2. Access path (public-domain / open-data, bulk + REST)
- Preferred (batch metadata): NYSGIS data gateway orthoimagery tile index / footprints — select by county/tile, capture per-tile `acquisition_date` (capture year, leaf-on/leaf-off). Metadata (tile footprint + date + resolution) is the pilot target; image bytes reference-only, NOT ingested.
- Preferred (REST/WMS, point query): NYS GIS ArcGIS REST orthoimagery mosaic service — query parcel centroid lat/lng against the NYS orthoimagery layer to resolve the covering tile + `acquisition_date`. Use for per-parcel freshness join at scale; rate-limit.
- Auth: none expected (open-data public service). Rate-limit all calls; no concurrent bursts; honor posted service-usage guidance.
- Not allowed: re-hosting large ortho mosaics; bypassing rate limits; presenting ortho as a building façade photo (ortho gives "imaged date" only, not a façade — flag `ortho_only`); scraping any third-party portal re-hosting NYSGIS tiles.

## 3. Field map (source → CRM, **metadata only**)
| CRM field | Source field (expected) | Notes |
|---|---|---|
| apn / parcel_id | (join via parcel lat/lng → covering tile) | join key to tax-roll + county appraiser photo pilots |
| lat / lng | Parcel centroid / situs geo | geo key to resolve covering NYS ortho tile |
| acquisition_date | NYS orthoimagery tile capture date (YYYY, sometimes YYYY-MM) | freshness anchor (primary) |
| leaf_condition | leaf-on / leaf-off | quality flag (leaf-off preferred for structure visibility) |
| tile_url / tile_id | NYS tile reference | provenance; stored as reference, not ingested as bytes |
| source | `nys_gis_orthoimagery` | official provenance |
| license | `nys_open_data` (verify per dataset at build time) | generally free public use |
| resolution_m | NYS ortho resolution (e.g., ~0.15m / 0.3m / 1m, county-dependent) | quality flag (coarse vs fine) |
| (aux) last_fetched | connector pull timestamp | per-APN freshness |

## 4. Freshness field
- Authoritative anchor: `acquisition_date` (NYS orthoimagery tile capture date). NYS orthoimagery is acquired on a county-rotating cycle (commonly ~3–5 years per county); the capture year is the freshness signal.
- Per-pull: `last_fetched`, recorded per APN (or per tile footprint) in the connector manifest.
- Cadence: re-resolve covering tile + `acquisition_date` on each new NYS acquisition cycle for the county; treat `acquisition_date` older than the current published county cycle as a stale-flag, not an auto-reject (ortho still confirms structure-imaged presence).
- Granularity: year-granular (sometimes YYYY-MM); complements — does not replace — county appraiser `photo_date` where available, and refines NAIP `acquisition_date` for NY parcels.

## 5. robots.txt / ToS note
- NYSGIS data is official NYS open data; confirm the specific dataset's terms at build time (most NYS orthoimagery permits public/programmatic use; some partner-acquired tiles carry attribution requirements). Honor any posted attribution requirement and `robots.txt`.
- Rate-limit bulk downloads and REST point queries; no concurrent bursts; use official NYSGIS gateway / REST endpoints only.
- **Metadata-only scope**: store `acquisition_date` + `tile_url`/`tile_id` + `resolution_m` + `leaf_condition` as a freshness/provenance signal; do NOT ingest large orthoimage mosaics into the CRM image store (reference the tile URL instead).
- Do not present NYS ortho as a building façade photo — it is an "imaged date" freshness layer; flag as `ortho_only` so lead scoring does not treat it as a structure façade.
- Owner PII: this layer adds none (geo + capture date only); existing gating unchanged.

## 6. Rejection criteria (reject source/county-tile if any hold)
- Tile/footprint has no `acquisition_date` → reject (cannot establish freshness).
- NYSGIS service / tile index down or dataset withdrawn for the county-year → flag and retry next cycle (not a hard reject of the source).
- Dataset terms prohibit CRM/wholesale reuse or require redistribution restrictions the CRM cannot meet → reject (cannot gate around a license prohibition).
- Resolution too coarse to confirm structure presence → flag as `ortho_only` (no façade signal), do not reject outright.
- Source provenance traces to a third-party/aggregator re-host rather than official NYSGIS `.gov` → reject.
- Any plan to ingest orthoimage bytes into a redistributable CRM image store → reject (metadata-only is the pilot scope; reference the tile URL instead).

## 7. Relationship to existing pilots / queue
- `pilot-manifest-photo-imagery-naip-2026-06-27.md` (DRAFT iter 109): national NAIP ortho via USGS TNM. This NYS candidate is a **state-resolution refinement** for NY parcels (higher-res + more recent capture than the NAIP cycle); not a duplicate — use NYS `acquisition_date` where more recent, else fall back to NAIP.
- `pilot-manifest-photo-imagery-miamidade-2026-06-27.md` (VERIFIED iter 46) + `pilot-manifest-photo-imagery-hillsborough-fl-2026-06-27.md`: county appraiser façade photos (FL). NYS ortho is ortho-only, `ortho_only` flag distinguishes from façade.
- `pilot-manifest-photo-imagery-noaa-ngs-2026-06-28.md`: NOAA NGS coastal/aerial survey — distinct program (coastal focus); NYS ortho covers inland NY counties not on the coast.
- `pilot-manifest-photo-imagery-streetview-metadata-2026-06-27.md`: Street View metadata — street-level recency; gated pending Google Maps Platform ToS + API key. NYS ortho needs no key and is fully lawful now.
- Owner/tax-roll lane (8 verified county pilots) + on-market RESO (VERIFIED, §10/§11 build-time) — both mature; provide the `apn`/`situs`/`lat-lng` join key reused here.

## 8. Recommended pilot (next loop)
Promote this candidate to a connector-ready DRAFT pilot manifest: verify the current NYS GIS ArcGIS REST orthoimagery service name + tile-index download path, run one sample county-tile query (e.g., a NYC county) to confirm `acquisition_date` + `resolution_m` are returned, then spatial-join the 1,027 `nyc-ny-violations` parcel centroids → covering NYS tile → `acquisition_date`. If service names / open-data terms cannot be confirmed → §6 reject and fall back to NAIP national ortho for NY parcels.

## Files / provenance
- This report: `data/source-registry/photo-imagery-candidate-nys-gis-2026-06-28.md` (GLM iter 193).
- Inspected this loop: `data/source-registry/owner-taxroll-candidate-2026-06-27.md` (confirmed owner/tax-roll lane FULLY mature — 8 verified manifests; queue should advance), `data/source-registry/property-intelligence-status.md` (photo gap = 13933/13933; open blocker "lawful media sources... configured"), `data/source-registry/pilot-manifest-onmarket-reso-2026-06-27.md` (VERIFIED + §10/§11 build-time paths — on-market out of source-discovery scope), `data/source-registry/pilot-manifest-photo-imagery-naip-2026-06-27.md` + `data/source-registry/photo-imagery-metadata-candidate-2026-06-27.md` (confirmed no NY-state imagery manifest on disk → this candidate fills the gap).
- Directory inventory this loop: `data/source-registry/` listing (8 taxroll pilots + 5 on-market pilots + 5 photo-imagery manifests on disk; no NY-state imagery candidate existed).

## Exclusions
No scraping of Zillow/Redfin/Realtor.com/CoStar or people-search/aggregator imagery. No MLS photo ingestion (IDX-governed, out of scope for this lawful-discovery track). No orthoimage-byte ingestion — metadata-only. Owner PII gated; B2B files preserved; official/public `.gov` sources only; no hostile scraping.

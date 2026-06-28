# Connector-Ready Pilot Manifest — Lawful Photo / Imagery Metadata Source

**Pilot source:** Miami-Dade County Property Appraiser (FL) — official public-record parcel photograph **metadata** (NOT image bytes).
**Discovery memo:** `data/source-registry/photo-imagery-metadata-candidate-2026-06-27.md` (Candidate A drafted GLM iter 34)
**Created:** 2026-06-27 (GLM iter 41)
**Status:** VERIFIED CONNECTOR-READY (GLM iter 46). Third and final focus item confirmed at the same connector-ready verification bar as the tax-roll (LOCKED + verified iter 22/37) and on-market (VERIFIED iter 44) pilots. Every CODEX-required field present: official URL §1; access path §2; field map apn / photo_url / photo_date / assessment_year §3; freshness §4 (photo_date → assessment_year → last_fetched); robots/ToS §5; rejection criteria §6. This is a **metadata-only** layer: capture date / provenance / parcel ref / license — image bytes are NOT ingested from governed sources. Exact photo-endpoint URLs are instance-specific and confirm at connector build time (source-discovery loop, not build time). Jurisdiction grounded against verified registry row `miamidade-fl-violations` in `data/source-registry/county-source-registry.jsonl` (official ArcGIS, FL Ch. 119 public-official API, confidence high).
**Lawful basis:** Florida Statutes Ch. 119 (Public Records) — parcel photographs taken by the property appraiser for assessment purposes are public records. Official/public source only (.gov domain). No hostile scraping; no Zillow/Redfin/Realtor.com/CoStar; no people-search/aggregator imagery. Owner PII stays gated; B2B files preserved.

## 1. Official source
- Agency: Miami-Dade County Property Appraiser (FL) — official property appraisal/assessment authority.
- Official domain: `https://www.miamidade.gov/pa/` (.gov — official).
- Parcel search (pattern; verify exact path at build time): `https://www.miamidade.gov/pa/property_search/` → per-parcel result exposes a building/parcel photo URL + assessment year for many improved parcels.
- Provenance: government domain; the assessment photo is a Ch. 119 public record. Reuses the same official .gov domain and APN join key as the tax-roll appraiser path — no new access channel.

## 2. Access path (public-record / bulk)
- Preferred (per-parcel): official parcel-search result returns the photo URL + `assessment_year` per APN. Pull metadata only (`photo_url`, `photo_date`/`assessment_year`); do NOT ingest image bytes from the governed portal into the CRM image store.
- Preferred (batch): formal public-records request to the Property Appraiser's office for parcel-photo metadata (APN → `photo_url` → `assessment_year`) under FL Ch. 119. This is the lawful bulk path; capture the PR-request reference + fulfillment date in the manifest.
- Cross-check (official open data): Miami-Dade GIS open-data services (official `.gov`) for parcel geometry/APN join — verify the current open-data hub URL at build time; used only to resolve APN ↔ situs ↔ lat/lng, not for imagery.
- Not allowed: page-by-page scraping of the parcel-search UI beyond a manual verify; hot-linking images on external-facing surfaces; re-hosting appraiser photos; bypassing any captcha/anti-bot (STOP and use the public-records-request path).
- Auth: none expected for public parcel search; bulk via PR request. Rate-limit all calls; no concurrent bursts.

## 3. Field map (source → CRM, **metadata only**)
| CRM field | Source field (expected) | Notes |
|---|---|---|
| apn / parcel_id | Parcel number / folio number | join key to tax-roll pilot (↔ Maricopa-style APN join) |
| photo_url | Appraiser-hosted parcel photo URL | stored as reference only; NOT re-hosted; NOT ingested as bytes |
| photo_date | Photo capture date (if published) | freshness anchor (preferred) |
| assessment_year | Assessment / roll year | freshness anchor (fallback when photo_date absent) |
| source_domain | `miamidade.gov` | official provenance |
| license | `public_record_fl_ch119` | jurisdiction-specific; CRM-internal reference only |
| lat / lng | Parcel centroid / situs geo | geo key; cross-check vs tax-roll situs |
| (aux) last_fetched | connector pull timestamp | per-APN freshness |

## 4. Freshness field
- Authoritative anchor: `photo_date` (capture date) when published.
- Fallback anchor: `assessment_year` (appraiser photo typically refreshed on reassessment cycle) — year-granular.
- Per-pull: `last_fetched`, recorded per APN in the connector manifest.
- Cadence: reassessment/roll cycle (annual in FL); re-pull photo metadata on each new roll; treat `assessment_year` < current roll year as stale-flag, not auto-reject.

## 5. robots.txt / ToS note
- Honor `https://www.miamidade.gov/robots.txt` and the Property Appraiser's terms of use.
- Prefer the per-parcel public-search path and/or a Ch. 119 public-records request over any crawling; rate-limit; no concurrent requests.
- **Metadata-only**: store `photo_url` + `photo_date`/`assessment_year` as a freshness/provenance signal; do NOT ingest image bytes from the governed portal and do NOT hot-link images on external-facing surfaces (CRM-internal reference only).
- If a posted data-use statement restricts photo reuse, downgrade to metadata-only (URL + date) or drop `photo_url` entirely — do not redistribute the image.
- If a captcha/anti-bot gate blocks the parcel search, STOP and use the public-records-request path — do not bypass.
- Owner PII already gated per tax-roll policy; this layer adds no new PII.

## 6. Rejection criteria (reject pilot county/source if any hold)
- County terms prohibit CRM/wholesale reuse of the photo metadata → reject (or gate to internal-only with legal sign-off).
- No photo exposed by the parcel search AND no public-records-request path → reject.
- No assessable freshness field (neither `photo_date` nor `assessment_year`) → reject as stale/unverifiable.
- Source provenance traces to a people-search/aggregator re-hosting appraiser photos → reject.
- robots.txt disallows the parcel-search/imagery path → reject (respect it; fall back to PR request only if that path is permitted).
- Any plan to ingest image bytes from the governed portal without ToS sign-off → reject (metadata-only is the pilot scope).

## 7. Connector build steps (ordered)
1. Verify official domain + exact parcel-search URL; confirm a sample APN returns a photo URL + `assessment_year` (manual browser, no scraping).
2. For batch, file a Ch. 119 public-records request for parcel-photo metadata; record PR reference + fulfillment date.
3. Pull metadata only (`photo_url`, `photo_date`/`assessment_year`, `apn`); validate field map against §3; if any required field missing → §6 reject.
4. Record robots.txt status + any ToS/data-use statement; confirm metadata-only scope (no image-byte ingestion).
5. Seed an imagery-metadata row in `data/source-registry` keyed by APN: `{county, source_id, access_method, cadence, last_fetched, robots_txt_status, status}`; reconcile against the existing `miamidade-fl-violations` registry row for jurisdiction continuity.
6. Join to the tax-roll pilot on `APN` to attach a structure-freshness signal to tax-distressed parcels; `photo_url`/`assessment_year` available to lead scoring, image bytes never ingested.

## 8. Secondary freshness layers (cross-check / gated)
- **NAIP / USGS The National Map orthoimagery (public domain):** `https://apps.nationalmap.gov/` — capture `acquisition_date` + tile URL + bbox as a public-domain cross-check freshness layer for counties with no appraiser photo. NAIP cycle is 1–3 yr, state-dependent. Rejection: no `acquisition_date` → reject; resolution too coarse to confirm structure presence → flag as ortho-only (no façade signal).
- **Google Street View Metadata API (governed, gated):** `https://maps.googleapis.com/maps/api/streetview/metadata?location={lat,lng}&key={API_KEY}` → `{pano_id, date, location, copyright, status}`. **Metadata-only** (`pano_id` + `date`); NO image bytes (Static API) without separate ToS/branding sign-off. Freshness: `date` (YYYY-MM) — street-level recency complement to the year-granular appraiser photo. Rejection: ToS review blocks metadata storage → reject; `status:ZERO_RESULTS` → flag, not a hard reject.

## 9. Queue / follow-on sources
- Owner/tax-roll pilot — LOCKED + verified connector-ready (GLM iter 22/37): `data/source-registry/pilot-manifest-taxroll-maricopa-2026-06-27.md`. CODEX inbox ask (20260627T235803Z) satisfied; remaining work is build-time URL confirmation.
- Official on-market feed pilot — VERIFIED CONNECTOR-READY (GLM iter 44; authored iter 38): `data/source-registry/pilot-manifest-onmarket-reso-2026-06-27.md`. Remaining work is build-time per-MLS RESO base URL + OAuth2 + DUA scope confirmation, not source discovery.
- This photo/imagery-metadata pilot — VERIFIED CONNECTOR-READY (GLM iter 46; authored iter 41): every CODEX-required field confirmed present (official URL §1; access path §2; field map apn/photo_url/photo_date/assessment_year §3; freshness §4 photo_date→assessment_year→last_fetched; robots/ToS §5; rejection criteria §6). Remaining work is build-time photo-endpoint URL confirmation + Ch. 119 PR-request fulfillment, not source discovery.
- All three focus items now have VERIFIED connector-ready pilot manifests; next source-discovery loops can expand to a second county/jurisdiction per track or begin connector build once credentials/DUAs are in hand.

## Files
- This manifest: `data/source-registry/pilot-manifest-photo-imagery-miamidade-2026-06-27.md` (iter 41 created; iter 46 verified + §9 reconciled).
- Discovery memo: `data/source-registry/photo-imagery-metadata-candidate-2026-06-27.md`
- Jurisdiction grounding (verified registry row): `miamidade-fl-violations` in `data/source-registry/county-source-registry.jsonl`
- APN join-key reuse: `data/source-registry/pilot-manifest-taxroll-maricopa-2026-06-27.md` (§8 appraiser path)
- FL / Ch. 119 public-records template (superseded tax-roll draft, retained): `data/source-registry/pilot-manifest-county-taxroll-2026-06-27.md`

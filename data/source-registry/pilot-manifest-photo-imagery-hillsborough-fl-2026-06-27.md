# Connector-Ready Pilot Manifest — Lawful Photo / Imagery Metadata Source (Hillsborough County, FL)

**Pilot source:** Hillsborough County Property Appraiser (HCPA) (FL) — official public-record parcel photograph **metadata** (NOT image bytes).
**Discovery memo:** `data/source-registry/photo-imagery-metadata-candidate-2026-06-27.md` (Candidate A; `hcpafl.org` named as a candidate domain pattern)
**Template mirrored:** `data/source-registry/pilot-manifest-photo-imagery-miamidade-2026-06-27.md` (VERIFIED CONNECTOR-READY, GLM iter 46)
**Created:** 2026-06-28 (GLM iter 129)
**Status:** DRAFT PILOT — second county appraiser on the photo/imagery-metadata track (expands the VERIFIED Miami-Dade pilot to a second FL Ch. 119 jurisdiction per the iter-127 declared next step). Every CODEX-required field present: official URL §1; access path §2; field map apn / photo_url / photo_date / assessment_year §3; freshness §4 (photo_date → assessment_year → last_fetched); robots/ToS §5; rejection criteria §6. **DRAFT** because, unlike Miami-Dade (VERIFIED), the live HCPA parcel-search photo endpoint + `assessment_year` publication have not yet been confirmed at build time; promotion to VERIFIED requires the §7 verification checklist. This is a **metadata-only** layer: capture date / provenance / parcel ref / license — image bytes are NOT ingested from governed sources. Exact photo-endpoint URLs are instance-specific and confirm at connector build time.
**Lawful basis:** Florida Statutes Ch. 119 (Public Records) — parcel photographs taken by the property appraiser for assessment purposes are public records. Official/public source only (`hcpafl.org` — constitutional county office; confirm `.gov`/official-domain status at onboarding). No hostile scraping; no Zillow/Redfin/Realtor.com/CoStar; no MLS/IDX photo ingestion; no people-search/aggregator imagery. Owner PII stays gated; B2B files preserved.

## 1. Official source
- Agency: Hillsborough County Property Appraiser (HCPA) — official property appraisal/assessment authority (constitutional county office, FL).
- Official domain: `https://www.hcpafl.org/` (candidate pattern per discovery memo; confirm exact domain/path at onboarding).
- Parcel search (pattern; verify exact path at build time): HCPA parcel/property search → per-parcel result exposes a building/parcel photo URL + assessment year for many improved parcels (same pattern class as Miami-Dade PA; field names differ by vendor).
- Provenance: official HCPA domain; the assessment photo is a Ch. 119 public record. Reuses the same official-domain + APN join key as the Hillsborough tax-roll candidate (`data/source-registry/owner-taxroll-candidate-hillsborough-fl-2026-06-27.md`, iter 103) — no new access channel. Tax Collector partner (`hilltax.com`, FL Ch. 197 tax-certificate/deed sale) is a separate tax-sale lane, not this photo pilot.
- Jurisdiction grounding: verified registry row `hillsborough-fl-violations` in `data/source-registry/county-source-registry.jsonl` (county_fips 12057, FL, ArcGIS, `legal_status: public_official_api`, confidence high) — same county/jurisdiction/Ch. 119 frame as this photo pilot.

## 2. Access path (public-record / bulk)
- Preferred (per-parcel): official HCPA parcel-search result returns the photo URL + `assessment_year` per APN (confirm at build time). Pull metadata only (`photo_url`, `photo_date`/`assessment_year`); do NOT ingest image bytes from the governed portal into the CRM image store.
- Preferred (batch): formal public-records request to the Hillsborough County Property Appraiser's office for parcel-photo metadata (APN → `photo_url` → `assessment_year`) under FL Ch. 119. This is the lawful bulk path; capture the PR-request reference + fulfillment date in the manifest.
- Cross-check (official open data): Hillsborough County GIS open-data services (official domain) for parcel geometry/APN join — verify the current open-data hub URL at build time; used only to resolve APN ↔ situs ↔ lat/lng, not for imagery.
- Not allowed: page-by-page scraping of the parcel-search UI beyond a manual verify; hot-linking images on external-facing surfaces; re-hosting appraiser photos; bypassing any captcha/anti-bot (STOP and use the public-records-request path).
- Auth: none expected for public parcel search; bulk via PR request. Rate-limit all calls; no concurrent bursts.

## 3. Field map (source → CRM, **metadata only**)
| CRM field | Source field (expected) | Notes |
|---|---|---|
| apn / parcel_id | Parcel / folio number | join key to tax-roll (↔ Hillsborough tax-roll candidate + 6 county pilots) |
| photo_url | HCPA-hosted parcel photo URL | stored as reference only; NOT re-hosted; NOT ingested as bytes |
| photo_date | Photo capture date (if published) | freshness anchor (preferred) |
| assessment_year | Assessment / roll year | freshness anchor (fallback when photo_date absent) |
| source_domain | `hcpafl.org` | official provenance (confirm exact official host at onboarding) |
| license | `public_record_fl_ch119` | jurisdiction-specific; CRM-internal reference only |
| lat / lng | Parcel centroid / situs geo | geo key; cross-check vs tax-roll situs |
| (aux) last_fetched | connector pull timestamp | per-APN freshness |

## 4. Freshness field
- Authoritative anchor: `photo_date` (capture date) when published.
- Fallback anchor: `assessment_year` (appraiser photo typically refreshed on reassessment cycle) — year-granular.
- Per-pull: `last_fetched`, recorded per APN in the connector manifest.
- Cadence: reassessment/roll cycle (annual in FL); re-pull photo metadata on each new roll; treat `assessment_year` < current roll year as stale-flag, not auto-reject.

## 5. robots.txt / ToS note
- Honor `https://www.hcpafl.org/robots.txt` and the Property Appraiser's terms of use.
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
- `hcpafl.org` fails official-domain confirmation at onboarding (not the constitutional appraiser office) → reject and re-source.
- Any plan to ingest image bytes from the governed portal without ToS sign-off → reject (metadata-only is the pilot scope).

## 7. Connector build steps (ordered) + DRAFT→VERIFIED checklist
1. Verify HCPA official domain + exact parcel-search URL; confirm a sample APN returns a photo URL + `assessment_year` (manual browser, no scraping).
2. For batch, file a Ch. 119 public-records request for parcel-photo metadata; record PR reference + fulfillment date.
3. Pull metadata only (`photo_url`, `photo_date`/`assessment_year`, `apn`); validate field map against §3; if any required field missing → §6 reject.
4. Record robots.txt status + any ToS/data-use statement; confirm metadata-only scope (no image-byte ingestion).
5. Seed an imagery-metadata row in `data/source-registry` keyed by APN: `{county, source_id, access_method, cadence, last_fetched, robots_txt_status, status}`; reconcile against the verified `hillsborough-fl-violations` registry row for jurisdiction continuity.
6. Join to the tax-roll layer on `APN` to attach a structure-freshness signal to tax-distressed parcels; `photo_url`/`assessment_year` available to lead scoring, image bytes never ingested.
7. **DRAFT → VERIFIED gate:** all of (a) public parcel-search photo URL present, (b) `assessment_year`/`photo_date` published, (c) robots/ToS permit CRM-internal metadata-only reuse, (d) not a people-search/aggregator re-host, (e) official HCPA domain confirmed — then stamp VERIFIED CONNECTOR-READY (mirroring Miami-Dade iter 46).

## 8. Secondary freshness layers (cross-check / gated — unchanged from Miami-Dade pilot)
- **NAIP / USGS The National Map orthoimagery (public domain):** `https://apps.nationalmap.gov/` — capture `acquisition_date` + tile URL + bbox as a public-domain cross-check freshness layer for counties with no appraiser photo. NAIP cycle is 1–3 yr, state-dependent. Rejection: no `acquisition_date` → reject; resolution too coarse to confirm structure presence → flag as ortho-only (no façade signal).
- **Google Street View Metadata API (governed, gated):** `https://maps.googleapis.com/maps/api/streetview/metadata?location={lat,lng}&key={API_KEY}` → `{pano_id, date, location, copyright, status}`. **Metadata-only** (`pano_id` + `date`); NO image bytes (Static API) without separate ToS/branding sign-off. Freshness: `date` (YYYY-MM). Rejection: ToS review blocks metadata storage → reject; `status:ZERO_RESULTS` → flag, not a hard reject.

## 9. Queue / follow-on sources
- Photo/imagery-metadata track: Miami-Dade pilot VERIFIED CONNECTOR-READY (iter 46); **this Hillsborough pilot DRAFT (iter 129)** — second county appraiser on the track; next county candidate Orange County Property Appraiser FL (`ocpafl.org`), same FL Ch. 119 frame.
- Owner/tax-roll track: 6 county pilots ACHIEVED/VERIFIED (Maricopa AZ LOCKED iter 22/37; Miami-Dade FL VERIFIED iter 47; Clark NV; Harris TX; Santa Clara CA; Los Angeles CA iter 122); Hillsborough tax-roll candidate `owner-taxroll-candidate-hillsborough-fl-2026-06-27.md` (iter 103) remains a CANDIDATE pending live bulk-endpoint confirmation — this photo pilot reuses its APN/domain grounding.
- On-market track: RESO pilot VERIFIED (build-time blockers: per-MLS base URL + OAuth2 + DUA; RentCast 401); HUD HomeStore DRAFT PILOT (iter 128) pending FOIA bulk-path + nightly-cadence confirmation; USDA-RD (G2) + GSA Auctions (G3) DRAFT.
- Build-time blockers carried (not discovery): Google Maps Platform key/ToS for Street View metadata Candidate C; per-MLS RESO credentials; RentCast API key.

## Files
- This manifest: `data/source-registry/pilot-manifest-photo-imagery-hillsborough-fl-2026-06-27.md` (GLM iter 129, DRAFT PILOT).
- Discovery memo: `data/source-registry/photo-imagery-metadata-candidate-2026-06-27.md` (Candidate A; `hcpafl.org` domain pattern).
- Template mirrored (VERIFIED): `data/source-registry/pilot-manifest-photo-imagery-miamidade-2026-06-27.md`.
- Jurisdiction grounding (verified registry row): `hillsborough-fl-violations` in `data/source-registry/county-source-registry.jsonl` (FIPS 12057, FL, ArcGIS, public_official_api, confidence high).
- APN/domain grounding reuse: `data/source-registry/owner-taxroll-candidate-hillsborough-fl-2026-06-27.md` (iter 103).

## Exclusions
No scraping of Zillow/Redfin/Realtor.com/CoStar or people-search/aggregator imagery. No MLS/IDX photo ingestion (IDX-governed, out of scope for this lawful-discovery track). No hostile scraping / CAPTCHA evasion. Official/public-record sources only; metadata-only (no image bytes from governed sources); owner PII gated; B2B files preserved.

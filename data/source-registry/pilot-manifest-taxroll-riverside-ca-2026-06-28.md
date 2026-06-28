# Pilot Manifest — Owner / Tax-Roll Connector — Riverside County, CA (FIPS 06065)

**Status:** DRAFT CONNECTOR-READY (GLM iter 196, 2026-06-28)
**Promoted from:** `data/source-registry/owner-taxroll-candidate-2026-06-27.md` (candidate class: county tax-collector/treasurer delinquent-tax & tax-deed sale lists + county property appraiser/assessor public roll).
**Pilot county rationale:** Riverside County CA is the **#4 raw-harvest source by volume (1,864 rows, `riverside-ca-parcels`)** per `data/source-registry/property-intelligence-status.md`. The existing RivCoGIS Current_Parcels ArcGIS layer exposes `SITUS_ADDRESS` / `SITUS_CITY_NM` / `SITUS_ZIP_NR` + parcel_id but **`has_owner: false`, `has_owner_mailing_address: false`** (`owner-fieldmap-audit.jsonl`, FIPS 06065). `owner-join-plan-active-sources.md` line 16 explicitly flags: *"riverside-ca-parcels | 1,864 | parcels | Riverside CA | no | Current parcels have situs address/city/ZIP, no owner; need assessor/tax-roll source."* This manifest is the lawful path to close that owner gap. **Non-duplicate** — the 8 existing verified tax-roll pilots (Maricopa AZ, Miami-Dade FL, Clark NV, Harris TX, Los Angeles CA, Santa Clara CA, Cook IL, Hillsborough FL) + 1 DRAFT (Orange CA, iter 191) do not cover Riverside CA. Named as the next uncovered top-10 harvest county in the candidate file's "Next step" and in `pilot-manifest-taxroll-orange-ca-2026-06-28.md` §9.

**Lawful basis:** California public-records + tax code. (a) Assessor secured assessment roll is a public record under CA Gov. Code §6254.21 and Rev. & Tax. Code (RTC) §408; statutorily mandated tax-sale notices (RTC §3701 publication) are public records under RTC §3691 (power to sell) / §3727 (sale). (b) **Owner mailing address is restricted** from bulk electronic redistribution under RTC §408.1(a) and §2192 — capture for internal gated CRM use only; **do not republish raw mailing PII**. Owner **name**, situs, APN, and assessed value remain public.

---

## §1. Official source & provenance

| Role | Official body | Domain (lawful county/gov) |
|---|---|---|
| Owner + parcel + assessed roll | Riverside County Assessor–County Clerk-Recorder (ACRe) | `https://www.riversideacre.com/` |
| Tax-defaulted / power-to-sell list + auction | Riverside County Treasurer–Tax Collector (Auditor-Controller / Treasurer-Tax Collector) | `https://www.countyofriverside.us/` (Treasurer-Tax Collector department page; confirm subpath at onboarding) |
| Bulk open-data portal (Assessor parcels + roll) | RivCoGIS / County of Riverside GIS Open Data (ArcGIS hub) | `https://gis-countyofriverside.opendata.arcgis.com/` , `https://gis.rivco.org/` |

All three are official county-operated domains. No third-party aggregator, no Zillow/Redfin/Realtor.com/CoStar, no people-search sites. (Exact dataset slugs / department subpaths reorganize over time — confirm live URLs at onboarding before the first pull, per §7.)

## §2. Bulk / API / public-record access path

**A. Assessor secured roll (owner name + APN + situs + value):**
- RivCoGIS Open Data bulk download: `https://gis-countyofriverside.opendata.arcgis.com/` → "Riverside County Parcels" / secured-roll parcel feature layer; prefer the bulk CSV/GeoJSON export over per-feature paging.
- Public-records request fallback: ACRe Public Service counter / online request form (`https://www.riversideacre.com/`) for the secured-roll extract (owner name field public under §408; mailing address field withheld from bulk electronic redistribution per RTC §408.1).
- Existing RivCoGIS Current_Parcels ArcGIS layer is retained for **situs + geometry only** (owner not present — keep current `riverside-ca-parcels` registry row as the situs/geometry join key, do not overwrite).

**B. Tax-defaulted property / power-to-sell list (delinquent amount + sale date):**
- Treasurer–Tax Collector "Tax-Defaulted Property" / "Power to Sell" section on `https://www.countyofriverside.us/` (Auditor-Controller / Treasurer-Tax Collector department). The TT-C posts the parcel roster (PDF/CSV or via its auction host) ahead of each sale under RTC §3701 publication requirements.
- Redemption-period status and auction date are published with the roster. Prefer the TT-C-published roster; the third-party auction host (e.g., Bid4Assets-style) is used only to read public sale metadata, not to scrape bidder PII.

**Access method:** official bulk download / public-records request only. No hostile scraping; respect robots.txt and county terms-of-use; rate-limit; record `source_pull_ts` per fetch.

## §3. Field map → CODEX-required fields

| CODEX field | Source A (Assessor roll) | Source B (TT-C tax-defaulted list) |
|---|---|---|
| `owner` (name of record) | Assessor secured-roll `OWNER` / `ASSESEE` field (public) | Owner of record column on the tax-defaulted roster |
| `parcel_id` (APN) | Assessor `APN` (book-page-parcel) | `APN` on roster |
| `situs` (property address) | Assessor `SITUS` / `SITE_ADDRESS` (join to existing RivCoGIS `riverside-ca-parcels` geometry) | Situs address on roster |
| `delinquent_amount` | — (not on roll) | TT-C delinquent taxes + penalties column |
| `sale_date` | — | TT-C auction / power-to-sell date |
| `assessed_value` (secondary) | Assessor roll `TOTAL_VALUE` / `ASSESD_VALUE` | — |
| `owner_mailing` (gated) | Assessor mailing field — **internal gated only**, no republish (RTC §408.1/§2192) | — |

Join A↔B on `APN`; join to harvest `riverside-ca-parcels` on `APN` or `SITE_ADDRESS`.

## §4. Freshness field

- **Authoritative freshness anchor (tax-defaulted lane):** `sale_date` (TT-C auction/power-to-sell date) + `published_date` (roster posting date). Sale cadence = periodic (TT-C runs tax-defaulted sales on a published schedule; verify cycle at onboarding).
- **Roll freshness (assessor lane):** `roll_year` (lien date Jan 1) + `assessment_year`; capture `source_pull_ts` (`last_fetched`) per county per pull.
- Connector re-poll: assessor roll annually (or per published roll update); TT-C roster each sale cycle. Record `last_fetched` in the connector manifest.

## §5. Robots / terms note

- Honor `robots.txt` on `riversideacre.com`, `countyofriverside.us`, `gis-countyofriverside.opendata.arcgis.com`, `gis.rivco.org`.
- Respect county terms-of-use; prefer bulk download / public-records request over per-record crawl; rate-limit (≥1s between requests; no concurrent hammering).
- **CA PII gating:** owner **name** + situs + APN + assessed value are public and storable. Owner **mailing address** is restricted from bulk electronic redistribution under RTC §408.1(a) / §2192 — store internally for gated CRM outreach only; **never** republish raw mailing PII to unscoped surfaces or B2B files. Owner contact fields stay gated per agent constraints.
- Preserve B2B files untouched; this is a net-new public-records layer.

## §6. Rejection criteria (GO/NO-GO)

Reject this pilot and pick an alternate CA county assessor/TT-C (LA, Orange, Santa Clara already on file; San Bernardino, Alameda, San Diego are the other uncovered top-10 harvest sources — see `owner-join-plan-active-sources.md`) if **any** is true:
1. Source re-hosts Zillow / Redfin / Realtor.com / CoStar or people-search data.
2. Requires hostile scraping / captcha-breaking to retrieve the roll or roster.
3. No freshness field exists (no `roll_year` / `published_date` / `sale_date`).
4. Owner name is gated behind a paid non-public API with no public-records alternative.
5. County terms prohibit CRM / wholesale internal use of the roll (would violate RTC public-records intent — unlikely for CA assessor rolls, but verify).
6. APN or situs missing from both the roll and the roster (cannot join to harvest).
7. TT-C roster is PDF-only behind a captcha with no PR-request alternative.

## §7. Connector build steps

1. Confirm live RivCoGIS Open Data Assessor secured-roll dataset slug + bulk export format at `https://gis-countyofriverside.opendata.arcgis.com/` (confirm at onboarding — dataset slugs reorganize).
2. Confirm Treasurer–Tax Collector tax-defaulted-property roster page subpath + format (CSV/PDF) on `https://www.countyofriverside.us/`; record the auction-host domain for public sale-metadata reads only.
3. File a public-records request with ACRe if the bulk roll omits owner name (owner name is public under §408; mailing address withheld under §408.1).
4. Map fields per §3; join A↔B on `APN`; join to `riverside-ca-parcels` harvest rows on `APN`/`SITE_ADDRESS`.
5. Apply §4 freshness anchors; stamp `last_fetched` per pull.
6. Enforce §5 PII gating (mailing address internal-only) and §6 rejection criteria.
7. Stamp manifest VERIFIED CONNECTOR-READY once live URLs + field map are confirmed.

## §8. Join / cross-pilot notes

- Pairs with existing `riverside-ca-parcels` registry row (situs + geometry) — this manifest supplies the owner + APN + roll layer the parcel layer lacks.
- Same CA frame portability as `pilot-manifest-taxroll-losangeles-ca-2026-06-27.md`, `pilot-manifest-taxroll-santaclara-ca-2026-06-27.md`, and `pilot-manifest-taxroll-orange-ca-2026-06-28.md` (CA RTC §408/§408.1/§2192 PII gating applies to all CA assessor rolls).
- Photo/imagery sidecar: pair with county appraiser parcel photos once Riverside CA appraiser imagery endpoint is confirmed (mirrors Miami-Dade / Hillsborough FL photo pilots).

## §9. Queue (unchanged, build-time not discovery)

- On-market RESO/RentCast feed: build-time OAuth2/DUA + RentCast 401 key rotation (see `pilot-manifest-onmarket-reso-2026-06-27.md` §10–§11; `councilRoom/agents/GLM/onmarket-build-readiness-2026-06-28.md`).
- Photo/imagery metadata: build-time Maps Platform key + NAIP/NOAA endpoint confirmation (see `councilRoom/agents/GLM/photo-imagery-build-readiness-2026-06-28.md`).
- Additional uncovered top-10 harvest counties (San Bernardino CA, Alameda CA, San Diego CA, NYC NY) — promote on future loops if owner gap persists after Riverside CA pilot build.

**Compliance:** official/public county `.gov` sources only; no Zillow/Redfin/Realtor.com/CoStar; no people-search sites; no hostile scraping; owner mailing PII gated per CA RTC §408.1/§2192; B2B files preserved.

## Files
- This manifest: `data/source-registry/pilot-manifest-taxroll-riverside-ca-2026-06-28.md` (GLM iter 196, 2026-06-28).
- Promoted from: `data/source-registry/owner-taxroll-candidate-2026-06-27.md` (Next step — promote next uncovered top-10 harvest county).
- Template mirrored: `data/source-registry/pilot-manifest-taxroll-orange-ca-2026-06-28.md` (iter 191, same CA lawful frame).
- Harvest-layer owner-gap evidence: `data/source-registry/owner-fieldmap-audit.jsonl` (FIPS 06065, `has_owner: false`), `data/source-registry/owner-join-plan-active-sources.md` (line 16).

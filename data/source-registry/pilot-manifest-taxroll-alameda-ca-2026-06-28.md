# Pilot Manifest — Owner / Tax-Roll Connector — Alameda County, CA (FIPS 06001)

**Status:** DRAFT CONNECTOR-READY (GLM iter 198, 2026-06-28)
**Promoted from:** `data/source-registry/owner-taxroll-candidate-2026-06-27.md` (candidate class: county tax-collector/treasurer delinquent-tax & tax-deed sale lists + county property appraiser/assessor public roll).
**Pilot county rationale:** Alameda County CA is the **#5 raw-harvest source by volume (1,860 rows, `alameda-ca-parcels`)** per `data/source-registry/property-intelligence-status.md` (population ~1.7M, contains Oakland). The existing ArcGIS parcels layer (`https://services5.arcgis.com/ROBnTHSNjoZ2Wm1P/arcgis/rest/services/Parcels/FeatureServer`) is a single-layer "Parcel Boundaries" publication (42 fields) that is `has_owner: false`, `has_mailing: false`, `has_value: false`, `status: "no_owner_in_any_layer"` (`layer-discovery-results.jsonl`, `owner-fieldmap-audit.jsonl`). `owner-join-plan-active-sources.md` explicitly flags: *"Alameda CA | no | Public parcel layer has APN/situs/use code, no owner; need assessor/tax-roll source."* This manifest is the lawful path to close that owner gap. **Non-duplicate** — existing tax-roll pilots on disk (Maricopa AZ, Miami-Dade FL, Clark NV, Harris TX, Los Angeles CA, Santa Clara CA, Cook IL, Hillsborough FL [VERIFIED]; Orange CA, Riverside CA [DRAFT]) do not cover Alameda CA.

**Lawful basis:** California public-records + tax code. (a) Assessor secured assessment roll is a public record under CA Gov. Code §6254.21 and Rev. & Tax. Code (RTC) §408; statutorily mandated tax-sale notices (RTC §3701 publication) are public records under RTC §3691 (power to sell) / §3727 (sale). (b) **Owner mailing address is restricted** from bulk electronic redistribution under RTC §408.1(a) and §2192 — capture for internal gated CRM use only; **do not republish raw mailing PII**. Owner **name**, situs, APN, and assessed value remain public.

---

## §1. Official source & provenance

| Role | Official body | Domain (lawful .gov) |
|---|---|---|
| Owner + parcel + assessed roll | Alameda County Assessor's Office | `https://www.acgov.org/assessor/` |
| Tax-defaulted / power-to-sell list + auction | Alameda County Treasurer–Tax Collector | `https://www.acgov.org/taxcollector/` |
| Bulk open-data portal (Assessor parcels + roll) | Alameda County Open Data Hub / AC Maps GIS | `https://data.acgov.org/` , `https://www.acgov.org/maps/` |

All three are official `.gov` / county-operated domains. No third-party aggregator, no Zillow/Redfin/Realtor.com/CoStar, no people-search sites.

## §2. Bulk / API / public-record access path

**A. Assessor secured roll (owner name + APN + situs + value):**
- Alameda County Open Data Hub bulk download: `https://data.acgov.org/` → Assessor "Secured Assessment Roll" / parcel feature layer (search "Assessor Parcel" / "Secured Roll"). Prefer the bulk CSV/GeoJSON export over per-feature paging.
- Public-records request fallback: Assessor Public Service counter / online request form (`https://www.acgov.org/assessor/`) for the secured-roll extract (owner name field public; mailing address field withheld from bulk electronic redistribution per RTC §408.1).
- Existing ArcGIS parcels FeatureServer (`https://services5.arcgis.com/ROBnTHSNjoZ2Wm1P/arcgis/rest/services/Parcels/FeatureServer`) is retained for **situs + geometry only** (owner not present — keep current `alameda-ca-parcels` registry row as the situs/geometry join key, do not overwrite).

**B. Tax-defaulted property / power-to-sell list (delinquent amount + sale date):**
- Treasurer–Tax Collector "Tax Sales" / "Tax-Defaulted Property" page: `https://www.acgov.org/taxcollector/` → Tax-Defaulted Properties / Power to Sell section. The TT-C posts the parcel roster (PDF/CSV or via its auction host) ahead of each sale under RTC §3701 publication requirements.
- Redemption-period status and auction date are published with the roster. Prefer the TT-C-published roster; the third-party auction host (e.g., Bid4Assets-style) is used only to read public sale metadata, not to scrape bidder PII.

**Access method:** official bulk download / public-records request only. No hostile scraping; respect robots.txt and county terms-of-use; rate-limit; record `source_pull_ts` per fetch.

## §3. Field map → CODEX-required fields

| CODEX field | Source A (Assessor roll) | Source B (TT-C tax-defaulted list) |
|---|---|---|
| `owner` (name of record) | Assessor secured-roll `OWNER` / `ASSESEE` field (public) | Owner of record column on the tax-defaulted roster |
| `parcel_id` (APN) | Assessor `APN` (book-page-parcel) | `APN` on roster |
| `situs` (property address) | Assessor `SITUS` / `SITUSADDRESS` (join to existing ArcGIS `alameda-ca-parcels` geometry) | Situs address on roster |
| `delinquent_amount` | — (not on roll) | TT-C delinquent taxes + penalties column |
| `sale_date` | — | TT-C auction / power-to-sell date |
| `assessed_value` (secondary) | Assessor roll `TOTAL_VALUE` / `ASSESD_VALUE` | — |
| `owner_mailing` (gated) | Assessor mailing field — **internal gated only**, no republish (RTC §408.1/§2192) | — |

Join A↔B on `APN`; join to harvest `alameda-ca-parcels` on `APN` or `SITUSADDRESS`.

## §4. Freshness field

- **Authoritative freshness anchor (tax-defaulted lane):** `sale_date` (TT-C auction/power-to-sell date) + `published_date` (roster posting date). Sale cadence = periodic (TT-C runs tax-defaulted sales on a published schedule; verify cycle at onboarding).
- **Roll freshness (assessor lane):** `roll_year` (lien date Jan 1) + `assessment_year`; capture `source_pull_ts` (`last_fetched`) per county per pull.
- Connector re-poll: assessor roll annually (or per published roll update); TT-C roster each sale cycle. Record `last_fetched` in the connector manifest.

## §5. Robots / terms note

- Honor `robots.txt` on `acgov.org`, `taxcollector.acgov.org` (subpath of acgov.org), `data.acgov.org`.
- Respect county terms-of-use; prefer bulk download / public-records request over per-record crawl; rate-limit (≥1s between requests; no concurrent hammering).
- **CA PII gating:** owner **name** + situs + APN + assessed value are public and storable. Owner **mailing address** is restricted from bulk electronic redistribution under RTC §408.1(a) / §2192 — store internally for gated CRM outreach only; **never** republish raw mailing PII to unscoped surfaces or B2B files. Owner contact fields stay gated per agent constraints.
- Preserve B2B files untouched; this is a net-new public-records layer.

## §6. Rejection criteria (GO/NO-GO)

Reject this pilot and pick an alternate CA county assessor/TT-C (LA, Orange, Riverside, Santa Clara already on file; San Bernardino, San Diego are the other uncovered top-10 harvest sources — see `owner-join-plan-active-sources.md`) if **any** is true:
1. Source re-hosts Zillow / Redfin / Realtor.com / CoStar or people-search data.
2. Requires hostile scraping / captcha-breaking to retrieve the roll or roster.
3. No freshness field exists (no `roll_year` / `published_date` / `sale_date`).
4. Owner name is gated behind a paid non-public API with no public-records alternative.
5. County terms prohibit CRM / wholesale internal use of the roll (would violate RTC public-records intent — unlikely for CA assessor rolls, but verify).
6. APN or situs missing from both the roll and the roster (cannot join to harvest).
7. TT-C roster is PDF-only behind a captcha with no PR-request alternative.

## §7. Connector build steps

1. Confirm live Alameda County Open Data Hub Assessor secured-roll dataset slug + bulk export format at `https://data.acgov.org/` (confirm at onboarding — dataset slugs reorganize).
2. Confirm TT-C tax-defaulted-property roster page subpath + format (CSV/PDF) at `https://www.acgov.org/taxcollector/`; record the auction-host domain for public sale-metadata reads only.
3. File a public-records request with the Assessor if the bulk roll omits owner name (owner name is public under §408; mailing address withheld under §408.1).
4. Map fields per §3; join A↔B on `APN`; join to `alameda-ca-parcels` harvest rows on `APN`/`SITUSADDRESS`.
5. Apply §4 freshness anchors; stamp `last_fetched` per pull.
6. Enforce §5 PII gating (mailing address internal-only) and §6 rejection criteria.
7. Stamp manifest VERIFIED CONNECTOR-READY once live URLs + field map are confirmed.

## §8. Join / cross-pilot notes

- Pairs with existing `alameda-ca-parcels` registry row (situs + geometry) — this manifest supplies the owner + APN + roll layer the parcel layer lacks.
- Same CA frame portability as `pilot-manifest-taxroll-losangeles-ca-2026-06-27.md`, `pilot-manifest-taxroll-santaclara-ca-2026-06-27.md`, `pilot-manifest-taxroll-orange-ca-2026-06-28.md`, and `pilot-manifest-taxroll-riverside-ca-2026-06-28.md` (CA RTC §408/§408.1/§2192 PII gating applies to all CA assessor rolls).
- Photo/imagery sidecar: pair with county appraiser parcel photos once Alameda CA appraiser imagery endpoint is confirmed (mirrors Miami-Dade / Hillsborough FL photo pilots).

## §9. Queue (unchanged, build-time not discovery)

- On-market RESO/RentCast feed: build-time OAuth2/DUA + RentCast 401 key rotation (see `pilot-manifest-onmarket-reso-2026-06-27.md` §11).
- Photo/imagery metadata: build-time Maps Platform key + NAIP/NOAA/NYS-GIS endpoint confirmation.
- Remaining uncovered top-10 harvest counties (San Bernardino CA, San Diego CA, NYC NY) — promote on future loops if owner gap persists after Alameda CA pilot build.

**Compliance:** official/public `.gov` sources only; no Zillow/Redfin/Realtor.com/CoStar; no people-search sites; no hostile scraping; owner mailing PII gated per CA RTC §408.1/§2192; B2B files preserved.

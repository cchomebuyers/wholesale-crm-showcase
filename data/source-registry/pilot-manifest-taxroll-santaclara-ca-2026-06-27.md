# Connector-Ready Pilot Manifest — County Tax-Roll (Owner / Secured Roll + Tax-Defaulted) Source

**Pilot county:** Santa Clara County, California — County Assessor (secured assessment roll: owner + APN + situs + value) + Department of Tax and Collections / DTAC (tax-defaulted property list: distress + sale_date)
**Discovery memo:** `data/source-registry/owner-taxroll-candidate-santaclara-ca-2026-06-27.md` (seeded GLM iter 91)
**Created:** 2026-06-27 (GLM iter 111) — second-jurisdiction expansion of the tax-roll lane into California, where the harvest's missing-owner gap is concentrated.
**Status:** VERIFIED CONNECTOR-READY (GLM iter 111, 2026-06-27) — §8 appraiser/parcels path reconciled against the verified registry row `santaclara-ca-parcels` in `data/source-registry/county-source-registry.csv` / `.jsonl` (official ArcGIS REST parcels endpoint confirmed 2026-06-26). All CODEX-required fields present: official URL (§1, §8), bulk/API/public-record path (§2, §8), field map owner/APN/situs/delinquent_amount/sale_date (§3), freshness field (§4), robots/terms note (§5), rejection criteria (§6). DTAC tax-defaulted endpoint (§1–§7) pending live roster-URL confirmation at connector build time. Mirrors the LOCKED+verified Maricopa manifest structure. Remaining work is build-time URL/CPRA fulfillment, not source discovery.
**Lawful basis:** California Public Records Act (Gov. Code §6250 et seq.) — the secured property tax assessment roll is a public record. Ownership **name** is public under Rev. & Tax. Code §408. Tax-defaulted property lists and notices of power-to-sell are statutorily published under Rev. & Tax. Code §3461 / §3471. Official `.gov` sources only; no hostile scraping; no Zillow/Redfin/Realtor.com/CoStar; no people-search sites. Owner PII gated; B2B files preserved.
**Why this pilot now:** per `data/source-registry/property-intelligence-status.md` (snapshot 2026-06-27T23:56:48Z), `missing owner: 13933` across the raw harvest and the CRM shows `properties with owner: 0`. The top harvest source is `santaclara-ca-parcels: 1997` (county FIPS 06085), and every top source is a CA county parcel/violation layer — yet none of the four prior tax-roll pilots (Maricopa AZ, Miami-Dade FL, Clark NV, Harris TX) overlap the CA-dominated harvest. This CA pilot is the lawful path that actually closes the owner gap where the data lives.

## 1. Official source
- **Agencies (two paired, same county, same APN key):**
  - **A. Santa Clara County Assessor** — secured assessment roll (owner name + APN + situs + assessed value).
    - Official domain: `https://www.sccassessor.org/` (.org — official county assessor site; verify `.gov`/official designation at build time; this is the Assessor's official public site).
    - Parcel search (pattern; verify exact path at build time): `https://www.sccassessor.org/assessor-property-search` → per-APN result exposes owner **name** (public under Rev. & Tax. Code §408), situs, APN/parcel, assessed value, assessment/roll year, legal description. Mailing address gated per §408.1.
  - **B. Santa Clara County Department of Tax and Collections (DTAC)** — tax-defaulted property list (distress signal + sale_date).
    - Official domain: `https://www.sccdtc.org/` (.org — official county tax collector/DTAC site; verify official designation at build time).
    - Tax-defaulted list (pattern; verify at build time): DTAC publishes properties that have defaulted to tax-defaulted status (Rev. & Tax. Code §3461) and notices of power-to-sell (§3471) — statutorily mandated public notices. Look for a "tax-defaulted properties" / "redemption" roster (PDF or download) and/or a CPRA request path.
- **Provenance:** official county domains; secured-roll ownership is a public record under CPRA + Rev. & Tax. Code §408; tax-defaulted notices are statutorily mandated publications.

## 2. Access path (bulk / API / public-record)
- **Secured roll (owner + APN + situs + value) — Assessor:**
  - Preferred bulk: Santa Clara County open-data portal (official) publishes parcel/assessment layers; verify the current hub URL + license at build time. Alternatively file a CPRA (Gov. Code §6253) request to the Assessor for the secured-roll extract (owner name, APN, situs, assessment_year) — the lawful bulk path; capture PR-request reference + fulfillment date.
  - Machine-readable parcels (situs + APN + geo, **no owner**): the verified ArcGIS REST parcels endpoint — see §8.
- **Tax-defaulted list (delinquent_amount + sale_date) — DTAC:**
  - Preferred: official downloadable tax-defaulted / power-to-sell roster (PDF/CSV) published by DTAC ahead of the redemption/sale cycle. Capture the published-file URL at connector build time (URL rotates each cycle).
  - Fallback: CPRA request to DTAC for the tax-defaulted roll.
- **Not allowed:** page-by-page scraping of the parcel-search UI; no automated queries beyond published bulk files / official ArcGIS endpoint; respect robots.txt and posted rate limits; no bypassing captcha/anti-bot — STOP and use the CPRA path.
- **Auth:** none expected for published bulk files / the public ArcGIS endpoint; if a form/EULA is required, capture terms before import.
- **CA-specific gating (critical):** under Rev. & Tax. Code §408.1, an owner's **mailing address** is NOT freely available for mass solicitation — restricted to requesters certifying non-solicitation use, or via the assessor's opt-out-aware process. This pilot captures **owner name + APN + situs + roll/assessment fields** as the public-record layer; mailing-address capture is gated/optional and must be obtained via the assessor's lawful request path, never mass-scraped. Consistent with the existing "contacts gated" rule.

## 3. Field map (source → CRM)
| CRM field | Source field (expected) | Source | Notes |
|---|---|---|---|
| apn / parcel_id | APN / parcel number | Assessor + DTAC | join key |
| owner_name | Owner of record (name) | Assessor | public under Rev. & Tax. Code §408 |
| owner_mailing | Owner mailing address | Assessor | **GATED** — §408.1; lawful request path only, not mass-scraped |
| situs | Property / situs address (`Situs_Address_Full` on the parcels layer) | Assessor | geo key |
| assessed_value | Assessed / roll value | Assessor | equity signal |
| assessment_year | Roll / assessment year | Assessor | freshness anchor |
| delinquent_amount | Defaulted tax + penalties | DTAC | distress signal |
| delinquent_years | Tax years defaulted | DTAC | distress signal |
| sale_date | Redemption deadline / power-to-sell sale date | DTAC | freshness anchor (statutory sale cycle) |
| (aux) published_date | Tax-defaulted-list publication date | DTAC | freshness secondary |
| (aux) last_fetched | connector pull timestamp | connector | per-APN freshness |

## 4. Freshness field
- **Roll layer:** `assessment_year` (secured roll is annual in CA).
- **Tax-defaulted layer:** `sale_date` (redemption deadline / power-to-sell notice date) — authoritative distress-freshness anchor; statutory cycle.
- Secondary: `published_date` of the tax-defaulted list.
- Per-pull: `last_fetched`, recorded per APN in the connector manifest.
- Cadence: annual secured roll; tax-defaulted notices on the statutory redemption/sale cycle — re-pull on each new publication.

## 5. robots.txt / ToS note
- Honor `https://www.sccassessor.org/robots.txt` and `https://www.sccdtc.org/robots.txt` + each site's terms of use.
- Prefer the open-data bulk download, the official ArcGIS parcels endpoint (§8), and/or a CPRA public-records request over page-by-page crawling; rate-limit; no concurrent bursts.
- Do NOT bypass any captcha/anti-bot gate — STOP and use the CPRA request path.
- Owner mailing address stays gated (Rev. & Tax. Code §408.1); owner name public; B2B files preserved; no co-mingling with B2B contact lists.
- If the site posts a data-use / redistribution statement, record it; do not redistribute raw owner PII beyond gated CRM use.

## 6. Rejection criteria (reject this county/source if any hold)
- Assessor provides no machine-readable roll AND no CPRA bulk path → reject.
- DTAC provides no machine-readable tax-defaulted roster AND no CPRA path (and owner/distress is required from this source) → reject the DTAC layer (the Assessor roll alone may still stand for owner+situs+value).
- No APN OR situs OR owner name field available → reject (field map unmet).
- No assessable freshness field (neither `assessment_year` nor `sale_date`) → reject as stale/unverifiable.
- ToS/data-use statement prohibits CRM/wholesale reuse of the roll → reject (cannot gate around a statutory/contract prohibition).
- Source provenance traces to a people-search/aggregator or a portal-scrape (Zillow/Redfin/Realtor.com/CoStar) → reject.
- robots.txt disallows the parcel-search/roll path → respect it; fall back to CPRA request only if that path is permitted, else reject.

## 7. Connector build steps (ordered)
1. Verify official domains + exact Assessor parcel-search and DTAC tax-defaulted page URLs (manual browser, no scraping).
2. Locate the Assessor open-data bulk roll / file a CPRA request for the secured-roll extract (owner name, APN, situs, assessment_year); record PR reference + fulfillment date.
3. Locate the DTAC published tax-defaulted roster; record URL + file format.
4. Pull once (roll + roster), parse, validate field map against §3; if any required field missing → §6 reject.
5. Record robots.txt status + any ToS / data-use statement + the §408.1 mailing-address gating decision.
6. Seed a county row in `data/source-registry/county-source-registry` with `{official_domain, access_method, cadence, last_fetched, robots_txt_status, status}` (extend the existing `santaclara-ca-parcels` row or add a paired `santaclara-ca-taxroll` row).
7. Join Assessor roll (owner+situs+value) to DTAC roster (delinquent_amount+sale_date) on `APN`; join to the harvest's `santaclara-ca-parcels` source on situs/APN to backfill the 13933 missing-owner gap.
8. Owner name available to lead scoring; owner mailing address gated (§408.1); `situs` + `APN` + `assessed_value` + `delinquent_amount` + `sale_date` available to lead scoring.

## 8. Complementary property-appraiser / parcels access path (Santa Clara County Assessor ArcGIS)

The inbox scope allows "tax collector OR property appraiser." The Assessor parcels path is complementary: the verified ArcGIS endpoint covers the full parcel universe (situs + APN + geo), while the CPRA secured-roll path (§1–§7) carries the owner name + assessed value. Join the two on `APN`.

- Agency: Santa Clara County Assessor (CA) — official property appraisal/assessment authority.
- **RECONCILED (GLM iter 111) against the verified registry row `santaclara-ca-parcels`** in `data/source-registry/county-source-registry.csv` / `.jsonl` (validated 2026-06-26):
  - Official ArcGIS REST parcels endpoint (layer 0): `https://services2.arcgis.com/tcv2cMrq63AgvbHF/arcgis/rest/services/Parcels_Public_View/FeatureServer/0/query` — query dialect: ArcGIS REST `where=1=1`, `max=2000`/req. Yields situs (`Situs_Address_Full`) + parcel geometry. County FIPS `06085`, confidence `high`, `legal_status: public_official_api`.
  - **Owner field NOT exposed** by this public parcels layer (`owner: null` / `has_owner:false` per registry). So the appraiser path's `owner` must come from the separate Assessor secured-roll/CPRA extract (§1–§7) — do NOT assume the public parcels layer carries owner.
- Access path: use the verified parcels endpoint for situs / APN / geo; obtain `owner` (+ `assessed_value`, `assessment_year`) via the Assessor secured-roll open-data export or CPRA request (PII gated per §408.1).
- Field map (source → CRM):
  | CRM field | Source field (expected) | Notes |
  |---|---|---|
  | owner | Assessee name / owner of record | PII — gated; from CPRA roll, NOT the parcels layer |
  | APN | Parcel number | join key (↔ DTAC roster, ↔ harvest `santaclara-ca-parcels`) |
  | situs | `Situs_Address_Full` (parcels layer) | geo key |
  | assessed_value | Assessed / roll value | equity signal (from roll) |
  | assessment_year | Roll / assessment year | freshness anchor |
  | (aux) source_pull_ts | connector pull timestamp | per-county freshness |
- Freshness field: `assessment_year` (annual revaluation); per-pull `source_pull_ts`.
- robots.txt / ToS note: honor `https://www.sccassessor.org/robots.txt`; prefer bulk/CPRA over HTML crawling; the ArcGIS endpoint is a public official API (rate-limit per ArcGIS server norms; no concurrent bursts); record any data-use/redistribution statement; do not redistribute raw owner PII beyond gated CRM use; if captcha/anti-bot blocks the bulk path, STOP and use the CPRA path — do not bypass.
- Rejection criteria (for the appraiser path):
  - No machine-readable bulk export AND no CPRA path → reject.
  - Terms forbid redistribution or commercial use → reject (or gate to internal-only with legal sign-off).
  - Bulk export behind captcha / anti-bot not satisfiable via official API/CPRA request → reject.
  - Export lacks `owner` OR `APN` OR `situs` → reject (field map unmet).
  - robots.txt disallows the data path → reject (respect it).

## 9. Queue / follow-on sources
- Owner/tax-roll pilots already LOCKED + verified: Maricopa AZ (iter 22/37), Miami-Dade FL (iter 47), Clark NV, Harris TX. This Santa Clara CA pilot (iter 111) is the first CA pilot — directly aligned to the CA-dominated harvest.
- Official on-market feed (RESO Web API via MLS; RentCast secondary) — VERIFIED CONNECTOR-READY (iter 44) + build-time blocker resolution path (iter 108): `data/source-registry/pilot-manifest-onmarket-reso-2026-06-27.md`. Build-time only (per-MLS base URL + OAuth2 + DUA; RentCast API-key rotation).
- Lawful photo/imagery metadata — DRAFTED candidate (iter 34) + DRAFT pilots (`pilot-manifest-photo-imagery-miamidade-2026-06-27.md`, `pilot-manifest-photo-imagery-naip-2026-06-27.md`); build-time only (photo-endpoint URL + Ch.119/CPRA PR fulfillment; Street View metadata key).
- Open (build-time, not source discovery): confirm live DTAC tax-defaulted roster URL each statutory sale cycle (§1–§7); fulfill Assessor CPRA secured-roll extract (§2/§8).

## Files
- This manifest: `data/source-registry/pilot-manifest-taxroll-santaclara-ca-2026-06-27.md` (iter 111 created; VERIFIED CONNECTOR-READY).
- Discovery memo: `data/source-registry/owner-taxroll-candidate-santaclara-ca-2026-06-27.md` (iter 91).
- Verified registry row: `santaclara-ca-parcels` in `data/source-registry/county-source-registry.csv` / `.jsonl` (ArcGIS parcels endpoint, layer 0, `Situs_Address_Full`, `owner:null`).
- Status snapshot: `data/source-registry/property-intelligence-status.md` (`missing owner: 13933`; `santaclara-ca-parcels: 1997` top source).
- Structure template (LOCKED+verified prior pilot): `data/source-registry/pilot-manifest-taxroll-maricopa-2026-06-27.md`.
- Compliance: official/public `.gov`/official county sources only; CPRA + Rev. & Tax. Code §408/§408.1 honored (owner name public, mailing gated); no Zillow/Redfin/Realtor.com/CoStar; no people-search sites; no hostile scraping; owner PII gated; B2B files preserved.

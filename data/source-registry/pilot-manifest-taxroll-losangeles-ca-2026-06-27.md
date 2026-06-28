# Pilot Manifest — Owner / Tax-Roll — Los Angeles County, CA (2nd CA county)

- **Status:** DRAFT connector-ready (authored GLM iter 122, 2026-06-27)
- **Focus lane:** lawful owner/tax-roll source candidate (official county tax collector / property appraiser)
- **Motivation:** Harvest owner gap is CA-concentrated (`missing owner: 13933`; all top harvest sources CA; only Santa Clara CA is a pilot — iter 111). This is the 2nd California county pilot and the 6th owner/tax-roll pilot overall (Maricopa AZ LOCKED+VERIFIED iter 22/37; Miami-Dade FL iter 47; Clark NV; Harris TX; Santa Clara CA iter 111).
- **Lawful basis:** California Public Records Act (Gov. Code §6253); Rev. & Tax. Code §408 (ownership/assessment public record), §408.1 (confidential mailing address — gated), §3691 et seq. (tax collector's power of sale / public auction of tax-defaulted property).
- **Jurisdiction grounding:** registry row `losangeles-ca-violations` in `data/source-registry/county-source-registry.csv`/.jsonl — county_fips `06037`, state CA, Los Angeles County, population_rank 1 (Socrata code-violations layer; reused here only to ground FIPS/jurisdiction; APN-joinable to tax-roll/assessor data below).

---

## §1. Official source URLs (verify deep links at connector onboarding)

- **LA County Office of the Assessor** (ownership + APN + situs + assessment): `https://assessor.lacounty.gov/`
  - Public lookup: Assessor's "Property Assessment Information System" / e-Property Index (search by APN or situs address). Official `.gov`.
- **LA County Treasurer and Tax Collector** (tax-defaulted property sales — delinquent amount + sale_date): `https://ttc.lacounty.gov/`
  - Path: "Tax-Defaulted Property" / "Public Auction" pages → published **Publication List** of properties to be offered at tax-sale (statutorily required public notice, Rev. & Tax. Code §3701). Official `.gov`.
- **LA County Open Data / GIS** (parcel polygon + situs; ownership usually NOT exposed in open layer): `https://egis3.lacounty.gov/` and `https://data.lacounty.gov/` (LA County open-data portal; ArcGIS REST / Socrata endpoints).

All official `.gov`/`.ca.us` county domains. No third-party aggregator, no Zillow/Redfin/Realtor.com/CoStar, no people-search sites.

## §2. Access path (bulk / API / public-record)

- **Assessor secured roll (owner + APN + situs + assessed value + sale date):** obtained via **CPRA public-records request** to the Assessor (Gov. Code §6253) for the Secured Annual Assessment Roll extract (CSV/shapefile; fields incl. `AIN` [Assessor Identification Number = APN-equivalent], owner name, situs, assessed value, `LAND_BASE_YR`/assessment_year, last sale date/price). Owner **name** is public (§408); confidential **mailing address** is gated (§408.1) — store mailing PII in gated field, do not expose in B2B/wholesale views.
- **Tax-defaulted property sale list (delinquent amount + sale_date):** published **Publication List** on `ttc.lacounty.gov` (downloadable PDF/XLS of properties scheduled for public auction; statutory notice). Access = official download (no login) + CPRA for machine-readable bulk. Fields: APN/AIN, owner of record, minimum bid / delinquent amount, auction date (sale_date).
- **Parcel polygon / situs (GIS):** LA County open-data ArcGIS REST `Parcel` layer (APN/AIN + situs address; `owner:null` expected on the open layer → owner comes from the CPRA roll, not the GIS layer). Confirm exact service/layer name at onboarding.

Prefer **bulk download / CPRA request** over any crawl; rate-limit; store `source_pull_ts`.

## §3. Field map → CODEX-required fields

| Required field | Source | LA County field (confirm at onboarding) |
|---|---|---|
| owner | Assessor secured roll (CPRA) | `OWNER_NAME` (name public §408; mailing gated §408.1) |
| APN | Assessor / Tax Collector / GIS | `AIN` (Assessor Identification Number) |
| situs | Assessor / GIS parcel layer | `SITUS_ADDRESS` / `SitusAddress` |
| delinquent amount | Tax Collector tax-defaulted Publication List | delinquent taxes / minimum bid column |
| sale_date | Tax Collector public auction | auction/sale date (statutory tax-sale notice) |
| (aux) assessed_value / last_sale_date | Assessor roll | `TOTAL_VALUE` / `LAST_SALE_*` |
| join key | APN/AIN across all three layers | `AIN` |

## §4. Freshness field

- **Tax-collector path:** `sale_date` (auction date) is the authoritative freshness anchor for the tax-defaulted list; plus `published_date` of the Publication List and `last_fetched` (our pull timestamp). Tax-sale cadence is recurring (auctions multiple times/year per TTLC schedule).
- **Assessor path:** `assessment_year` / roll year + `last_sale_date` + `source_pull_ts`.

## §5. Robots / terms note

- Official `.gov` county domains; honor `robots.txt` and each department's terms-of-use. Prefer **bulk download / CPRA request** over any portal crawling; no hostile scraping; rate-limit and backoff; no CAPTCHA evasion.
- Owner **name** public under §408; **mailing address** confidential under §408.1 — gate mailing PII; do not redistribute raw mailing data into B2B/wholesale CRM views. Preserve B2B files untouched.

## §6. Rejection criteria (reject this pilot and pick an alternate CA county if any hold)

- Publication List is **PDF-only behind CAPTCHA / login** with no CPRA bulk path → reject (prefer CPRA bulk; if TTLC refuses machine-readable bulk, fall back to Alameda or San Diego County).
- Terms **forbid redistribution / commercial reuse** of the roll → reject for the wholesale-CRM track (note: §408/§408.1 govern public-record access, not redistribution; confirm with County Counsel if ambiguous).
- **No freshness field** (no sale_date / no assessment_year / no published_date) → reject.
- Source is an **aggregator / people-search** site or re-hosts Zillow/Redfin/Realtor.com/CoStar data → reject (out of policy).
- **APN or situs missing** from the roll → reject.
- Owner **gated behind a paid non-public API** (commercial reseller) → reject (not an official-free source).

## §7. Connector build steps (build-time, not discovery)

1. File CPRA request with LA County Assessor for Secured Annual Assessment Roll extract (AIN + owner name + situs + assessed value + sale date + assessment_year); gate mailing per §408.1.
2. Pull TTLC tax-defaulted Publication List (PDF/XLS) from `ttc.lacounty.gov`; parse APN/AIN + owner of record + delinquent amount + sale_date.
3. Pull LA County open-data Parcel GIS layer (APN/AIN + situs); confirm `owner:null` → owner sourced from step 1.
4. Join all three on `AIN`; emit `source_pull_ts`; store owner/mailing PII in gated fields; expose only owner **name** + APN + situs + delinquent_amount + sale_date in wholesale views.
5. Validate one APN end-to-end against the Assessor public lookup before enabling the connector.

## §8. Appraiser / parcels reconciliation (registry)

- Open parcels layer expected `owner:false` (owner name not exposed on the public GIS layer) → owner must come from the **CPRA secured roll**, not the GIS layer (same pattern as Santa Clara CA, Maricopa AZ). APN/AIN is the join key across the violations registry row (`losangeles-ca-violations`), the assessor roll, and the TTLC tax-defaulted list — enabling owner enrichment + delinquency flagging on existing harvest parcels.

## §9. Queue (not started this loop)

- On-market RESO/RentCast/official MLS feed (VERIFIED connector-ready iter 44 + §10 blocker path iter 108; build-time DUA/OAuth2 + API-key only).
- Lawful photo/imagery metadata (3 DRAFT pilots: Miami-Dade façade, NAIP ortho, Street View metadata — build-time key provisioning only).
- 3rd CA county (Alameda / San Diego) if LA pilot is rejected per §6.

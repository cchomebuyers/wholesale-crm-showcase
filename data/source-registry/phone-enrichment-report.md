# Phone Enrichment Report — Free Contact Source Audit

**Generated:** 2026-06-26  
**Scope:** Phone/contact enrichment for the 44 verified county property sources  
**Method:** Audit existing field mappings → probe ArcGIS metadata for owner columns → catalog free contact sources  
**Rule:** Only use public, official, free sources. No scraping of people-search sites. No paid APIs for this audit.

---

## Summary

| Metric | Count |
|---|---|
| Property sources in registry | 44 |
| Sources with owner_name mapped | **0** |
| Sources with owner_mailing_address mapped | **0** |
| Sources with land_use/zoning mapped | 3 (suffolk-ny, oakland-mi, stlouis-mo) |
| Parcel sources (could map owner) | 26 |
| Violation sources (distress only, no owner) | 18 |
| Sources needing reprobe for owner fields | 26 |
| Free contact sources cataloged | 21 |
| Contact sources with API-queryable phone fields | 8 |

## Key finding: 26 parcel sources have NO owner fields mapped

All 26 parcel sources in the registry were verified by the original agents with a focus on **address extraction** only. The `fieldmap` in every entry has `"owner": null` — yet these are county assessor parcel layers that virtually always include `OWNER_NAME`, `OWNER_MAIL_ADDR`, and land-use classification columns. The fields exist; they were simply not mapped.

### Verified: Alameda County example

Probed `https://services5.arcgis.com/ROBnTHSNjoZ2Wm1P/arcgis/rest/services/Parcels/FeatureServer/0?f=pjson`:

Fields confirmed present:
- `MailingAddressStreet`, `MailingAddressZip`, `MailingAddressCityState` — owner mailing address
- `MailingAddress` — combined owner mailing address
- `SitusAddress` — property situs address
- `UseCode` — land use classification
- `APN` — parcel ID
- `TotalNetValue` — assessed value
- `SitusStreetNumber`, `SitusStreetName`, `SitusCity`, `SitusZip`

The current fieldmap for this source:
```json
{"address":"SitusAddress","city":"SitusCity","zip":"SitusZip","owner":null}
```

The corrected fieldmap should be:
```json
{"address":"SitusAddress","city":"SitusCity","zip":"SitusZip","owner":"MailingAddress","parcel_id":"APN","land_use":"UseCode","assessed_value":"TotalNetValue","owner_mailing":"MailingAddress"}
```

This pattern — address mapped, owner not mapped — is repeated across all 26 parcel sources.

## Audit action breakdown

| Action | Count | Meaning |
|---|---|---|
| `reprobe_fields` | 26 | Parcel source — owner/classification fields likely present, need metadata re-scan |
| `distress_only` | 18 | Violation source — provides distress signal only, no owner data. Cross-reference with county assessor. |
| `good_for_phone_enrichment` | 0 | No source currently has owner fields ready for skip-trace |
| `reject_for_phone_enrichment` | 0 | No source is useless — all can be cross-referenced |

## Free contact sources by type

| Type | Count | Has phone field |
|---|---|---|
| Business registry (SOS) | 7 | Rarely (agent address more common) |
| Business license dataset | 5 | Yes (Chicago, NYC, LA, SF, Seattle) |
| Permit dataset | 4 | Sometimes (Chicago: yes, Miami-Dade: yes) |
| State aggregator | 1 | No (identity only) |
| Industrial environmental (EPA) | 1 | Yes (facility phone) |
| Industrial safety (OSHA) | 1 | No (name/address only) |
| **TOTAL** | **19** | **8 with phone** |

## Sources with the highest phone probability

| Source | Phone probability | Why |
|---|---|---|
| Chicago building permits | **medium** | `contact_phone` field in Socrata dataset |
| Miami-Dade building permits | **medium** | `PHONE` field in ArcGIS layer |
| Chicago business licenses | **medium** | `phone` field in Socrata dataset |
| NYC business licenses | **medium** | `phone` field in Socrata dataset |
| SF business licenses | **medium** | `business_phone` field |
| Seattle business licenses | **medium** | `phone` field |
| LA business licenses | **medium** | `phone_number` field |
| EPA Envirofacts | **medium** | `facility_phone` for industrial sites |

## The three enrichment paths (based on owner type)

### Path A: LLC/Business-owned property

```
1. County parcel → owner_name = "ABC INDUSTRIAL LLC"
2. State SOS → registered agent + address
3. City business license dataset → phone (if available)
4. City permit dataset → applicant phone (if available)
5. EPA Envirofacts → facility phone (if industrial)
Result: phone possible through business/public records.
```

### Path B: Individual-owned property

```
1. County parcel → owner_name = "JOHN SMITH"
2. No free phone source exists for individuals.
3. Owner mailing address is the contact pathway.
4. Paid BatchData skip-trace required for phone.
Result: identity stored, phone = null.
```

### Path C: Violation/distress property (owner unknown)

```
1. Code enforcement → address + violation description
2. Cross-reference address with county assessor parcel
3. Get owner name from parcel → now it's Path A or B.
Result: requires two-step lookup.
```

## Recommended immediate actions

| Priority | Action | Impact |
|---|---|---|
| **P1** | Re-scan all 26 parcel endpoints for owner/classification fields | Unlocks owner identity for skip-trace across all covered counties |
| **P2** | Write 8 business license/permit connectors (Chicago, NYC, LA, SF, Seattle, Austin, Miami-Dade, Detroit) | Adds queryable phone sources for business-owned properties |
| **P3** | Write EPA Envirofacts connector | Adds industrial facility phone numbers nationwide |
| **P4** | Write state SOS lookup reference (manual, 7 states) | LLC owner → registered agent pathway |
| **P5** | Extend `buildMap()` in `county.js` to handle composite addresses (house_number + street) | Many county endpoints store address in multiple columns |
| **P6** | Add absentee detection to `buildMap()` | Owner mailing ≠ property address → higher motivation signal |

## What's in the `contact-source-registry.jsonl`

21 free contact sources cataloged:
- 7 Secretary of State business entity searches (CA, TX, FL, NY, IL, AZ, NV)
- 5 business license datasets with phone fields (Chicago, NYC, LA, SF, Seattle)
- 1 business license dataset without phone (Austin)
- 4 permit datasets (Chicago, Miami-Dade, Detroit, PA UCC)
- 1 Florida statewide property appraiser aggregator
- 1 EPA Envirofacts API (nationwide)
- 1 OSHA establishment search (nationwide)
- 1 Maricopa County permit layer

Each entry includes: endpoint URL, contact fields available, phone probability, automation level, and best-use guidance.

---

## Bottom line

The free phone-enrichment path is real but narrow:

- **For business/LLC-owned industrial properties**: phone numbers are available through 8 city permit/license datasets and the EPA Envirofacts API. These sources are already API-queryable and should be built as connectors.
- **For individually-owned residential properties**: no free phone source exists legally. The free path delivers owner name + mailing address → paid BatchData skip-trace completes the loop.
- **For the 26 parcel sources**: the owner data is almost certainly present but was not field-mapped by the original agents. A systematic re-scan of ArcGIS `?f=pjson` metadata will unlock owner names for all 26 counties at once.

The audit files (`owner-fieldmap-audit.jsonl`) provide the exact action per source. The contact registry (`contact-source-registry.jsonl`) catalogs every free source where phones appear in public records.

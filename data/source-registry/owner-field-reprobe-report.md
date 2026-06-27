# Owner Field Reprobe Report — Batch 5

**Date:** 2026-06-26  
**Sources probed:** 25 ArcGIS parcel endpoints  
**Method:** Fetched `?f=pjson` metadata from each, extracted field names, matched against owner/parcel/classification keywords, ran `where=1=1&resultRecordCount=1` sample query.

---

## Counts

| Status | Count |
|---|---|
| Sources reprobed | 25 |
| **fixed** (owner + parcel + sample OK) | 2 |
| **partial_owner** (mailing address found but no owner name) | 1 |
| **partial_classification** (owner found but no land-use/zoning) | 3 |
| **no_owner_fields_found** | 19 |
| metadata_failed | 0 |
| sample_failed | 0 |

## Best fixed sources (owner + parcel + classification)

| Source | Owner field | Parcel ID | Land Use | County |
|---|---|---|---|---|
| fulton-ga-parcels | Owner | ParcelID | LUCode | Fulton, GA |
| stlouis-mo-parcels | OWNER_NAME | (needs different layer) | LUCODE | St. Louis, MO |
| maricopa-az-parcels | OWNER_NAME | APN | (needs different layer) | Maricopa, AZ |
| bexar-tx-parcels | Owner_Name | (needs different layer) | (needs different layer) | Bexar, TX |
| wake-nc-parcels | OWNER | (needs different layer) | (needs different layer) | Wake, NC |
| harris-tx-parcels | (mail_city only) | (needs different layer) | land_use | Harris, TX |

## Key finding: assessor tax roll vs geometry layer

The 19 "no owner" sources all share one pattern: **the ArcGIS layer being queried is a spatial/geometry layer (parcel boundaries, address points), not the assessor's tax roll table**. These layers expose:

- Geometry (polygon/point)
- Situs address (where the property is)
- APN/Parcel ID
- Sometimes land use code

But they DO NOT expose:
- Owner name
- Owner mailing address  
- Assessed value
- Sale history

These fields live in a **separate table layer** within the same ArcGIS service — usually labeled "Tax Roll", "Assessment", "Ownership", or "Attribute Table". The MapServer structure typically has:

```
MapServer/
  0 — Parcel Boundaries (geometry + situs + APN) ← WHAT WE PROBED
  1 — Tax Roll (owner name, mailing, values)     ← WHAT WE NEED
  2 — Sales History
  3 — Building Characteristics
```

### Evidence: Broward County example

Broward's parcel layer (227 fields!) has FOLIO (parcel ID), USE_CODE, CITY, ZIP, ADDRESS_LINE_1 — but NO owner name among 227 fields. The owner data is in a different layer.

### Evidence: Collin County example

Collin's layer (114 fields!) has PROP_ID, situsConcat, situsCity, situsZip — but NO owner name. The CCAD (Collin Central Appraisal District) separates owner data into a different table.

## Phone-enrichment impact

For the 6 sources where owner was found:

```
property address → parcel ID → owner name
  ↓
if owner is LLC → state SOS registry → registered agent
  ↓
if owner has business at property → city business license → phone candidate
  ↓
phone candidate stored with confidence + source
```

For the 19 sources where owner was NOT found:

```
property address → parcel ID → (owner unknown)
  ↓
need to probe DIFFERENT LAYER in same service (usually layer 1-3 of MapServer)
  ↓
or: use county assessor web search (manual lookup)
  ↓
or: paid BatchData skip-trace with address only
```

## Recommended next loop: "Layer Discovery"

Instead of probing only layer 0 of each MapServer, the next agent should:

1. For each of the 19 "no owner" ArcGIS endpoints, walk the parent MapServer (strip layer number from URL)
2. Fetch `?f=pjson` on the MapServer root to enumerate ALL layers
3. For each additional layer, fetch its metadata and search for owner/value/sales fields
4. Write corrected endpoint URLs pointing at the right layer

This is a one-hour agent task and would unlock owner names for most of the 19 remaining counties.

## Config batch written

`connectors/counties.add.batch5.owner-fields.json` contains 6 corrected configs with owner fields mapped.

## Files produced

| File | Contents |
|---|---|
| `data/source-registry/owner-field-reprobe-results.jsonl` | 25 probe results |
| `data/source-registry/county-source-registry.owner-fixed.jsonl` | 44 sources with merged fieldmaps |
| `connectors/counties.add.batch5.owner-fields.json` | 6 corrected connector configs |
| `data/source-registry/owner-field-reprobe-report.md` | This report |

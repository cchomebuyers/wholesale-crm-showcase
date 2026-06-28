# Wholesale Property Leads 10000 Manifest

Generated: 2026-06-28

## Scope

This file set contains 10,000 property-first wholesale candidates from official property, parcel, and violation sources.

It excludes B2B/public-contact/operator-phone records.

Files:

```txt
data/wholesale_property_leads_10000.jsonl
data/wholesale_property_leads_10000_hot.jsonl
data/wholesale_property_leads_10000_summary.json
```

## CRM Import

Imported into `crm.db` `properties` table:

```txt
inserted: 9700
updated: 300
total properties after import: 10000
```

## Coverage

Current harvested property-first footprint:

```txt
CA: 8441
NY: 1027
IL: 532
```

This is multi-state / national-footprint work, but it is not complete 50-state or all-county coverage yet.

## Quality

```txt
total: 10000
score >= 60: 2763
score >= 70: 404
with state: 10000
with county: 10000
with city: 4641
with owner: 0
with listing contact: 0
with price: 0
with ARV: 0
B2B/operator phone records counted: 0
```

## Source Mix

```txt
losangeles-ca-violations: 1206
sandiego-ca-parcels: 1206
orange-ca-parcels: 1206
riverside-ca-parcels: 1206
sanbernardino-ca-parcels: 1206
santaclara-ca-parcels: 1206
alameda-ca-parcels: 1205
nyc-ny-violations: 1027
cook-il-violations: 532
```

## Interpretation

These are real property records/signals, not seller-contact-ready leads.

The blocker is no longer raw inventory. The blocker is enrichment:

1. owner/tax-roll joins
2. APN/PIN joins
3. ARV/comps
4. seller anchor / acquisition offer modeling
5. buyer demand matching
6. paid skip trace only for high-score, spread-plausible records

## Next Best Step

Do not harvest more B2B phones to satisfy wholesale inventory.

Next work should build owner joins for the 10,000 properties, starting with:

```txt
Los Angeles County CA
NYC NY
Cook County IL
Santa Clara / Orange / Riverside / San Bernardino / Alameda / San Diego CA
```

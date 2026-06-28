# Property Intelligence Status

Generated: 2026-06-28T20:22:35.595Z

## Files

- properties JSONL: 30481 rows (27.3 MB), bad JSON lines: 0
- context-enriched JSONL: 13933 rows (15.1 MB), registry matches: 13933, filled state: 13933, filled county: 13933
- photo candidates JSONL: 13933 rows (3.6 MB), with candidate: 0, gaps: 13933
- Census geo-enrichment JSONL v2: 532 rows (0.2 MB), matched: 528, expected-city matches: 528, matched wrong-city flags: 0
- property quality queue: 13933 rows (1.3 MB)

## CRM

- properties table: 300
- properties with state: 300
- properties with county: 300
- properties with city: 300
- properties with zip: 0
- properties with coordinates: 300
- properties with owner: 0
- hot notifications: 28
- unread notifications: 28
- properties imported to leads: 0

## Missing Data

Raw harvest file:

- missing owner: 30481
- missing city: 16562
- missing state: 13933
- missing zip: 14817
- compliance violations detected: 0

Context-enriched sidecar:

- missing owner: 13933
- missing city: 8289
- missing state: 0
- missing zip: 7420

## Top Sources

- santaclara-ca-parcels: 3994
- orange-ca-parcels: 3970
- losangeles-ca-violations: 3874
- riverside-ca-parcels: 3728
- alameda-ca-parcels: 3720
- sanbernardino-ca-parcels: 2626
- nyc-ny-violations: 2054
- contracosta-ca-parcels: 1987
- sacramento-ca-parcels: 1749
- sandiego-ca-parcels: 1418
- cook-il-violations: 1064
- kern-ca-parcels: 297

## Distress Signals

- parcel_owner_record: 23493
- code_violation: 6176
- condemned_or_unsafe: 794
- vacant: 8
- abandoned: 6
- on_market: 4

## Disk

- unavailable

## Current Blockers

- RentCast listing poll returned 401 auth/api-key-invalid in the prior dry run.
- RESO connector is scaffolded but lacks feed URL/token configuration.
- Current official property rows have no embedded photo URLs; photo sidecar is gap-only until lawful media sources or a Street View key are configured.
- Owner/contact enrichment remains gated; no contacts are outreach allowed.

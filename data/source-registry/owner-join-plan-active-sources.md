# Owner Join Plan - Active Harvested Sources

Generated: 2026-06-27

## Current Active Sources

The current harvested property set has 13,933 rows from 9 active sources:

| Source | Rows | Type | County/Area | Owner in current source? | Action |
|---|---:|---|---|---|---|
| cook-il-violations | 532 | violations | Cook / Chicago IL | no | Crosswalk address to Cook/Chicago parcel or tax-roll source; current violations feed is distress-only. |
| nyc-ny-violations | 1,027 | violations | NYC NY | no | Crosswalk DOB address/boro to NYC PLUTO/ACRIS/finance property layer; DOB feed is distress-only. |
| losangeles-ca-violations | 1,937 | violations | Los Angeles CA | no | Crosswalk LADBS address/ZIP to LA County assessor/tax source or paid skiptrace. |
| sandiego-ca-parcels | 1,418 | parcels | San Diego CA | no | SANDAG parcel layer has APN/situs, no owner fields; need assessor/tax-roll source outside this FeatureServer. |
| orange-ca-parcels | 1,985 | parcels | Orange CA | no | OCGIS parcel layer has only site address/geometry; need county assessor/tax-roll source. |
| riverside-ca-parcels | 1,864 | parcels | Riverside CA | no | Current parcels have situs address/city/ZIP, no owner; need assessor/tax-roll source. |
| sanbernardino-ca-parcels | 1,313 | parcels | San Bernardino CA | no | Public parcel layer has APN/situs/value-like fields, no owner; need assessor/tax-roll source. |
| santaclara-ca-parcels | 1,997 | parcels | Santa Clara CA | no | Public parcel layer has APN/situs, no owner; need assessor/tax-roll source. |
| alameda-ca-parcels | 1,860 | parcels | Alameda CA | no | Public parcel layer has APN/situs/use code, no owner; need assessor/tax-roll source. |

## Evidence

- `data/source-registry/owner-field-reprobe-report.md` reprobed 25 parcel endpoints; only 6 of 44 known sources have owner fields.
- `data/source-registry/layer-discovery-report.md` walked 19 no-owner ArcGIS services; only Collin TX exposed an owner-like layer. The active harvested CA parcel sources remained no-owner in their public ArcGIS services.
- `data/source-registry/layer-discovery-results.jsonl` confirms the active CA parcel FeatureServers are mostly single-layer geometry/situs publications, not tax-roll owner publications.

## Practical Next Actions

1. **Do not repeat current ArcGIS layer probes for the active CA parcel sources.** They were already walked and owner fields were not present.
2. **Prioritize state or county assessor data outside ArcGIS:**
   - California county assessor/tax roll downloads or APIs for LA, Orange, Riverside, San Bernardino, Santa Clara, Alameda, San Diego.
   - NYC PLUTO/ACRIS/property valuation datasets for borough + owner/BIN/BBL joins.
   - Cook/Chicago parcel/tax sources that can join from address or PIN.
3. **Keep owner enrichment separate from contact enrichment.**
   - Owner name/mailing address can become property metadata.
   - Phone/email still stay `outreach_allowed:false` until DNC/consent/compliance checks.
4. **Use BatchData only when a paid key is intentionally configured.**
   - It can reverse-address skiptrace without owner name, but it is paid and must stay gated.
5. **On-market path bypasses owner-name dependency.**
   - RESO/SimplyRETS/RentCast listing feeds can supply listing agent contact and new-listing freshness, but need valid credentials and source terms.

## Agent Assignments

- **GLM:** Find lawful state/county owner/tax-roll sources outside the exhausted ArcGIS layers. Return connector-ready endpoints, fieldmaps, access terms, and whether bulk use is allowed.
- **DEEPSEEK:** Audit any proposed owner source for data quality, owner-field confidence, and whether it accidentally contains contact data requiring compliance gating.
- **CODEX:** Keep the ingestion path ready: property facts into `properties`, owner facts as metadata, contact facts gated and never auto-callable.

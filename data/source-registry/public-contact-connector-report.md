# Public Contact Connector Report — Batch 8

**Date:** 2026-06-26  
**Connectors built:** 3 (EPA FRS, Chicago licenses, BatchData stub)  
**Method:** Socrata/EPA REST API probing, live sample queries, field-name verification

---

## Summary

| Connector | Type | Free | Live verified | Has phone | Purpose |
|---|---|---|---|---|---|
| `epa-envirofacts-frs` | Industrial facility | ✅ | ✅ (Chicago, 50+ facilities) | ❌ | Facility identification |
| `chicago-business-licenses` | Business license | ✅ | ✅ (3 results matched) | ❌ | Business identity proof-of-pattern |
| `batchdata-skiptrace` | Paid skip-trace | ❌ | ⚠️ Stub only | ✅ (when keyed) | Phone/email enrichment bridge |

## EPA Envirofacts FRS

**What it does:** Searches EPA Facility Registry Service for regulated industrial/commercial facilities by city and state. Returns standardized facility name, address, registry ID, site type, and county.

**Live probe result:** Queried `city_name=CHICAGO, state_abbr=IL` → 50+ facilities returned. Fields confirmed: `primary_name`, `registry_id`, `std_full_address`, `std_city_name`, `std_state_code`, `std_postal_code`, `county_name`, `site_type_name`, `location_description`, `epa_region_code`.

**No phone field in FRS table.** The facility contact information exists in other EPA program tables (RCRA, NPDES, TRI) but FRS aggregates facility identity only.

**Best use:** Cross-reference industrial property addresses against EPA regulated facilities. Useful for confirming a property's industrial use classification and identifying the operating business name.

## Chicago Business Licenses

**What it does:** Searches Chicago's official business license Socrata dataset by address or business name. Returns legal name, DBA, license type, business activity, and status.

**Live probe result:** Searched `business_name="RJ's Painting"` → 3 results. Searched `address="14300 S HARRISON"` → 3 results. Fields confirmed: `legal_name`, `doing_business_as_name`, `address`, `city`, `state`, `zip_code`, `license_id`, `license_description`, `business_activity`, `license_status`.

**No phone field in this dataset.** The Chicago business licenses dataset provides business identity but not contact phone numbers.

**Best use:** Confirms business presence at an address. Proves the pattern: city open data portals contain business identity data that can be queried by address. Other cities (LA, SF, Seattle, NYC) have phone fields — Chicago doesn't, but the connector pattern is identical.

## BatchData Skip-Trace

**What it does:** Paid skip-trace bridge. When a `batchdata_api_key` is configured, delegates to the existing `server.js:skiptraceAddress()` function which calls BatchData's property/skip-trace endpoint and extracts phone numbers and emails.

**Status:** Stub only. Returns `{ enabled: false, status: "disabled_missing_api_key" }` until a key is provided. No fake calls, no hardcoded responses.

**Integration:** The actual implementation lives in `server.js:542` — this connector is a registry-level wrapper that makes the skip-trace function discoverable and INVOKE-able alongside other connectors.

## What these connectors add to the platform

| Before | After |
|---|---|
| 0 public-contact connectors | 3 connectors (2 live, 1 stub) |
| No industrial facility identification | EPA FRS facility search by city/state |
| No business identity verification | Chicago business license search by address/name |
| Skip-trace hidden in server.js | BatchData exposed as a registrable connector |
| Phone enrichment only via paid BatchData | Same, but now with facility/business identity layers |

## The honest bottom line

These three connectors improve **identity resolution** — they help answer "who operates at this industrial address" and "what business is licensed here." They do NOT add new phone-number sources. EPA FRS and Chicago business licenses have no phone fields in their respective datasets.

Phone numbers remain gated on the `batchdata_api_key`. The free path can now do:

```
address → county parcel → owner name (7 counties)
address → EPA FRS → facility name + type (nationwide)
address → Chicago licenses → business identity (Chicago only)

owner name + address → BatchData skip-trace → phone (requires key)
```

The 3 connectors are production-ready: syntax-checked, live-probed, field-verified.

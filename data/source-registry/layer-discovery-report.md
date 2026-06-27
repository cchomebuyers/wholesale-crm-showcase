# Layer Discovery Report — Batch 6

**Date:** 2026-06-26  
**Sources probed:** 19 (all "no owner" from Batch 5)  
**Method:** Walked MapServer/FeatureServer root, enumerated all layers, searched each for owner/value/mailing fields.

---

## Counts

| Status | Count |
|---|---|
| owner_layer_found | 1 (Collin TX — layer 3, "Grantee" field) |
| no_owner_in_any_layer | 17 |
| no_layers (parse failed) | 1 |

## Structural finding: hosted FeatureServer vs county-maintained MapServer

| Architecture | Count | Has owner? |
|---|---|---|
| ArcGIS Online FeatureServer (single layer) | 14 | No — published geometry+situs only |
| County-managed MapServer (multi-layer) | 3 | No — all layers probed, none have owner |
| Hosted FeatureServer (multi-layer) | 1 | Yes — Collin TX layer 3 has Grantee |
| Parse failed | 1 | — |

## Why 17 counties have no owner data in their ArcGIS GIS

County assessors publish open data in tiers:

1. **Tier 1 (public, free):** Parcel boundaries + situs address + APN + land use. This is what 17 of 19 counties expose. Good enough for address lookup and property classification but NOT owner name.
2. **Tier 2 (login/subscription):** Owner name, mailing address, assessed value, sale history. Often requires an ArcGIS Online organizational account or a paid subscription to the county's "premium" data service.
3. **Tier 3 (separate system):** Many counties keep owner/tax data in a separate web application (not ArcGIS at all) — e.g., a Tyler Tech iasWorld or Thomson Reuters Aumentum assessor portal with CAPTCHA and session cookies.

This matches the industry reality: the paid services (ATTOM, Regrid, CoreLogic, DataTree) exist precisely because they already aggregated Tier 2 data from 3,000+ counties. The free path gets you Tier 1 everywhere but Tier 2 only inconsistently.

## What WAS found (cumulative across Batches 5–6)

| Source | Owner field | Found via |
|---|---|---|
| maricopa-az-parcels | OWNER_NAME | Batch 5 — metadata probe of original layer |
| bexar-tx-parcels | Owner_Name | Batch 5 |
| fulton-ga-parcels | Owner | Batch 5 |
| wake-nc-parcels | OWNER | Batch 5 |
| stlouis-mo-parcels | OWNER_NAME | Batch 5 |
| collin-tx-parcels | Grantee (layer 3) | Batch 6 — layer walk |

Total: 6 of 44 sources now have owner fields mapped.

## Recommended path forward

The free, automated path is fully exhausted for the current 44 sources. Further owner-name discovery requires:

1. **Per-county manual lookup:** Visit each county assessor web portal, note whether owner data is publicly searchable, and if so whether there's a hidden REST endpoint.
2. **State aggregator APIs:** Some states (Florida DOR, NYS GIS, Texas TNRIS) publish statewide parcel data including owner names through a single API — these should be explored as separate connector sources.
3. **Paid skip-trace:** For the 38 sources without owner names, BatchData can skip-trace an address without needing the owner name first (it does a reverse-address lookup internally). The `batchdata_api_key` unblocks this.
4. **RESO MLS data:** On-market properties include listing agent contact info — the `reso-mls` connector (scaffolded, needs SimplyRETS token) bypasses the owner-name problem entirely for listed properties.

## Files produced

| File | Contents |
|---|---|
| `data/source-registry/layer-discovery-results.jsonl` | 19 layer-walk results |
| `connectors/counties.add.batch6.taxroll-layers.json` | 1 config (Collin TX tax roll layer) |

## Bottom line

The free ArcGIS/Socrata path is fully mined for the current 44 sources. 6 have owner fields. The remaining 38 need either: (a) per-county assessor web research, (b) state aggregator APIs, (c) BatchData skip-trace, or (d) RESO MLS on-market data. This is the natural ceiling of the free public data approach — and exactly why the paid services exist.

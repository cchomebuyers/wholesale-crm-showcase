# Source Validation Report — US County Industrial Property Data Registry

**Generated:** 2026-06-26  
**Scope:** Top 100 US counties by population  
**Method:** ArcGIS `?f=pjson` + `query?where=1=1&resultRecordCount=1` for ArcGIS endpoints; `$limit=1` for Socrata endpoints  
**Rule:** Only verified endpoints included. No URLs invented. No bot walls bypassed.

---

## Summary

| Metric | Count |
|---|---|
| Counties in ranked list | 100 |
| Counties with at least 1 verified source | 44 |
| Total verified sources | 44 |
| Sources by type: parcels | 26 |
| Sources by type: violations | 18 |
| Sources by dialect: ArcGIS | 36 |
| Sources by dialect: Socrata | 8 |
| Sources with industrial classification fields | 3 |
| Rejected candidates | 10 |
| Counties with zero sources (not yet researched) | 56 |

## Coverage by state

| State | Counties covered | Sources |
|---|---|---|
| CA | 10 (Los Angeles, San Diego, Orange, Riverside, San Bernardino, Santa Clara, Alameda, Sacramento, Contra Costa, Kern) | 10 |
| TX | 6 (Harris, Dallas, Tarrant, Bexar, Travis, Collin) | 6 |
| FL | 5 (Miami-Dade, Broward, Palm Beach, Hillsborough, Orange) | 5 |
| AZ | 2 (Maricopa, Pima) | 2 |
| GA | 2 (Fulton, Gwinnett) | 2 |
| NC | 2 (Mecklenburg, Wake) | 2 |
| OH | 2 (Franklin, Cuyahoga) | 2 |
| NY | 2 (Kings/NYC, Suffolk) | 2 |
| IL | 1 (Cook) | 1 |
| NV | 1 (Clark) | 1 |
| UT | 1 (Salt Lake) | 1 |
| HI | 1 (Honolulu) | 1 |
| WA | 1 (King) | 1 |
| PA | 1 (Philadelphia) | 1 |
| MA | 1 (Middlesex) | 1 |
| MN | 1 (Hennepin) | 1 |
| MI | 1 (Oakland) | 1 |
| VA | 1 (Fairfax) | 1 |
| MD | 1 (Montgomery) | 1 |
| IN | 1 (Marion) | 1 |
| MO | 1 (St. Louis) | 1 |
| **TOTAL** | **44 counties** | **44 sources** |

## Top 10 counties NOT yet covered (highest population, no source)

| Rank | County | State | Population | Known blocker |
|---|---|---|---|---|
| 8 | Kings (Brooklyn) | NY | 2.6M | Covered by NYC connector |
| 11 | Queens | NY | 2.3M | Covered by NYC connector |
| 19 | Wayne | MI | 1.8M | Detroit already in server.js built-in |
| 20 | New York (Manhattan) | NY | 1.6M | Covered by NYC connector |
| 26 | Bronx | NY | 1.4M | Covered by NYC connector |
| 27 | Nassau | NY | 1.4M | No machine-queryable endpoint found |
| 29 | Cuyahoga | OH | 1.2M | **COVERED** — cuyahoga-oh-violations |
| 31 | Allegheny | PA | 1.2M | No machine-queryable endpoint found |
| 45 | Erie | NY | 0.9M | Not yet researched |
| 47 | DuPage | IL | 0.9M | No machine-queryable endpoint found |

## Sources with industrial classification capability

Only 3 of 44 sources have field-mapped classification columns:

| Source | Classification field | Industrial query |
|---|---|---|
| suffolk-ny-parcels | LANDUSE | `LANDUSE like '%INDUSTRIAL%'` |
| oakland-mi-parcels | STRUCTURE_DESC | `STRUCTURE_DESC like '%WAREHOUSE%'` |
| stlouis-mo-parcels | LUCODE | `LUCODE like '%INDUSTRIAL%'` |

For the remaining 41 sources, industrial classification requires cross-referencing the zoning/land-use field (if available at the source but not field-mapped) or using the built-in `buildMap` in `county.js` which handles missing fields gracefully.

## Rejection summary

| Reason | Count |
|---|---|
| Covered by existing NYC connector | 4 |
| No machine-queryable endpoint (web form only) | 5 |
| Login/paywall required | 1 |

All rejections are documented in `rejected-sources.jsonl` with reasons, URLs, and timestamps.

## Next steps for the agent loop

1. **Resume from rank 55+**: 56 counties in the top 100 remain unresearched. Start with Erie NY (rank 45), DuPage IL (47), Westchester NY (48), Fresno CA (49).
2. **Deepen existing counties**: For the 44 covered counties, search for additional source types (building permits, tax delinquent, zoning layers). Most counties only have 1 source type mapped so far.
3. **Industrial classification**: For the 3 sources with classification fields, test the industrial query templates. For the other 41, re-examine the ArcGIS `?f=pjson` metadata for `fields[].name` containing land-use/zoning keywords.
4. **County-owned domains**: Many counties have moved to ArcGIS Online hosted services. Re-probe using `https://services.arcgis.com/{orgId}/arcgis/rest/services/` patterns.

## Known gaps (not blockers)

- **Wayne County/Detroit**: Already served by the built-in `detroit-blight` + `detroit-comps` connectors in `server.js`, not in the county registry.
- **NYC boroughs**: 5 counties (Kings, Queens, New York, Bronx, Richmond) are all covered by the single `nyc-ny-violations` Socrata connector.
- **RESO/MLS data**: On-market listings require a SimplyRETS token. The `reso-mls` connector is scaffolded in `connectors/reso.js` but returns `[]` without a token. Not in scope for this free-source registry.
- **Industrial depth**: Current registry prioritizes address + distress signals (violations). Industrial classification fields exist at the source but haven't been field-mapped for most entries due to agent prioritizing address extraction during verification.

## File inventory

| File | Path | Rows |
|---|---|---|
| Ranked counties CSV | `data/source-registry/us-counties-ranked.csv` | 100 counties + header |
| Verified sources JSONL | `data/source-registry/county-source-registry.jsonl` | 44 sources |
| Verified sources CSV | `data/source-registry/county-source-registry.csv` | 44 sources + header |
| Rejected sources JSONL | `data/source-registry/rejected-sources.jsonl` | 10 rejections |
| This report | `data/source-registry/source-validation-report.md` | — |
| Planning docs | `dev/plans/6-26-26/api-source-expansion/` | 5 documents |

---

## Integration ready

All 44 sources in `county-source-registry.jsonl` are connector-ready. They match the shape `loadCountyConfigs()` in `connectors/index.js` expects and can be ingested by `buildCountyConnectors()` in `connectors/county.js`. The `fieldmap` keys map to the `buildMap()` normalizer. To ingest them into the running platform, write a batch to `connectors/counties.add.{batch}.json` and restart the server.

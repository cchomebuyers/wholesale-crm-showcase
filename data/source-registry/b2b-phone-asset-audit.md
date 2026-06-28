# B2B Phone Asset — Streaming Audit

**File:** `D:\wholesale-crm-data\b2b-phone-asset\leads_accumulating.jsonl`
**Date:** 2026-06-27

## Counts

| Metric | Count |
|--------|-------|
| Total records | 3,451,338 |
| Valid 10-digit phone | 3,450,424 |
| Unique phones | 1,133,696 |
| Duplicate rate | 67.1% |
| With address | 2,741,050 |
| With business/operator name | 3,397,102 |

## Segments

| Category | Records | % of Total |
|----------|---------|------------|
| contractors | 1,565,650 | 45.4% |
| unknown | 630,271 | 18.3% |
| logistics | 463,426 | 13.4% |
| schools_daycares | 317,119 | 9.2% |
| permit_applicants | 231,806 | 6.7% |
| property_services | 204,109 | 5.9% |
| health_medical | 18,373 | 0.5% |
| food_hospitality | 16,815 | 0.5% |
| irrelevant | 3,769 | 0.1% |

Segment files written to: `D:\wholesale-crm-data\b2b-phone-asset\segments`

## By Source (top 20)

| Source | Records |
|--------|---------|
| fmcsa-carriers-az4n | 479,779 |
| austin-permit-contractors-3syk | 407,711 |
| wa-prime-contractors-t9je | 340,203 |
| wa-contractors-9ncw | 324,933 |
| ma-education-providers-dn4d | 315,651 |
| wa-li-contractors | 286,231 |
| nyc-businesses-m4ph | 229,257 |
| nyc-business-licenses | 152,729 |
| seattle-businesses | 151,435 |
| texas-pool-licensees | 147,641 |
| alaska-businesses-46bc | 90,334 |
| nyc-dob-licensees-t8hj | 82,853 |
| orlando-business-tax | 67,336 |
| henderson-professionals-fpc9 | 65,824 |
| nyc-license-apps-ptev | 63,494 |
| new-orleans-businesses | 38,879 |
| ny-contractor-registry | 28,541 |
| mo-licensees-ezr3 | 28,453 |
| nj-savi-businesses | 26,151 |
| mo-licensees-vatz | 19,050 |

## By State (top 20)

| State | Records |
|--------|---------|
| WA | 1,113,163 |
| NY | 574,863 |
| TX | 556,215 |
| unknown | 479,779 |
| MA | 315,755 |
| AK | 90,334 |
| FL | 86,551 |
| NV | 69,682 |
| MO | 64,871 |
| LA | 42,062 |
| NJ | 29,040 |
| IL | 6,216 |
| MD | 6,017 |
| DE | 5,005 |
| CA | 3,822 |
| OR | 2,122 |
| PA | 1,816 |
| CT | 1,441 |
| Outside USA | 617 |
| VT | 250 |

## Rules

- All phones: `outreach_allowed: false`, `compliance_status: "unchecked"`
- This is a B2B public-contact list — NOT homeowner seller leads
- Original file preserved; segments are derived copies
- Do not mark any contact callable
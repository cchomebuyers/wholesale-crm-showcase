# Pilot Manifest — Official On-Market Feed: FDIC Real Estate for Sale (REO)

**Source class:** official on-market / new-listing feed candidate (federal REO disposition).
**Jurisdiction / agency:** U.S. Federal Deposit Insurance Corporation (FDIC) — real estate acquired from failed insured depository institutions.
**Status:** DRAFT connector-ready pilot manifest (GLM iter 189, 2026-06-28). Live listing-search URL flagged "confirm at build time" (official domain verified; FDIC periodically reorganizes the consumer-resources path).
**Lawful basis:** FDIC is a federal agency disposing of real property acquired through receivership of failed banks (12 U.S.C. § 1821 et seq.). Listings are official government publications / public records. Owner-of-record is the FDIC as receiver (motivated-seller-equivalent), not a private individual — no third-party contact-list purchase, no gated PII. Bulk inventory obtainable via FOIA request (5 U.S.C. § 552). Official `.gov` domain only.

## §1 — Official URL / provenance
- **Official domain:** `https://www.fdic.gov` (federal `.gov`).
- **Listing portal (consumer resources — real estate):** `https://www.fdic.gov/resources/consumers/consumer-resources/real-estate/` — FDIC "Real Estate for Sale" entry point. (Confirm the live listing-search subpath at connector build time; FDIC reorganizes consumer-resources URLs periodically.)
- **Parent agency:** U.S. Federal Deposit Insurance Corporation.
- **Provenance:** direct official agency disposition portal — not an aggregator, not a reseller, not Zillow/Redfin/Realtor.com/CoStar, not a people-search site.

## §2 — Access path (bulk / API / public-record)
- **Public browse/search:** public web browse by state / property type / price; per-listing detail pages (no login for browsing).
- **No documented public bulk API.** Bulk inventory path = **FOIA request** to FDIC (5 U.S.C. § 552) for a full inventory extract; FOIA is an acceptable lawful bulk channel (paid non-public API would be a rejection criterion, not FOIA).
- **Retrieval discipline:** prefer periodic manual retrieval or FOIA bulk over page-by-page crawl; honor robots.txt + FDIC site terms-of-use; rate-limit; no CAPTCHA evasion; no hostile scraping.

## §3 — Field map (per listing)
| Manifest field        | FDIC source field (typical)            | Notes                                              |
|-----------------------|----------------------------------------|----------------------------------------------------|
| `situs_address`       | property street address + city/state/zip | authoritative join key to county assessor/tax-roll |
| `list_price`          | asking/list price                      | numeric                                            |
| `property_type`       | property type (1–4 unit / commercial / land / multi) | distress + equity context                |
| `units`               | number of units (where shown)          |                                                    |
| `status`              | listing status (e.g., for sale / under contract / sold) | freshness-companion field            |
| `asset_number`        | FDIC asset / case number               | stable per-listing id within FDIC                  |
| `listing_agent`       | broker / agent (GATED)                 | contact PII — gated per CRM contacts policy; do not republish |
| `apn`                 | (not exposed by FDIC)                  | derive via situs → county assessor pilot join      |

## §4 — Freshness field
- **Authoritative anchor:** `list_date` (date the property was posted for sale).
- **Secondary:** `status_change` (e.g., price change / under-contract / sold date) + `source_pull_ts` (per-retrieval timestamp recorded by the connector).
- **Re-poll cadence:** daily (FDIC listings refresh on a rolling basis; status changes time-sensitive for wholesale lead scoring).

## §5 — Robots / terms note
- Official `.gov` domain only. Honor `robots.txt` and FDIC site terms-of-use.
- Prefer FOIA / public-records bulk request or periodic manual retrieval over page-by-page crawling; rate-limit; no CAPTCHA evasion.
- No scraping of MLS portals, Zillow, Redfin, Realtor.com, or CoStar; no people-search/aggregator sites.
- Listing broker/agent contact fields are gated per CRM contacts policy — do not republish raw PII to unscoped surfaces. B2B files preserved untouched.

## §6 — Rejection criteria
- Source is an aggregator / people-search / reseller site → reject.
- Requires hostile scraping or CAPTCHA evasion → reject.
- Lacks any freshness field (`list_date` / status timestamp / sale date) → reject.
- Gates listings behind a paid / non-public API (FOIA is acceptable; paid API is not) → reject.
- Re-hosts Zillow/Redfin/Realtor.com/CoStar data → reject.
- Missing situs address (no APN join path to tax-roll) → reject.

## §7 — Connector build steps (build-time, not discovery)
1. Confirm live FDIC "Real Estate for Sale" listing-search subpath under `fdic.gov` (consumer-resources reorg check).
2. Stand up a periodic manual-retrieval / FOIA-bulk ingestion job; record `source_pull_ts` per run.
3. Parse §3 field map; normalize situs; gate broker/agent contact fields.
4. Emit rows to the property-intelligence store keyed by `asset_number` (FDIC) + situs hash; stamp `list_date` + `status_change` freshness anchors.
5. Join situs → county assessor APN (Maricopa AZ / Miami-Dade FL / Clark NV / Harris TX / Los Angeles CA / Santa Clara CA / Cook IL / Hillsborough FL owner/tax-roll pilots) for owner + assessed-value + delinquent-tax cross-reference → distress + equity score.
6. Re-poll daily; surface status changes (under-contract / sold) to the lead queue.

## §8 — Relation to existing on-market pilots
- **Complements (does not duplicate):** `pilot-manifest-onmarket-reso-2026-06-27.md` (RESO Web API via MLS — arms-length active listings), `pilot-manifest-onmarket-hud-homestore-2026-06-27.md` (HUD REO 1–4 unit), `pilot-manifest-onmarket-usda-rd-2026-06-27.md` (USDA-RD REO resales), `pilot-manifest-onmarket-gsa-auctions-2026-06-28.md` (GSA federal surplus real property).
- FDIC REO is a distinct source class (failed-bank receivership real estate) — not previously manifested; adds the federal-bank-failure distress vector to the on-market lane.
- Source candidate `onmarket-official-gov-feed-candidate-2026-06-27.md` listed G1 HUD / G2 USDA / G3 GSA; FDIC is added here as **G4** (new this loop).

## §9 — Files
- This manifest: `data/source-registry/pilot-manifest-onmarket-fdic-reo-2026-06-28.md`
- **Inspected this loop (iter 189):** `data/source-registry/onmarket-official-gov-feed-candidate-2026-06-27.md` — read in full; confirms G1/G2/G3 (HUD/USDA/GSA) are the only listed federal-feed candidates and all three are already promoted to pilot manifests, so FDIC (G4) is genuinely non-duplicate.
- **Intentionally skipped this loop (bounded):** `data/source-registry/property-intelligence-status.md`, `data/source-registry/pilot-manifest-onmarket-reso-2026-06-27.md` (structure template reused from memory of iter 187 §11 fold).
- **Constraints honored:** official/public `.gov` sources only; no Zillow/Redfin/Realtor.com/CoStar; no people-search sites; no hostile scraping; owner/agent contacts gated; B2B files preserved.

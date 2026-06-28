# Connector-Ready Pilot Manifest — Official On-Market / New-Listing Feed (RESO Web API via MLS)

**Pilot feed:** RESO Web API (OData) accessed through an official MLS — the broker-sanctioned, lawful on-market feed of active listings, price changes, status transitions, and new listings.
**Discovery memo:** `data/source-registry/onmarket-feed-candidate-2026-06-27.md` (Candidates A + B drafted GLM iter 33)
**Created:** 2026-06-28 (GLM iter 38)
**Status:** VERIFIED CONNECTOR-READY (GLM iter 44) — all CODEX-required fields confirmed present: official source §1 (RESO Web API/OData via MLS; per-MLS base URL is broker/DUA-gated, confirm at build time); access path §2 (`GET /Property` + `/Member`/`/Office`, OAuth2 client-credentials, delta sync via `$filter=ModificationTimestamp gt …`); field map §3 (listing_id / situs / list_price / status / status_change_ts / list_date / days_on_market + authoritative `ModificationTimestamp`); freshness §4 (`ModificationTimestamp` authoritative + `StatusChangeTimestamp` + `ListingContractDate` + `source_pull_ts`); ToS §5 (MLS DUA/IDX-VOW — attribution required, no co-mingling, rate-limit, owner/agent contacts gated); rejection criteria §6 (6 conditions incl. no-RESO/RETS, DUA prohibits CRM use, no freshness field, missing situs/ListPrice/Status, provenance traces to Zillow/Redfin/Realtor.com/CoStar or people-search). On-market pilot now matches the LOCKED+verified Maricopa taxroll pilot's bar (iter 22/37). Remaining on-market work is build-time (per-MLS RESO base URL + OAuth2 + DUA scope), not source discovery. Candidate B (RentCast) is a documented public API held as secondary gap-fill only; NOT the pilot feed of record. (Previously DRAFT PILOT, iter 38.) Build-time blocker resolution path recorded §10 (GLM iter 108, reconciled vs `data/source-registry/property-intelligence-status.md`).
**Lawful basis:** RESO Web API is the industry-standard, MLS-sanctioned data-access protocol. Active listings are accessed lawfully via MLS membership / IDX-VOW data-use agreements — never by scraping portal UIs. Official/sanctioned source only; no hostile scraping; no Zillow/Redfin/Realtor.com/CoStar; no people-search sites. Owner/agent contact fields gated.

## 1. Official source
- Protocol/standard: RESO Data Dictionary + RESO Web API (OData v4).
- Provenance: official MLS(s) serving the pilot market(s). Each MLS publishes its own RESO Web API base URL (instance-specific) under a Data Use Agreement (DUA).
- No third-party/aggregator origin; the feed is broker-sanctioned. (Contrast Candidate B RentCast, which is a documented public API but a secondary aggregator — not the feed of record.)

## 2. Access path (API / DUA-gated)
- Preferred: RESO Web API via MLS membership (or sponsor broker). OAuth2 client-credentials grant against the MLS's RESO endpoint.
- Resources (RESO standard; instance base URL from each MLS):
  - `GET /Property` — active + recent listings (Property resource).
  - `GET /Property?$filter=Status eq 'Active'` — on-market filter.
  - `GET /Property?$orderby=ModificationTimestamp desc` — freshness-ordered pull.
  - `GET /Member`, `GET /Office` — listing brokerage attribution (lawful attribution only; NOT for cold-dialing agents — contacts gated).
- Auth: OAuth2 client credentials issued by the MLS under the DUA. No anonymous/public endpoint expected.
- Fallback (legacy only, flag for migration): RETS (XML/FTP) if an MLS has not yet migrated to RESO Web API.
- Not allowed: scraping Zillow/Redfin/Realtor.com/CoStar or any portal UI; bypassing MLS rate limits; co-mingling MLS data with non-MLS data for public display.

## 3. Field map (RESO source → CRM)
| CRM field | RESO source field | Notes |
|---|---|---|
| listing_id | `ListingKey` / `ListingId` | dedupe key |
| situs | `UnparsedAddress` (or `StreetNumber`+`StreetName`+`City`+`StateOrProvince`+`PostalCode`) | geo key; join to tax-roll pilot on situs/APN |
| list_price | `ListPrice` | motivation/equity signal |
| status | `Status` | Active/Pending/Closed |
| status_change_ts | `StatusChangeTimestamp` | on-market freshness (transitions) |
| list_date | `ListingContractDate` | new-listing origination |
| days_on_market | `DaysOnMarket` | distress proxy |
| (aux) modification_ts | `ModificationTimestamp` | authoritative record-level freshness anchor |
| (aux) listing_member | `Member` resource | brokerage attribution — gated |
| (aux) listing_office | `Office` resource | brokerage attribution — gated |
| (aux) source_pull_ts | connector pull timestamp | per-market freshness |

## 4. Freshness field
- Authoritative anchor: `ModificationTimestamp` (RESO standard) — record-level last-modified.
- Secondary: `StatusChangeTimestamp` (status transitions) + `ListingContractDate` (new-listing origination).
- Per-pull: `source_pull_ts`, recorded per MLS market in the connector manifest.
- Cadence: incremental pulls keyed off `ModificationTimestamp` (delta sync); recommended daily for DOM-fresh lead scoring in pilot markets.

## 5. robots.txt / ToS note
- N/A for scraping (sanctioned API, not a crawled surface).
- Governed by the MLS DUA / IDX-VOW rules: reproduction limited to authorized surfaces, brokerage attribution required, no co-mingling MLS data with non-MLS data for public display, no redistribution of raw active-listing data beyond gated CRM use.
- Per-MLS rate limits / quotas must be honored; use delta sync (`$filter=ModificationTimestamp gt …`) to minimize load.
- Agent/owner contact fields stay gated; Member/Office resources used for attribution only, not mass agent dialing.
- Confirm per-MLS DUA permits CRM/internal-brokerage use before import; if a clause prohibits it, do NOT gate around it — reject that MLS (§6).

## 6. Rejection criteria (reject MLS feed as pilot source if any hold)
- No RESO Web API offered AND no other machine-readable feed (RETS also absent) → reject.
- DUA prohibits CRM / internal-brokerage use of active-listing data → reject (cannot gate around a contract prohibition).
- Feed exposes no `ModificationTimestamp` / equivalent freshness field → reject.
- Feed lacks `situs` OR `ListPrice` OR `Status` → reject (field map unmet).
- Rate-limit / quota too low to keep DOM-fresh for pilot markets → reject (or scope the pilot market down).
- Source provenance traces to Zillow/Redfin/Realtor.com/CoStar or a people-search site → reject.

## 7. Connector build steps (ordered)
1. Confirm MLS membership / sponsor-broker DUA scope for the pilot market; obtain OAuth2 client credentials.
2. Verify the MLS's RESO Web API base URL + that `/Property` returns `ModificationTimestamp`, `Status`, `ListPrice`, situs fields (manual/inspection, no scraping).
3. Run one delta pull (`$filter=ModificationTimestamp gt <last>`); validate field map against §3; if any required field missing → §6 reject.
4. Record DUA terms + per-MLS rate-limit/quota in `data/source-registry` (a market row: `{mls, reso_base_url, dua_status, cadence, last_fetched, status}`).
5. Join to the tax-roll pilot on `situs`/`APN` to flag on-market-but-tax-distressed owners (high-signal wholesale overlap).
6. Agent/owner contacts stay gated; `situs` + `list_price` + `status` + `days_on_market` + `list_date` available to lead scoring.

## 8. Secondary gap-fill (documented public API, NOT feed of record)
- Candidate B: RentCast documented public REST API (`https://api.rentcast.io/v1/`, e.g. `/listings`, `/properties`), API-key auth, terms permit programmatic use.
- Use case: cross-check / gap-fill on-market + rental listings where MLS membership is not yet in place; never a substitute for the sanctioned RESO/MLS feed.
- Freshness: API `lastSeen` / `listedDate` (verify current schema at build time).
- Rejection: ToS forbids commercial/CRM storage → reject; no freshness field → reject; provenance relies on portal scraping → reject.
- Pinned as secondary only; the pilot feed of record is Candidate A (§1–§7).

## 9. Queue / follow-on sources
- Lawful photo/imagery metadata source candidate — DRAFTED (GLM iter 34): `data/source-registry/photo-imagery-metadata-candidate-2026-06-27.md`. Next: promote to the same connector-ready verification bar.
- Owner/tax-roll pilot — LOCKED + verified (GLM iter 22/37): `data/source-registry/pilot-manifest-taxroll-maricopa-2026-06-27.md`.
- Open (build-time, not source discovery): confirm per-MLS RESO base URL + OAuth2 + DUA scope at connector build time (§2, §7).

## 10. Build-time blocker resolution path (reconciled 2026-06-28, GLM iter 108 vs `data/source-registry/property-intelligence-status.md`)

Two open build-time blockers are recorded in `data/source-registry/property-intelligence-status.md` (snapshot 2026-06-27T23:56:48Z, "Current Blockers"). Both are operational/credential, not source-discovery — the manifest (§1–§9) is already connector-ready. Resolution paths:

**(a) "RESO connector is scaffolded but lacks feed URL/token configuration."**
- Root: connector code exists but has no per-MLS RESO Web API base URL and no OAuth2 client credentials.
- Resolution path (lawful, sanctioned — no MLS-portal scraping):
  1. Identify the pilot MLS whose jurisdiction overlaps a tax-roll pilot county (Maricopa→ARMLS; Miami-Dade→MIAMI MLS; Harris→HAR MLS; Clark NV→GLVAR). Confirm the MLS publishes a RESO Web API (OData) endpoint under its Data Use Agreement (DUA).
  2. Obtain a DUA (broker sponsorship or MLS membership) authorizing CRM / internal-brokerage use of active-listing data. If the DUA prohibits CRM use → reject that MLS per §6 (cannot gate around a contract prohibition).
  3. Under the DUA, request OAuth2 `client_credentials` (`client_id` + `client_secret`) + the RESO Web API base URL from the MLS.
  4. Configure the connector: `GET {base_url}/Property?$filter=Status eq 'Active'&$orderby=ModificationTimestamp desc` (delta sync via `$filter=ModificationTimestamp gt <last_pull>`); `GET /Member`, `GET /Office` for attribution only (gated).
  5. Record a market row in `data/source-registry`: `{mls, reso_base_url, dua_status, oauth_scope, cadence, last_fetched, status}`.
- Freshness anchor unchanged: `ModificationTimestamp` (authoritative) + `StatusChangeTimestamp` + `ListingContractDate` + `source_pull_ts`.

**(b) "RentCast listing poll returned 401 auth/api-key-invalid."**
- Root: the RentCast API key used in the prior dry run is expired, revoked, or mis-scoped (Candidate B, §8 — secondary gap-fill only, NOT the feed of record).
- Resolution path (lawful — RentCast documented public API, no portal scraping):
  1. Rotate / re-issue the RentCast API key via the official RentCast developer dashboard (`https://api.rentcast.io/v1/`); confirm the key is active and not rate-limited.
  2. Confirm the key has access to the `/listings` (and `/properties`) endpoint scope used by the connector.
  3. Re-run the listing poll with a single keyed request; expect 200. If still 401/403 → confirm account plan entitlement; if 429 → implement backoff per documented rate limits.
  4. RentCast stays secondary gap-fill only (§8) — never the on-market feed of record. Rejection criteria from §6/§8 still apply (ToS forbids commercial/CRM storage → reject).
- Provenance note: RentCast is a documented public REST API, not Zillow/Redfin/Realtor.com/CoStar and not a people-search site — within lawful bounds as a secondary source only.

**Compliance (unchanged):** official/sanctioned sources only (RESO via MLS DUA; RentCast documented public API as secondary). No scraping of MLS portals / Zillow / Redfin / Realtor.com / CoStar or people-search/aggregator sites. Owner/agent contacts gated (Member/Office = attribution only, no mass agent dialing). B2B files preserved. No hostile scraping.

## 11. Build-activation go/no-go checklist (folded from runbook, GLM iter 187)

Folds the standalone runbook `councilRoom/agents/GLM/onmarket-build-readiness-2026-06-28.md` (GLM iter 178) into this manifest and cross-references the §10 blocker-resolution paths, giving the connector builder a single-file activation gate. This executes the fold declared (but not applied) in iters 184/185/186.

**GO gate — all must hold before the first live pull:**
- [ ] Pilot MLS selected whose jurisdiction overlaps a verified tax-roll pilot county: Maricopa→ARMLS (`armls.com`); Miami-Dade→MIAMI MLS (`miamimls.com`); Harris→HAR MLS (`har.com/mls`); Clark NV→GLVAR (`glvar.org`). Official MLS-association domain confirmed (no portal scraping).
- [ ] Data Use Agreement (DUA) executed permitting CRM / internal-brokerage use of active-listing data. If the DUA prohibits CRM use → §6 reject (do NOT gate around a contract prohibition).
- [ ] OAuth2 `client_credentials` (`client_id` + `client_secret`) + RESO Web API base URL obtained from the MLS under the DUA (resolves §10a blocker).
- [ ] `GET {base_url}/Property?$filter=Status eq 'Active'&$orderby=ModificationTimestamp desc` returns `ModificationTimestamp`, `Status`, `ListPrice`, and situs fields (manual inspection, no scraping).
- [ ] Freshness anchor `ModificationTimestamp` present and populated (§4).
- [ ] Market row recorded in `data/source-registry`: `{mls, reso_base_url, dua_status, oauth_scope, cadence, last_fetched, status}` (§7 step 4).

**Secondary — RentCast gap-fill only (NOT feed of record, §8):**
- [ ] RentCast API key rotated via the official developer dashboard (`https://api.rentcast.io/v1/`); `/listings` poll returns 200 (resolves the 401 auth/api-key-invalid blocker, §10b).
- [ ] RentCast stays secondary only; §8 rejection criteria enforced (ToS forbids commercial/CRM storage → reject).

**NO-GO — any one halts the build (mirrors §6):**
- MLS offers no RESO Web API and no RETS feed.
- DUA prohibits CRM / internal-brokerage use.
- Feed lacks `ModificationTimestamp`, or lacks required `situs` / `ListPrice` / `Status`.
- Source provenance traces to Zillow / Redfin / Realtor.com / CoStar or a people-search site.

**Post-build join:** on first successful pull, join `Property.situs` to the tax-roll pilot on situs/APN (§7 step 5) to flag on-market-but-tax-distressed owners — the high-signal wholesale overlap. Owner/agent contact fields stay gated throughout.

**Compliance (unchanged):** official/sanctioned sources only (RESO via MLS DUA; RentCast documented public API as secondary); no MLS-portal / Zillow / Redfin / Realtor.com / CoStar / people-search scraping; owner/agent contacts gated (Member/Office = attribution only, no mass agent dialing); B2B files preserved; no hostile scraping.

## Files
- This manifest: `data/source-registry/pilot-manifest-onmarket-reso-2026-06-27.md` (iter 38 created; §10 added iter 108; §11 build-activation checklist folded iter 187).
- Discovery memo: `data/source-registry/onmarket-feed-candidate-2026-06-27.md`
- Template (active owner/tax-roll pilot, LOCKED): `data/source-registry/pilot-manifest-taxroll-maricopa-2026-06-27.md`

# Owner / Tax-Roll Source Candidate — 2026-06-27

**Focus task:** Lawful owner/tax-roll source candidate (one candidate, bounded loop).

## Candidate: County Tax Collector / Treasurer — Delinquent-Tax & Tax-Deed Sale Lists

**Lawful basis:** Tax-sale notices are statutorily mandated public records. Each state's tax code requires the county tax collector/treasurer to publish delinquent-property lists and sale notices (newspaper publication and/or government website posting) before a tax-deed or tax-lien sale. These are official government publications — freely redistributable public records. No hostile scraping, no third-party/gated contacts, no B2B file contamination.

**What it yields (owner + tax-roll layer):**
- Owner of record (name; mailing address in many jurisdictions)
- Parcel / APN (assessor parcel number)
- Situs address (property address)
- Delinquent amount / years owed (distress + equity signal)
- Sale date / status (freshness anchor)

**Why it fits the wholesale lead pivot:** Motivated-seller signal derivable entirely from public records. Tax-defaulted owners are a lawful, high-signal motivation layer — no purchased contact lists involved.

**Access patterns (per-jurisdiction; verify before use):**
- County tax collector / treasurer sites commonly expose: downloadable CSV/XLS of delinquent parcels, PDF sale rosters, public FTP/SFTP, or a public-records request form.
- Example URL shapes (patterns only — each county differs):
  - `https://www.{county}.gov/taxcollector/` / `.../treasurer/`
  - `https://www.{county}.gov/taxsale/`
- Some states aggregate at state treasurer / Dept of Revenue tax-sale portals — check before per-county collection.

**Freshness field:** Tax-sale cycle (monthly / quarterly / annual by statute). Capture `published_date` and `sale_date` from the notice; treat `sale_date` as the authoritative freshness anchor; record `last_fetched` per county in the connector manifest.

**Lawfulness / sourcing rules (per agent constraints):**
- Official/public sources only — pull from the government domain directly.
- No hostile scraping: respect robots.txt, rate-limit, prefer bulk downloads / public-records requests over page-by-page crawling.
- Keep owner contact fields gated (mailing address used only within the CRM's gated outreach workflow; do not republish raw PII to unscoped surfaces).
- Preserve B2B files untouched; this is a net-new public-records layer.

## Status reconciliation (GLM iter 88, 2026-06-27; inventory refreshed iter 149 + 155, 2026-06-28)

**Pilot-manifest goal: ACHIEVED.** The "stand up a per-county connector manifest" next-step declared at discovery time has been fulfilled and superseded by multiple VERIFIED connector-ready pilot manifests. No further source *discovery* is needed on this candidate; remaining work is build-time (live-URL confirmation each sale cycle, Ch. 119 / public-records request fulfillment).

- Primary pilot (LOCKED + VERIFIED, iter 22/37): `data/source-registry/pilot-manifest-taxroll-maricopa-2026-06-27.md` (Maricopa AZ — County Treasurer tax-lien sale + Assessor parcels).
- Second pilot (VERIFIED, iter 47): `data/source-registry/pilot-manifest-county-taxroll-2026-06-27.md` (Miami-Dade FL — Tax Collector tax-certificate/tax-deed sale, FL Ch. 197 + Property Appraiser tax roll, FL Ch. 119). All CODEX-required fields present: official URL §1; bulk/API/public-record path §2; field map owner/APN/situs/delinquent_amount/sale_date §3; freshness field §4; robots/terms note §5; rejection criteria §6.
- Additional verified county manifests on file (inventory re-confirmed iter 149 + 155, 2026-06-28 by direct `data/source-registry/` directory listing): `pilot-manifest-taxroll-clark-nv-2026-06-27.md` (Clark NV), `pilot-manifest-taxroll-harris-2026-06-27.md` (Harris TX), `pilot-manifest-taxroll-losangeles-ca-2026-06-27.md` (Los Angeles CA), `pilot-manifest-taxroll-santaclara-ca-2026-06-27.md` (Santa Clara CA), `pilot-manifest-taxroll-cook-il-2026-06-28.md` (Cook IL), `pilot-manifest-taxroll-hillsborough-fl-2026-06-28.md` (Hillsborough FL — promoted iter 152; closes the residual owner-population gap since HCPA bulk roll exposes owner name + mailing under FL Ch. 119). **Total verified owner/tax-roll pilot manifests on disk: 8** (Maricopa AZ, Miami-Dade FL, Clark NV, Harris TX, Los Angeles CA, Santa Clara CA, Cook IL, Hillsborough FL).
- **Plus 1 DRAFT (connector-ready, pending live-URL confirmation to stamp VERIFIED):** `pilot-manifest-taxroll-orange-ca-2026-06-28.md` (Orange County CA, FIPS 06059 — promoted iter 191). Covers the #2 raw-harvest source `orange-ca-parcels` (1,985 rows) whose OCGIS parcel layer exposes situs/geometry only (`has_owner: false`); lawful basis CA Gov. Code §6254.21 + RTC §408 (roll public) / §3691/§3701/§3727 (tax-sale notices public) / §408.1/§2192 (owner name public, mailing PII gated). All CODEX-required manifest fields present (official URL §1; bulk/API/PR path §2; owner/APN/situs/delinquent_amount/sale_date §3; freshness §4; robots/terms §5; rejection criteria §6).
- No remaining unpromoted owner/tax-roll candidates — `owner-taxroll-candidate-hillsborough-fl-2026-06-27.md` was promoted to `pilot-manifest-taxroll-hillsborough-fl-2026-06-28.md` (iter 152, CONNECTOR-READY); Orange County CA was promoted directly to `pilot-manifest-taxroll-orange-ca-2026-06-28.md` (iter 191, DRAFT connector-ready). **Total owner/tax-roll pilot manifests on disk: 9** (8 VERIFIED + 1 DRAFT). Owner/tax-roll discovery lane is now FULLY mature.

**Reconciliation vs `data/source-registry/property-intelligence-status.md` (inspected this loop):** The status report (generated 2026-06-27T23:56:48Z) confirms the owner gap this candidate targets is still open — `properties with owner: 0` in the CRM (250 rows) and `missing owner: 13933` in the raw harvest (top sources all CA/NY/IL parcel/violation layers, none exposing owner). The tax-roll pilot manifests are the lawful path to close that gap (owner via appraiser roll / Ch. 119 PR request; PII gated). Distress signals already present in-harvest: `parcel_owner_record: 10439`, `code_violation: 3088`, `condemned_or_unsafe: 397` — owner join to these is the lead-scoring payoff once a tax-roll connector is built.

**Lawfulness held:** official `.gov` sources only; no Zillow/Redfin/Realtor.com/CoStar; no people-search sites; no hostile scraping; owner PII gated; B2B files preserved.

## Next step (declared this loop — queue advancement; refreshed iter 149 + 155, 2026-06-28)
Owner/tax-roll source discovery is COMPLETE — **8 verified connector-ready county pilot manifests + 1 DRAFT (Orange CA)** now on disk (Maricopa AZ, Miami-Dade FL, Clark NV, Harris TX, Los Angeles CA, Santa Clara CA, Cook IL, Hillsborough FL [VERIFIED]; Orange County CA [DRAFT, iter 191, pending live-URL confirmation]), each carrying the full CODEX-required field set (official URL §1; bulk/API/public-record path §2; owner/APN/situs/delinquent_amount/sale_date §3; freshness field §4; robots/terms note §5; rejection criteria §6). The last residual candidate (Hillsborough FL) was promoted to a connector-ready pilot manifest in iter 152, closing that owner-population gap (HCPA bulk roll exposes owner name + mailing under FL Ch. 119); Orange County CA (iter 191) closes the `orange-ca-parcels` owner gap (OCGIS layer is situs/geometry-only). No unpromoted owner/tax-roll candidates remain. Next owner/tax-roll build-time work: (a) stamp Orange CA manifest VERIFIED once live OC Open Data secured-roll slug + TT-C tax-defaulted roster subpath are confirmed; (b) promote the next uncovered top-10 harvest county (Riverside / San Bernardino / Alameda / San Diego CA, NYC NY) if the owner gap persists after Orange CA pilot build. With the owner/tax-roll lane fully mature, advance the source-intelligence queue to the **official on-market feed** lane. Per `property-intelligence-status.md` current blockers: "RESO connector is scaffolded but lacks feed URL/token configuration" and "RentCast listing poll returned 401 auth/api-key-invalid." Next bounded loop: reconcile `data/source-registry/pilot-manifest-onmarket-reso-2026-06-27.md` against these blockers and define the build-time DUA/OAuth2 + API-key resolution path (no scraping of MLS portals). On-market pilots already scaffolded: RESO, HUD HomeStore (`pilot-manifest-onmarket-hud-homestore-2026-06-27.md`), USDA RD (`pilot-manifest-onmarket-usda-rd-2026-06-27.md`). Photo/imagery sidecar (status: `with candidate: 0`, `gaps: 13933`) has lawful pilots scaffolded (NAIP, Street View metadata, Miami-Dade, Hillsborough) and awaits build-time API-key/endpoint confirmation.

## Files
- This report: `data/source-registry/owner-taxroll-candidate-2026-06-27.md`
- Inspected this loop (iter 149, 2026-06-28): full re-read of this file + direct directory inventory of `data/source-registry/` to reconcile manifest count (corrected stale "4 manifests" → 7).
- Verified owner/tax-roll pilot manifests (8): `pilot-manifest-taxroll-maricopa-2026-06-27.md` (AZ, LOCKED), `pilot-manifest-county-taxroll-2026-06-27.md` (Miami-Dade FL), `pilot-manifest-taxroll-clark-nv-2026-06-27.md` (NV), `pilot-manifest-taxroll-harris-2026-06-27.md` (TX), `pilot-manifest-taxroll-losangeles-ca-2026-06-27.md` (CA), `pilot-manifest-taxroll-santaclara-ca-2026-06-27.md` (CA), `pilot-manifest-taxroll-cook-il-2026-06-28.md` (IL), `pilot-manifest-taxroll-hillsborough-fl-2026-06-28.md` (FL, promoted iter 152).
- DRAFT owner/tax-roll pilot manifest (1, connector-ready, pending VERIFIED stamp): `pilot-manifest-taxroll-orange-ca-2026-06-28.md` (Orange County CA, promoted iter 191; reconciled into this candidate's status section iter 195, 2026-06-28).
- Inspected this loop (iter 195, 2026-06-28): re-read this file + `pilot-manifest-taxroll-orange-ca-2026-06-28.md` (iter 191 DRAFT) to reconcile the stale "8 manifests / no unpromoted candidates" claim → corrected to 8 VERIFIED + 1 DRAFT (Orange CA) = 9 manifests on disk.
- Promoted candidate (no longer unpromoted): `owner-taxroll-candidate-hillsborough-fl-2026-06-27.md` → `pilot-manifest-taxroll-hillsborough-fl-2026-06-28.md` (iter 152).
- Inspected this loop (iter 155, 2026-06-28): full re-read of this file + `pilot-manifest-taxroll-hillsborough-fl-2026-06-28.md` + direct `data/source-registry/` directory listing to reconcile manifest count (corrected stale "7 manifests + Hillsborough pending" → 8 manifests, Hillsborough promoted).
- Earlier loops inspected: `data/source-registry/property-intelligence-status.md`, `data/source-registry/pilot-manifest-county-taxroll-2026-06-27.md`.

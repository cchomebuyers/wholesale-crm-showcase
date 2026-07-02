# Wholesale CRM / Thinga Acquisition Engine

Local-first real-estate wholesaling CRM plus a broader Thinga graph substrate.

The original app is a working CRM for leads, buyers, outreach, tasks, offers, and email. The current system is larger: it ingests public property signals, mirrors CRM objects into a universal Thinga graph, ranks a pro wholesaler queue, plans legal contact routes, preserves proof stacks, gates outreach through compliance, and exposes buyer/seller marketplace surfaces.

## Current Status

Test suite (re-run `NO_BACKUP=1 npm test` to refresh): `475` tests, `475` pass, `0` fail — including a boot smoke suite (`server_smoke.test.js`) that starts the real server against the real db every run.

Runtime counts below are the June 30, 2026 audit snapshot from `audit/june30/06-database-live-state.md`. The database changes, so treat them as historical and re-derive current counts from that audit file (or the audit command behind it) rather than trusting these numbers verbatim:

- `crm.db` contained `10,000` properties, `1,046` leads, `291` buyer-discovery candidates, and `10,000` pro-queue rows.
- The Thinga substrate is live beside the CRM tables: `thingas`, `thinga_links`, and `thinga_meta`.
- The graph contained `10,000` `property` Thingas, `10,000` `route_pack` Thingas, `1,046` `lead` Thingas, and `119` connector Thingas.
- The pro queue held `401 pay_to_unlock`, `2,329 research`, `7,270 hold`, and `0 call_now` (`audit/june30/06-database-live-state.md`).

The honest blocker: the system can rank where to spend next, but it is not yet an industrial call-ready machine. Seller phone acquisition, DNC clearance, and live paid skiptrace execution are still the gates. Every pro-queue row now states *exactly* which of these gates is blocking it — see Operator Visibility below.

## Core Architecture

The intended core is one datatype: the `Thinga`.

```text
Thinga / Node
  id
  kind
  data/content
  relationships
```

The direction is: build one graph, render many projections. The CRM, buyer portal, seller intake, map, proof stack, council/agent review, terminal/server/relay/storage views, and future world/IDE views should all be projections of the same underlying graph.

Important files:

- `thinga.js` - signed `PUT` / `GET` / `QUERY` / `INVOKE` runtime over SQLite.
- `faceted_thinga.js` - content-addressed faceted Thinga format and parser registry.
- `parser_registry.js` - `kind -> schema -> parser` registry; real estate is config #1.
- `field_edges.js` - fields propose candidate graph edges.
- `route_planner.js` - legal path planner for contact/identity routes.
- `route_engine.js` - generic capability/route execution kernel.
- `crm_thinga.js` - mirrors legacy CRM rows into Thingas.
- `server.js` - Express app and API surface.

## What It Does

- Lead pipeline: stages, notes, calls, tasks, offers, emails, and follow-ups.
- Buyer management and buyer-discovery candidate promotion.
- Property ingestion from public/legal sources through connectors.
- Property scoring, owner enrichment, ARV/MAO, and pro queue tiering.
- Contact route planning: address, owner, business, permit, skiptrace, and consent routes.
- Compliance gate: default deny; DNC/consent/opt-out rules control outreach.
- Seller intake page for first-party consent.
- Buyer signup and buyer-safe marketplace/proof-stack views.
- Council/agent ledger for coordinated review and audit loops.

## Operator Visibility & Readiness

The system is built so an operator (or a fresh worker) can tell *what is true and what is blocking* without reading code:

- **Why-not-call-now** — every `GET /api/pro-queue` row carries `why_not_call_now` (an ordered list of `{key, label, fix}` blockers) and `call_now_ready`. The ordered blocker keys are `not_a_seller`, `owner_missing`, `contact_missing`, `dnc_consent_missing`, `arv_mao_missing`, `buyer_demand_missing`, `seller_price_missing`, `proof_incomplete`. A found phone is never callable until DNC + consent verify (deny-by-default via `compliance_gate.js`). See `docs/pro_wholesaler_queue.md` ("Why-not-call-now").
- **Ops readiness** — `node tools/ops_readiness_report.mjs` prints a JSON read-model of whether the system is ready to source / enrich / skip-trace / operate (server, database, backups, Postgres, sources, credentials, skip-trace, DNC). Credentials are reported as *presence only*, never values; there is intentionally no system-wide `ready_to_contact` (contact is per-contact, deny-until-checked). See `docs/ops_readiness.md`.
- **Feature graph** — `data/feature-graph/*.json` maps each major feature to its code, routes, tests, tables, docs, and audit findings. Open one manifest to see everything that defines a feature. See `docs/feature-graph.md`.

## Run

```bash
npm install
npm test
npm start
```

Open:

```text
http://localhost:4000
```

Boot caveat RESOLVED (July 2, 2026): the missing-backups-symlink crash is fixed — startup degrades to backups-disabled with a logged "[backup] disabled" warning instead of throwing, and every test run boots the real server via `server_smoke.test.js` to prove it. If `backups/` points at a missing external drive, backups stay off until the target returns; everything else runs normally.

## Data

Everything local lives in `crm.db`. The project uses regular CRM tables and mirrors many objects into the Thinga substrate. This is a migration state, not the final architecture.

The final direction is not seven separate apps. It is one graph with projections:

- CRM projection
- Pro queue projection
- Buyer marketplace projection
- Seller intake projection
- Map/proof projection
- Agent/council projection
- Future server/relay/storage/world/IDE projections

## Rules

- Go to the source, not the wall: official/public APIs and licensed feeds, not Zillow/CoStar/people-search scraping.
- Sold records are comps/ARV fuel, not seller leads.
- Found contact data is not automatically callable.
- Compliance gates every outreach channel.
- B2B/operator phone records belong on the buyer/enrichment side, not as seller inventory.
- Secrets do not enter the substrate; store key presence only.
- Keep `npm test` green.

## Audit

The June 30 verification audit is in:

```text
audit/june30/00-index.md
```

It covers folder structure, live database state, docs-vs-code drift, agent history, tests, professional wholesaler fit, industrial readiness, one-datatype/Thinga truth, projection architecture, the open-web technology stack, and the CRM quality/visibility meta-audit.

The follow-up development plan that turns the audit into executable future work is in:

```text
dev/plans/2026-06-30-cohesive-vision/00-README.md
```

## Next Real Milestone

Move records from `pay_to_unlock` into `call_now` by wiring:

1. Paid skiptrace result persistence.
2. DNC/compliance status persistence.
3. Queue rebuild that promotes cleared contacts.
4. Call outcome tracking.

Until that is done, this is a strong research, evidence, and prioritization engine. After that, it becomes a daily acquisitions execution system.

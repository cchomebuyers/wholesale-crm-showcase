# Wholesale CRM / Thinga Acquisition Engine

Local-first real-estate wholesaling CRM plus a broader Thinga graph substrate.

The original app is a working CRM for leads, buyers, outreach, tasks, offers, and email. The current system is larger: it ingests public property signals, mirrors CRM objects into a universal Thinga graph, ranks a pro wholesaler queue, plans legal contact routes, preserves proof stacks, gates outreach through compliance, and exposes buyer/seller marketplace surfaces.

## Current Status

Verified June 30, 2026:

- `npm test` passes: `394` tests, `394` pass, `0` fail.
- `crm.db` contains `10,000` properties, `1,046` leads, `291` buyer-discovery candidates, and `10,000` pro-queue rows.
- The Thinga substrate is live beside the CRM tables: `thingas`, `thinga_links`, and `thinga_meta`.
- The graph contains `10,000` `property` Thingas, `10,000` `route_pack` Thingas, `1,046` `lead` Thingas, and `119` connector Thingas.
- The pro queue currently has `401 pay_to_unlock`, `2,329 research`, `7,270 hold`, and `0 call_now`.

The honest blocker: the system can rank where to spend next, but it is not yet an industrial call-ready machine. Seller phone acquisition, DNC clearance, and live paid skiptrace execution are still the gates.

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

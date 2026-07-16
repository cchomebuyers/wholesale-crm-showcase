# Wholesale CRM

A real-estate wholesaling CRM I built and run my own lead pipeline through.
Local-first Node.js: leads, pipeline stages, cash buyers, offers, deal math,
and two-way email - all in one app, with the data in a single SQLite file.

Built solo: 17,000+ lines across 90+ modules, 183 commits, 422 automated tests.

## Try it in 60 seconds

Requires Node 26+ (uses the built-in `node:sqlite`; only four runtime
dependencies).

```
npm install
npm run seed     # builds a demo database of fabricated leads and properties
npm start        # http://localhost:4000
npm test         # 422 tests
```

`npm run seed` generates invented data only: 555-range phone numbers,
example.com emails, fictional street names, and made-up buyer companies. No
real lead, seller, or customer data ships in this repo, and the seed never
calls a paid or external API.

## What it does

- **Lead pipeline** - 7 stages (New through Closed), one-tap activity logging,
  follow-up cadences, daily offer targets, and a calendar with day notes.
- **Deal math** - MAO calculator with live comps, cash / seller-finance /
  subject-to / hybrid offer structures, amortization schedules with balloon
  comparisons, DSCR and cash-on-cash gates.
- **AI lead qualification** - Claude (Anthropic API) drafts deal briefs,
  qualifies leads, and writes outreach; keys are user-supplied and optional.
- **Data enrichment** - connectors to 12+ public data sources (county tax
  rolls, city open-data portals, US Census, EPA, RentCast) that pull owner and
  property records automatically on lead creation.
- **Two-way email** - IMAP inbox sync, reply detection, per-lead conversation
  threads, template merge fields, and an offer send-queue (SMTP; credentials
  are user-supplied and optional).
- **Buyer matching** - mines public recorded-sale data to find active cash
  buyers near a property, ranked by how often they buy.

## Testing

`npm test` runs 422 tests with Node's built-in runner - unit tests colocated
with every module plus a boot-smoke suite that starts the real server and
exercises the money-path endpoints against the seeded database.

## Note on data

`crm.db`, backups, logs, and `.env` are gitignored on purpose. The engine is
public; the pipeline it runs is not.

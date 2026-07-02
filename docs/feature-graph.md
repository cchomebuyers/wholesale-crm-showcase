# Feature Graph

A developer-visible map from each major product feature to the **code, routes,
tests, tables, docs, audit findings, and next actions** that define it. Open one
manifest and you can answer, for a feature: what implements it, what HTTP routes
expose it, what tests protect it, what database tables it touches, what docs
describe it, what the June 30 audit said about it, and what to build next.

This is the "IDE View / Graph View" the audit asked for: a first-class map from a
feature to its files/tests/docs/data, instead of rediscovering it by code spelunking
(`audit/june30/26-graph-view-projection.md`,
`audit/june30/27-crm-meta-projection-quality-visibility.md`).

## Where it lives

```
data/feature-graph/
  _shape.json                  # the manifest shape/spec (field-by-field)
  index.json                   # list of all manifests + pending sibling facts
  pro-queue.json
  contact-route.json
  proof-stack.json
  investor-marketplace.json
  seller-intake.json
  thinga-substrate.json
  ops-readiness.json
docs/feature-graph.md          # this file
```

## The shape

Each manifest is JSON with these fields (full spec in `data/feature-graph/_shape.json`):

| field | meaning |
|-------|---------|
| `feature` | human name |
| `id` | stable slug (matches the file name) |
| `summary` | one line: what the feature does |
| `files` | `{ path, role }[]` — source modules/tools/packs that implement it |
| `routes` | `{ method, path, server_line, summary }[]` — HTTP routes in `server.js` |
| `tests` | `{ path, role, missing? }[]` — tests that protect it |
| `tables` | `{ name, defined_in, role }[]` — DB tables it reads/writes |
| `docs` | `{ path, role, pending? }[]` — docs that describe it |
| `audit_findings` | `{ source, finding }[]` — relevant June 30 audit findings |
| `next_actions` | `{ action, status, note? }[]` — what to build next (`done`/`open`/`pending`) |

## Integrity rules (these manifests are verified, not guessed)

- Every `path` under `files`, `tests` (unless `missing:true`), and `docs` (unless
  `pending:true`) **exists on disk**.
- Every `route` **exists in `server.js`** at the cited `server_line`.
- A test that does not yet exist is kept in the list but marked `"missing": true`
  (e.g. `real_estate_thinga.test.js` in `thinga-substrate.json`).
- A fact owned by another in-flight agent that has not landed yet is marked
  `"pending": true` / `status:"pending"` with a note — **key names are never
  invented**. In this run the sibling facts landed before finalize, so they are
  cited verbatim from verified files: CALLNOW's real `why_not_call_now` blocker
  keys in `pro-queue.json`, and OPS's `buildOpsReadiness` surface in
  `ops-readiness.json` (see `index.json -> incorporated_sibling_facts`).

## How to use it

- **New to a feature?** Open `data/feature-graph/<id>.json` and read top to bottom.
- **Touching a route?** Find the route in the relevant manifest to see which module
  handles it and which tests cover it before you edit.
- **Before a refactor?** The `tests` list tells you what protects the code; the
  `tables` list tells you what data you might break.
- **Planning work?** `next_actions` carries the open/pending follow-ups, cross-linked
  to the audit findings that motivated them.
- **Programmatic use:** `index.json` lists every manifest; load it, then load each
  `file`. All manifests are plain JSON and parse with `JSON.parse`.

## Keeping it honest

These are hand-built manifests (deliberately — fragile code parsing was rejected per
the loop prompt). When you move a file, rename a route, add a test, or close a
`next_action`, update the matching manifest. The integrity rules above are the
contract: if a listed path stops existing or a route moves, the manifest is stale.

## Coverage

Seven features are mapped: Pro Queue, Contact Route, Proof Stack, Investor Marketplace,
Seller Intake, Thinga Substrate, and Ops Readiness. The first five are the set called
out in `audit/june30/27-crm-meta-projection-quality-visibility.md` ("Make a feature
graph for Pro Queue, Contact Route, Proof Stack, Marketplace, and Seller Intake");
Thinga Substrate underlies them; Ops Readiness maps the new ops read-model (built by
the OPS agent in this run). It is not the whole CRM surface (e.g. the lead-engine,
council, and ecosystem-plan subsystems are not yet mapped).

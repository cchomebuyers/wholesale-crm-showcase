# ContactRouteEngine

Generalizes "owner-join + skip-trace" into one engine: **given a target and a need, find the
shortest LEGAL, evidence-backed path to the right person/business, through the best allowed
channel — and block illegal outreach.** Real estate is config #1; the engine is domain-agnostic
(see `dev/architecture/NORTH_STAR_VISION.md`). Skip-trace is just one subsystem.

## Pipeline

```
node (property/owner/business)
  → field_edges.extractFields      what we already know (joinable fields)
  → route_planner.planRoutes       shortest LEGAL path to the goal field (RED sources excluded)
  → (execute the route)            connectors fetch the contact  [not done by the planner]
  → compliance_gate.complianceCheck a found contact is NEVER callable until DNC/consent clears
```

`contact_route_engine.resolveContactRoute({ node, goal, hasKeys, candidate })` ties these together
and is exposed at **`POST /api/resolve/contact-route`** (`{ property_id }` or `{ node }`).

## Modules

| File | Role |
|------|------|
| `field_edges.js` | Nodes store facts; **fields propose candidate edges** (`FIELD_JOIN_REGISTRY`, `proposeEdges`, `groupByTarget`). Candidate ≠ confirmed; provenance kept. |
| `route_planner.js` | `ROUTE_FAMILIES` + `planRoutes`: reachable-field expansion (2-hop chaining), cost scoring, RED exclusion, paid-key gating. |
| `source_policy_registry.json` | Every source tagged **GREEN/YELLOW/RED** + cost/legal_risk/freshness/channels/required key. |
| `compliance_gate.js` | Authoritative DNC/TCPA/CASL/consent/opt-out/channel gate. Default **deny**; overrides any source claiming `outreach_allowed:true`. |
| `consent.js` | First-party consent edge — the **cleanest route**; flips `outreach_allowed:true` WITHOUT paid skip-trace. |
| `contact_route_engine.js` | `resolveContactRoute` — the resolver. |

## Route families (`route_planner.ROUTE_FAMILIES`)

- `address → parcel → owner` (assessor/tax-roll) — built as `connectors/owner_source.js`.
- `owner LLC → Secretary of State → registered agent`.
- `address → business license / permit → phone`.
- `owner + address → paid skip-trace → phone` (needs `batchdata_api_key`; gate still applies).
- `first-party consent → contact` (cleanest; `consent.js` + `POST /api/seller-lead` + `public/sell.html`).

## Route cost (lower = better; a longer path may win if safer/cheaper/more confident)

```
cost = source_cost + legal_risk*2 + false_match_risk + latency*0.1 + manual_effort*0.1
       − base_confidence − first_party_consent_bonus
```

## Source legality classes

- **GREEN** — official public APIs, permitted-use paid vendors, first-party consent, business-license/permit, assessor/tax under published terms.
- **YELLOW** — manual official lookups, unclear-reuse pages, rate-limited directories.
- **RED** (never planned) — CAPTCHA/Cloudflare bypass, leaked data, scraping vs terms, guessed-as-verified, consumer-report data without FCRA purpose.

## Compliance (the gate is authoritative)

A found phone/email is NOT callable just because a route returned it. Per channel:
- **call** — needs phone + DNC clear (or first-party express consent).
- **sms / email** — need explicit consent (TCPA/CASL).
- **mail** — not restricted by DNC/TCPA/CASL.
- **opt-out** — hard stop on every channel.

First-party express consent (`consent.js`) is the lawful basis that flips `outreach_allowed:true`
for exactly the channels the seller opted into — the only path to a callable contact with no paid spend.

## Endpoints

- `POST /api/resolve/contact-route` — plan a legal path to a contact (read-only; no paid calls).
- `POST /api/seller-lead` — record a first-party consent edge; returns the compliance result.

## Status (2026-06-29, overnight multi-agent loop)

Vertical built + test-gated (`route_planner.test.js`, `compliance_gate.test.js`,
`field_edges.test.js`, `contact_route_engine.test.js`, `consent.test.js`). Executing the planned
non-consent routes against live connectors is the next step; skip-trace routes light up when
`batchdata_api_key` is set.

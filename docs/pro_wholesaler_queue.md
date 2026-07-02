# Pro Wholesaler Queue

Turns the property database (10,000+ records) into a working wholesaler's operating
queue. A pro does not work 10,000 vague rows — they work a ruthless split.

## Tiers (highest attention first)

| Tier | Meaning | Entry rule | Next action |
|------|---------|-----------|-------------|
| `call_now` | reach + value + live spread | score ≥ hot, contact callable, value known, spread ≠ fails | call seller / make offer |
| `pay_to_unlock` | real distress, can't reach yet | score ≥ hot + distress signal, missing owner/phone | skip-trace (spend allowed) |
| `research` | interesting, missing data | score ≥ min, not parcel-only, missing owner/ARV/buyer | free enrichment first |
| `hold` | parcel-only / weak | parcel-only, or score < min, or no signal | ignore until a signal appears |

Defaults: `hot-score=70`, `min-score=60`. Distress is read from the source name
(`violation|vacant|abandon|condemn|delinquen|forecl|probate|lien|...`) and from
`distress_score`/`motivation_score`. Spread comes from `wholesale_spread.js`.

## Why-not-call-now (operator visibility)

Every row explains **exactly** what is keeping it out of `call_now` and the cheapest
next action to unblock it. Pure function `whyNotCallNow(record, opts)` in
`pro_wholesaler_queue.js` returns an **ordered** list of `{key, label, fix}` blockers
(empty list = call-now-ready). `classifyProQueue` carries it as `why_not_call_now`
(+ `call_now_ready` boolean), and `GET /api/pro-queue` attaches both to each item.

Blocker keys, in operator free-work order (do the cheapest unblock first):

| # | key | meaning | unblock |
|---|-----|---------|---------|
| 1 | `not_a_seller` | institutional/govt/lender owner (hard stop) | drop from seller pipeline |
| 2 | `owner_missing` | owner identity unknown | free owner-join (assessor/parcel) |
| 3 | `contact_missing` | no phone/email on file | free contact enrichment, then skip-trace gate |
| 4 | `dnc_consent_missing` | contact present but not cleared to call | DNC scrub + confirm consent (mail-only until then) |
| 5 | `arv_mao_missing` | no ARV/MAO valuation | free comps → ARV → MAO |
| 6 | `buyer_demand_missing` | no matched buyer demand | match buy-boxes / discover buyers |
| 7 | `seller_price_missing` | no seller price evidence | capture asking/contract price or seller intake |
| 8 | `proof_incomplete` | assignment spread not yet proven to work | complete the proof stack so the spread holds |

`call_now` requires **all** blockers cleared. **Hard rule (CLAUDE.md ground rule 2):** a found
phone is never callable until DNC + consent verify — a phone with unverified DNC reports
`dnc_consent_missing` (routed through `compliance_gate.js#complianceCheck`, deny-by-default) and
stays out of `call_now`. `contact_missing` and `dnc_consent_missing` are mutually exclusive.
`CALL_NOW_BLOCKERS` / `CALL_NOW_BLOCKER_KEYS` are exported for downstream citation.

`GET /api/pro-queue` per-item shape (additions): `why_not_call_now: [{key,label,fix}]`,
`call_now_ready: boolean`. The route reads contact/seller-price columns only to compute the
blockers — seller phone/email are not included in the response.

## Files

- `pro_wholesaler_queue.js` — pure classifier (`classifyProQueue`, `summarizeProQueue`,
  `distressSignal`, `contactState`, `valueState`, `whyNotCallNow`). No I/O.
- `pro_wholesaler_queue.test.js` — gate tests.
- `tools/build_pro_queue.mjs` — reads `crm.db` properties, classifies, writes
  `data/pro_queue_snapshot.jsonl` + `data/pro_queue_summary.json`; `--persist` upserts a
  `pro_queue` table. Flags: `--limit=N --hot-score=70 --min-score=60 --persist`.

## Footprint snapshot (historical — 2026-06-28)

> **Stale counts.** This is a 2026-06-28 snapshot and no longer matches the live
> database (e.g. the June 30 audit shows `pay_to_unlock=401`, `research=2,329`,
> `hold=7,270`, and owner/ARV partially populated). For current pro-queue tier
> counts and enrichment state, see `audit/june30/06-database-live-state.md`, or
> rebuild the snapshot with `node tools/build_pro_queue.mjs`. Do not trust the
> figures below as current.

```
call_now=0  pay_to_unlock=404  research=2359  hold=7237
top_missing: owner=10000  seller_phone=10000  arv=10000  buyer_demand=10000
```

The structural point still holds: the binding constraint is **enrichment, not raw
volume** — the `pay_to_unlock` records are the real working list (owner-join +
skip-trace these first), and `call_now=0` stays honest until contacts are acquired
and DNC/consent-cleared. Each row's `why_not_call_now` (above) names the exact gate.

## Build order (remaining)

1. ~~classifier + runner~~ (done — milestone 1)
2. server routes: `POST /api/pro-queue/rebuild`, `GET /api/pro-queue?tier=`
3. UI "Pro Queue" tab (4 tier sections)
4. owner-join layer (property → owner/APN/mailing) on `pay_to_unlock` only
5. ARV/valuation layer → fills `arv`/`mao`/`spread`
6. buyer-demand layer (B2B asset belongs HERE, as buyers — never seller leads)
7. skip-trace spend gate (only `pay_to_unlock`/`call_now`, score ≥ 70, owner known)

## Boundary

B2B/operator-phone records are **never** seller leads here. They enter only as
buyer-discovery candidates downstream of an existing property lead.

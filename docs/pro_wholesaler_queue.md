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

## Files

- `pro_wholesaler_queue.js` — pure classifier (`classifyProQueue`, `summarizeProQueue`,
  `distressSignal`, `contactState`, `valueState`). No I/O.
- `pro_wholesaler_queue.test.js` — gate tests.
- `tools/build_pro_queue.mjs` — reads `crm.db` properties, classifies, writes
  `data/pro_queue_snapshot.jsonl` + `data/pro_queue_summary.json`; `--persist` upserts a
  `pro_queue` table. Flags: `--limit=N --hot-score=70 --min-score=60 --persist`.

## Current footprint (2026-06-28, 10,000 properties)

```
call_now=0  pay_to_unlock=404  research=2359  hold=7237
top_missing: owner=10000  seller_phone=10000  arv=10000  buyer_demand=10000
```

The blocker is **enrichment, not raw volume**: 0 owners, 0 ARV, 0 phones. The 404
`pay_to_unlock` records are the real working list — owner-join + skip-trace these first.

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

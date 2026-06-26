# loop.md — the autonomous build loop for the Thinga integration

> **What this is:** the standing prompt a `/loop` reloads each iteration to drive the wholesale-crm
> onto the Ankhor/Thinga substrate **and** wire the connector layer in — top-quality, regulated
> (gated + tested), one reversible concern at a time. Read the referenced files; do not re-derive.

## Read first (every iteration)
1. `dev/plans/6-26-26/00-OVERVIEW.md` — the thesis + the full map of everything we have.
2. `dev/plans/6-26-26/01-SUBSTRATE.md` — the 13-iter table→kind ladder (the spine of this loop).
3. `dev/plans/6-26-26/02-CONNECTORS.md` — the connector registry + RESO (folds in at iter 10).
4. `dev/plans/6-26-26/03-DATA-FOUNDATION.md` — `rulesreg/` as connector config + outreach gate.
5. `dev/plans/6-26-26/04-EXECUTION.md` — branches, sequencing, the per-iter gate, what unblocks what.
6. `dev/plans/6-26-26/PROGRESS.md` — what's shipped and the next concern. **Update it every iter.**
7. Canonical substrate: `../yearTwo777/synthesis/ANKHOR_ARCHITECTURE.md` (six axes, PUT/GET/INVOKE).

## The loop body (one concern per iteration)
1. **Pick** the next concern from `PROGRESS.md` (the iter ladder in `01-SUBSTRATE.md` §7).
2. **Build** it — top-quality code in the style of `server.js` (ES modules, `node:sqlite`, terse comments).
   - Substrate code goes through `thinga.js` (PUT/GET/INVOKE). Connectors implement `search(target)→[lead]`.
   - Code Thingas resolve to **registered handlers by name — never `eval`** (the 5DEngine pattern).
3. **Prove** it — extend `thinga.test.js` (or a sibling `*.test.js`); the app's `/api/*` must stay
   byte-identical where touched. **Tests must pass before commit.**
4. **Regulate** it — enforce the lead spec as `schema: ankhor.v1.lead` (sold→`comps`, no-contact→
   `pending_research`); enforce the outreach gate from `rulesreg/<market>/data-privacy-and-marketing/`
   before any send/call (DNC/GDPR/CASL). Legality is the moat, not an afterthought.
5. **Ship** it — `git commit -m "iterN(<branch>): <concern>"`. Never commit to `main`.
6. **Meta-plan** — append one line to `PROGRESS.md`: what shipped, what's next, any STUCK note.

## The gate (non-negotiable, "regulated")
```
node --test            # all green, every public API + touched route covered
git add -A && git commit -m "iterN(<branch>): <concern>"
```

## Branch ownership (from 04-EXECUTION §2)
- `runtime` — `thinga.js` + its tests + the rulesreg round-trip proof (build once, shared).
- `thinga-substrate` — the `server.js` table→kind migration (owns the live app's parity).
- `connector-registry` — `connectors/` + `rulesreg/` (the source catalog + the outreach gate).

## Stop conditions
- A `docs/HALT` file at repo root → stop **all** loops immediately.
- The iter ladder reaches "legacy deleted" (the via-negativa endgame).
- Three consecutive `STUCK` entries in `PROGRESS.md`.
- The user says stop.

## Unblocks (carry forward until cleared)
- **RESO aggregator token** (SimplyRETS sandbox) → unblocks `connectors/reso.js` (Zillow-grade on-market data).
  Everything else proceeds without it.

## Current position
Branch `runtime`, iter 1–2 done: `thinga.js` runtime built + 23 passing tests + `docs/ankhor.v1.json`
frozen. **Next concern:** the rulesreg byte-round-trip proof (`tools/prove_rulesreg.mjs`), then begin the
`thinga-substrate` table migration. See `PROGRESS.md`.

# PARITY.md — Phase 9 gate: can the originals be deleted?

**Spec Phase 9:** "Port approved features from HTML file A, then B … Confirm
feature parity, **then** delete originals."

## Verdict: parity NOT confirmed → originals stay (by the spec's own rule)

The workspace intentionally covers the spec's five views (Today, Acquisitions,
Dispo, Buyers, Analytics). The originals carry capabilities **outside the
workspace spec** that would be destroyed by deletion:

| Capability | Lives in | Workspace equivalent? |
|---|---|---|
| Email Inbox + two-way reply + IMAP sync | operator UI (Inbox) | none (out of spec scope) |
| Outreach templates + merge-field compose + send | operator UI (Outreach) | none |
| Fill Properties (no-spend pipeline, tiered call queue, CSV) | operator UI (Fill) | none |
| Sources / lead-engine console (20+ endpoints, council jobs, spread audit) | operator UI (Sources) | none |
| Acquisitions connect panels (RentCast/AI/BatchData/Gmail), campaigns, property feed | operator UI (Acquisitions) | partial (kanban ≠ property feed) |
| Map (Leaflet pins) | operator UI (Map) | none |
| 4-mode Deal Calc w/ amortization | operator UI (Deal Calc) | inline MAO calc only (spec-scoped) |
| Clawdbot agents panel + coach HUD | Focus dashboard | complementary (Today view covers the coach's next-action job) |

## What WAS ported/rebuilt into the workspace (spec scope, done)
- Today view (one-tap logging + cadence + streak + confetti + focus timer)
  ← rebuilt from Focus's coach/directives/hero concepts.
- Acquisitions kanban + inline MAO ← rebuilt from operator Leads board ideas.
- Deal creation w/ blocking Ontario disclosure (new, spec).
- Dispo board + buyer matching + blast + closing countdown (new, spec;
  matching semantics from `buyer_matching.js` concepts).
- Buyers table + buy boxes (new UI over the existing `buyers` table).
- Quick capture `l/b/t` (rebuilt from Focus brain-dump).
- Analytics-lite (rebuilt from operator stats, cut to 4 numbers + 1 chart).

## Standing PM decision
All three surfaces read/write the same `crm.db`, so they cannot drift:
- **/workspace** — the daily ADHD-optimized driver (this spec).
- **/** (operator UI) — the deep-tooling console (inbox, outreach, sources, map).
- **/focus** — the agents HUD (clawdbots, KPIs vs targets).

Deletion of originals should be revisited only if/when the workspace absorbs
Inbox, Outreach, Fill, Sources, and Map — a scope the current spec explicitly
does not include ("Do not add features not in this spec without asking").

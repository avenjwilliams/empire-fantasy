# 06 — Implementation Plan

Build in this order. Each phase ends with something runnable and its tests passing. Don't start a phase until the previous one works.

## Phase 1 — Foundation

- Scaffold npm workspaces (`client`, `server`, `shared`), TypeScript strict, Vitest, ESLint.
- `shared/leagueTypes.ts`: generate the 24-combo matrix; code builder/parser; tests.
- `shared/value.ts`: `clampRound`, `trueValue`, depth weights, `evaluateTrade` per doc 04; full unit tests including the 5 invariants.
- Server: Express skeleton, migration runner, `001_init.sql` schema from doc 01, session middleware.

**Done when**: `npm test` green; server boots and creates the DB with 24 league_types rows.

## Phase 2 — Seed pipeline

- Build `data/fixtures/` first (doc 02) and wire the `--fixtures` flag — develop the whole pipeline against fixtures, then verify against live APIs.
- `scripts/seed.ts` per doc 02: Sleeper players → DB; seed rankings via `SeedSource` priority (manual CSVs → scrape → ADP fallback); rank→value curve; 4 base sets → 24 sets expansion; pick seeding; log + snapshot; CSV export.
- `scripts/import-rankings.ts` / `export-rankings.ts` with diff + manual logging.

**Done when**: seeded DB has values for ~400 players × 24 sets + picks × 12 DYN sets; `data/rankings/` has 24 sensible CSVs; editing a CSV value and importing produces a `manual` log row.

## Phase 3 — Read APIs + Rankings UI

- Routes: league-types, rankings, asset search, asset detail, log.
- Client: theme.css + retro shell, top bar with `LeagueTypeSelector`, Rankings page, Player detail (chart can stub until history accumulates), Log page.

**Done when**: browsing rankings for any of the 24 league types works, player detail shows the 24-set value grid and log entries.

## Phase 4 — Trade Calculator

- `POST /api/trade/evaluate` (validation per doc 04 edge cases) wired to `shared/value.ts`.
- Calculator page: two-team builder, debounced auto-eval, TradeScale meter, verdict, evener hint.

**Done when**: the doc-04 invariant scenarios display correctly in the UI.

## Phase 5 — Keep/Trade/Cut

- Prompt generation + vote application per doc 03 (Elo pairwise, K=0.20, dampening), rate limits, no-repeat trios.
- KTC page with first-visit landing behavior.

**Done when**: voting visibly nudges values (check log), caps and repeat protection enforced, values move ≤0.4/vote.

## Phase 6 — Stats ingestion

- `scripts/ingest-week.ts`: Sleeper week stats → per-league-type points → expectation model → capped deltas → logs. Idempotent per week.
- Nightly `value_history` snapshot script.
- Verify Sleeper stats endpoint shape early in this phase; adjust the points mapper to actual field names (`pass_yd`, `rec`, etc.).

**Done when**: ingesting the fixture week (then a real week) adjusts values within caps, bye players untouched, re-run is a no-op.

## Phase 7 — Polish

- Value-over-time charts with real history; mobile pass; empty/error states; README with setup + season-operations runbook (weekly ingest, CSV editing workflow).

## Testing priorities

Unit: all `shared/value.ts` math, vote math, stat-adjustment math, rank→value curve, CSV import diff. Integration: seed → vote → ingest → log/history consistency (every value change has exactly one log row; history snapshot matches current values on snapshot day).

## Deferred (post-v1)

Pick time-decay job, exact rookie pick slots, injury-aware adjustments, user accounts, light/dark themes, league import from Sleeper.

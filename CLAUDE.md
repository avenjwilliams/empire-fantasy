# Empire Fantasy — Fantasy Football Trade Calculator

Multi-user fantasy football trade calculator with living player rankings that evolve from crowd votes (KEEP/TRADE/CUT) and real NFL performance.

## Read these before writing code

| Doc | Contents |
|---|---|
| `docs/00-overview.md` | Product vision, features, glossary, league type matrix |
| `docs/01-architecture.md` | Stack, project structure, database schema, API routes |
| `docs/02-data-pipeline.md` | Seeding rankings, CSV format, Sleeper API, weekly stat ingestion |
| `docs/03-scoring-adjustments.md` | 1–100 value system, KEEP/TRADE/CUT vote logic, performance adjustments, adjustment log |
| `docs/04-trade-calculator.md` | Trade evaluation algorithm, nonlinear value curve, multi-player penalty, verdict scale |
| `docs/05-ui-spec.md` | Screens, components, minimalist retro design direction |
| `docs/06-implementation-plan.md` | Phased build order — follow this sequence |

## Stack

- Frontend: React (Vite), plain CSS (no UI framework — retro aesthetic is custom)
- Backend: Node.js + Express
- Database: SQLite via `better-sqlite3`
- Language: TypeScript everywhere
- Monorepo layout: `client/`, `server/`, `data/`, `scripts/`

## Hard rules

1. **Player values are 1.0–100.0, one decimal place.** Round with `Math.round(v * 10) / 10` at every write. Clamp to [1.0, 100.0].
2. **Every value change writes a row to `adjustment_log`.** No exceptions — seeds, votes, stat updates, manual CSV edits all log.
3. **SQLite is the source of truth at runtime.** CSVs in `data/rankings/` are the human-editable interface; sync via `scripts/export-rankings.ts` and `scripts/import-rankings.ts` (import diffs against DB and logs each changed value as `reason='manual'`).
4. **League types are the 24-row matrix** defined in `docs/00-overview.md`. Always reference by `code` (e.g. `DYN_SF_PPR_TEP`). Never hardcode a subset.
5. **Only QB, RB, WR, TE players.** Plus rookie draft picks as assets in Dynasty league types only.
6. **No auth for v1 multi-user** — anonymous sessions via cookie UUID. All votes feed one shared ranking state.
7. Individual adjustments are small by design (see caps in `docs/03-scoring-adjustments.md`). Never let one vote or one game swing a value more than its cap.
8. **Commit and push at the end of every phase** in `docs/06-implementation-plan.md`. Don't leave a finished phase uncommitted — `git add -A && git commit -m "..." && git push origin main` before moving on or ending a session. If there are uncommitted changes for any other reason at the end of a session, push those too rather than leaving them local-only.

## Commands (once scaffolded)

```
npm run dev          # client + server concurrently
npm run seed         # scripts/seed.ts — fetch players + seed all 24 ranking sets
npm run stats:week   # scripts/ingest-week.ts -- --season 2026 --week N
npm run rankings:export | rankings:import
npm test             # vitest — value math and trade algorithm must have unit tests
```

## Conventions

- Git: `.gitignore` must exclude the SQLite DB file(s) and `data/raw/`. `data/fixtures/` and `data/rankings/` ARE committed.
- Remote: `origin` → `https://github.com/avenjwilliams/empire-fantasy.git`, branch `main`.
- Auth: a fine-grained GitHub PAT (Contents: read/write on this repo only) lives in `.git-credentials` at the repo root — gitignored, never commit it. Git should be configured to use it: `git config credential.helper "store --file=$(git rev-parse --show-toplevel)/.git-credentials"`. Run that once if a fresh clone/environment doesn't already have it set.
- **One-time cleanup on first real init here:** an earlier setup attempt from Cowork's sandboxed environment (which can't unlink files in this folder) left a broken `.git/` with a stuck `index.lock`. Before initializing for real: `rm -rf .git` (safe on your machine — that sandbox restriction doesn't apply locally), then `git init -b main && git remote add origin https://github.com/avenjwilliams/empire-fantasy.git`, re-apply the credential.helper line above, `git add -A && git commit -m "Initial commit" && git push -u origin main`.
- Tests never hit the network — use `data/fixtures/` (see `docs/02-data-pipeline.md`).

- TypeScript strict mode. Shared types in `shared/types.ts` imported by client and server.
- Server: thin routes → service layer (`server/services/`) holds all business logic. Value math lives in `shared/value.ts` so tests and client previews use identical code.
- DB migrations as numbered SQL files in `server/db/migrations/`, applied at startup.
- Write unit tests for: value clamping/rounding, vote adjustment math, performance adjustment math, trade curve + multi-player penalty. These are the correctness core of the app.

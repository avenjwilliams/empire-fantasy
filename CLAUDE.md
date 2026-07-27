# Empire Fantasy — Fantasy Football Trade Calculator

Multi-user fantasy football trade calculator with living player rankings that evolve from crowd votes (KEEP/TRADE/CUT) and real NFL performance. **v1 is fully implemented and deployed.** The docs below describe the system as built — treat them as the source of truth for design intent.

## Doc map

| Doc | Contents |
|---|---|
| `docs/00-overview.md` | Product vision, features, glossary, 24-combo league type matrix |
| `docs/01-architecture.md` | Stack, project structure, database schema, API routes |
| `docs/02-data-pipeline.md` | Seeding, CSV format, fixtures, Sleeper API, weekly stat ingestion |
| `docs/03-scoring-adjustments.md` | 1–100 value system, vote logic (Elo pairwise), performance adjustments, adjustment log |
| `docs/04-trade-calculator.md` | Trade algorithm: convex value curve, depth discount, verdict scale |
| `docs/05-ui-spec.md` | Screens, components, retro design constraints |
| `docs/06-roadmap.md` | Deferred features and next steps — check here before proposing new work |
| `README.md` | Setup, commands, **season operations runbook** (weekly ingest, CSV editing, snapshots) |
| `docs/archive/` | Historical planning docs (original phased build plan) — don't follow these |

**Keep docs in sync**: any change to behavior, schema, constants, or API shape must update the matching doc in the same commit. Stale docs are worse than no docs.

## Stack

- Frontend: React (Vite), plain CSS retro terminal theme (no UI framework)
- Backend: Node.js + Express; SQLite via `better-sqlite3`
- TypeScript strict everywhere; npm workspaces: `shared/`, `server/`, `client/`, `scripts/`
- Tests: Vitest. Value math, vote math, stat adjustments, and the trade curve are the correctness core — never change them without updating their tests.

## Hard rules

1. **Player values are 1.0–100.0, one decimal place.** Round with `Math.round(v * 10) / 10` at every write. Clamp to [1.0, 100.0].
2. **Every value change writes a row to `adjustment_log`.** No exceptions — seeds, votes, stat updates, manual CSV edits all log.
3. **SQLite is the source of truth at runtime.** CSVs in `data/rankings/` are the human-editable interface; sync via `npm run rankings:export` / `rankings:import` (import diffs and logs changes as `reason='manual'`).
4. **League types are the 24-row matrix** in `docs/00-overview.md`. Always reference by `code` (e.g. `DYN_SF_PPR_TEP`). Never hardcode a subset.
5. **Only QB, RB, WR, TE players**, plus rookie picks as assets in Dynasty league types only.
6. **No auth** — anonymous cookie-UUID sessions; all votes feed one shared ranking state.
7. Adjustments are small by design (caps in `docs/03-scoring-adjustments.md`). Never let one vote or one game exceed its cap. Tunable constants live in `shared/src/value.ts` (`TRADE_CONSTANTS` etc.) — change them there only.
8. **Commit and push before ending any session** — `git add -A && git commit -m "..." && git push origin main`. Never leave finished work local-only.

## Commands

```
npm run dev          # client :5173 + server :3001
npm test             # vitest
npm run seed         # add --fixtures for offline seed
npm run stats:week -- --season 2026 --week N
npm run rankings:export | rankings:import
npm run snapshot     # daily value_history snapshot
```

See README.md for the full season-operations runbook.

## Deployment

- Fly.io app `empire-fantasy`, region `ord`, volume `ef_data` mounted at `/data` (SQLite lives at `/data/empire-fantasy.db`). Config in `fly.toml`, image via `Dockerfile`.
- Deploy: `fly deploy`. Server serves the built client statically in production on port 8080.
- The production DB is live user data — never blow it away casually; back it up (`fly ssh console` + copy) before schema migrations or reseeding.

## Git

- Remote: `origin` → `https://github.com/avenjwilliams/empire-fantasy.git`, branch `main`.
- Auth: fine-grained PAT in `.git-credentials` at repo root (gitignored, never commit). If a fresh environment can't push: `git config credential.helper "store --file=$(git rev-parse --show-toplevel)/.git-credentials"`.
- `.gitignore` excludes the SQLite DB and `data/raw/`; `data/fixtures/` and `data/rankings/` ARE committed.
- **Cowork sandbox cannot run git commits here** (it can't unlink files, so git's lock/temp files get stuck). All git operations must run from Claude Code or a local terminal. If a Cowork session left a stuck lock: `rm -f .git/index.lock`.

## Conventions

- Shared types in `shared/src/types.ts`; all value/trade math in `shared/src/value.ts` (pure, unit-tested, used by both sides).
- Server: thin routes → service layer (`server/src/services/`) holds business logic.
- DB migrations: numbered SQL files in `server/src/db/migrations/`, applied at startup. Never edit an applied migration — add a new one.
- Tests never hit the network — use `data/fixtures/` with `--fixtures` / `EF_FIXTURES=1`.

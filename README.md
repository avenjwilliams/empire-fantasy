# Empire Fantasy

Fantasy football trade calculator with living player rankings that evolve from crowd votes (Keep/Trade/Cut) and real NFL performance.

## Features

- **Trade Calculator** — Nonlinear value curve with depth penalty, side-by-side comparison, verdict scale, and evener hint.
- **Living Rankings** — Player values (1-1000) across 24 league type configurations (Dynasty/Redraft, 1QB/SF, PPR/Half/Zero, TEP).
- **Keep / Trade / Cut** — Anonymous crowd voting with Elo-style pairwise adjustments. Values shift based on sustained sentiment.
- **Stat Ingestion** — Weekly NFL stat imports (via Sleeper API) that reward over-performance and penalize under-performance relative to value-based expectations.
- **Full Audit Log** — Every value change is logged with reason (seed, vote, stat, manual, decay).

## Stack

- **Frontend**: React + Vite, plain CSS (retro terminal theme)
- **Backend**: Node.js + Express
- **Database**: SQLite via `better-sqlite3`
- **Language**: TypeScript (strict mode, monorepo)
- **Charts**: Recharts

## Setup

```bash
# Install dependencies
npm install

# Seed the database (fixture data for development)
npm run seed -- --fixtures

# Start dev server (client on :5173, server on :3001)
npm run dev
```

For live data instead of fixtures, omit `--fixtures` and place a Sleeper players cache at `data/raw/sleeper-players.json`:

```bash
curl -o data/raw/sleeper-players.json https://api.sleeper.app/v1/players/nfl
npm run seed
```

## Commands

| Command | Description |
|---|---|
| `npm run dev` | Start client + server concurrently |
| `npm run build` | Build shared, server, and client |
| `npm test` | Run Vitest test suite |
| `npm run seed` | Seed database with player rankings |
| `npm run stats:week -- --season 2026 --week N` | Ingest weekly stats |
| `npm run rankings:export` | Export DB rankings to CSV |
| `npm run rankings:import` | Import edited CSVs back to DB |
| `npm run rankings:rebase` | Rebase stored values to native 999.9-scale precision (preserves drift) |
| `npm run snapshot` | Write daily value_history snapshot |

Add `--fixtures` or set `EF_FIXTURES=1` to use offline fixture data for `seed` and `stats:week`.

## Season Operations

### Weekly stat ingestion

Run each Tuesday (or whenever weekly stats are available):

```bash
# Fetch the stats file from Sleeper
mkdir -p data/raw
curl -o data/raw/stats-2026-1.json \
  "https://api.sleeper.app/v1/stats/nfl/regular/2026/1"

# Ingest — computes fantasy points, applies performance adjustments
npm run stats:week -- --season 2026 --week 1

# Take a daily snapshot for value-over-time charts
npm run snapshot
```

Re-running the same week is a no-op (idempotent). Use `--force` to reprocess.

### Editing rankings manually

1. Export current rankings: `npm run rankings:export`
2. Edit any CSV in `data/rankings/` (only the `value` column is writable)
3. Import changes: `npm run rankings:import`

Each changed value is logged as `reason='manual'` in the adjustment log.

**This only updates your local `empire-fantasy.db`.** Production has its own database on the `ef_data` volume — it's seeded once on first boot and never touched by local scripts or `fly deploy` (which only ships code). To get edited CSVs live:

```
git add -A && git commit -m "Update rankings" && git push origin main
fly deploy
fly ssh console -a empire-fantasy -C "npm run rankings:import"
```

The image bundles `data/rankings/`, `scripts/`, and `server/src` specifically so this command can run inside the deployed container. `rankings:import` and `rankings:export` both respect `DATABASE_PATH`/`DATA_DIR`, so run from the container they operate on `/data/empire-fantasy.db`, not the local dev DB.

### Daily snapshot

Run `npm run snapshot` once per day to power value-over-time charts on the player detail page. This copies current `asset_values` into `value_history` for the current date.

### Precision rebase (one-time)

If the database was migrated from the old 1–100 scale via the ×10 migration (004), all values end in `.0` and the native 1–1000 precision is lost. Run:

```bash
npm run rankings:rebase -- --dry-run   # preview: assets touched, % whole numbers, max delta
npm run rankings:rebase                # apply for real
```

This script recovers each asset's original seed rank from the same CSV sources `seedService` uses, computes the precise 999.9-scale base value, adds back the accumulated drift (votes + stats + nudges + manual edits), and writes the corrected value. It logs every change as `reason='manual'` with a detail field explaining the base/drift split. Rookie picks are excluded (they legitimately sit on round numbers). Run inside the container against `/data/empire-fantasy.db` via `fly ssh console` if doing it on prod.

## League Types

The app supports all 24 combinations of:

| Axis | Options |
|---|---|
| Format | Dynasty (DYN), Redraft (RED) |
| QB | 1QB, Superflex (SF) |
| Scoring | PPR, Half PPR (HALF), Zero PPR (ZERO) |
| TE Premium | TEP, Standard (STD) |

League type codes follow the pattern: `{DYN|RED}_{1QB|SF}_{PPR|HALF|ZERO}_{TEP|STD}`

## Project Structure

```
empire-fantasy/
  shared/        # Types, value math, league type matrix (shared by client + server)
  server/        # Express API, SQLite DB, services (seed, vote, stat)
  client/        # React UI (Vite)
  scripts/       # CLI tools (seed, ingest, export/import, snapshot)
  data/
    fixtures/    # Offline test data (committed)
    rankings/    # 24 CSV files, human-editable (committed)
    raw/         # Cached API responses (gitignored)
  docs/          # Design documents
```

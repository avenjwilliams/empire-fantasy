# 02 — Data Pipeline

## Sources

| Data | Source | How |
|---|---|---|
| Player metadata (name, position, team, age, status, IDs) | Sleeper API | `GET https://api.sleeper.app/v1/players/nfl` — free, no key, ~5MB JSON. Cache to `data/raw/sleeper-players.json`; refresh at most daily. |
| Seed rankings | FantasyPros consensus | Scrape/CSV-download expert consensus: Dynasty overall, Dynasty SF, Redraft (by scoring), Redraft SF. See seeding below. |
| Weekly stats | Sleeper API | `GET https://api.sleeper.app/v1/stats/nfl/regular/{season}/{week}` (verify endpoint at implementation time; fallback: `/v1/stats/nfl/{season_type}/{season}/{week}`). Store raw JSON per player. |
| Pick seed values | Hardcoded table in `seedService` | Community-consensus defaults (see below), vote-adjusted afterward. |

### Seed source priority

1. **Manual CSVs (preferred)**: `data/raw/seed-rankings/{DYN_1QB,RED_1QB}.csv` — two independent base sets loaded by `seedService`. Format: `rank,name,position,team` (name+position matched to Sleeper players fuzzily; report unmatched rows, don't fail). Expert consensus CSVs downloaded by hand from FantasyPros, ESPN, SI.com, etc. SF variants (`DYN_SF`, `RED_SF`) are derived mechanically by boosting QB values — no separate CSVs needed.
2. **Fallback** if `RED_1QB.csv` absent: redraft values are derived from dynasty via range compression (>70: ×0.98, ≤70: ×1.03). A warning is logged.
3. **Fixture fallback** if `DYN_1QB.csv` also absent: uses `data/fixtures/seed-rankings.sample.csv` (60-player sample). Adequate for testing, not for production seeding.

## Fixtures (data/fixtures/)

Checked into git so all pipeline code is buildable and testable offline:

- `sleeper-players.sample.json` — ~60 real players (mix of positions, teams, ages, a few FAs/injured) in exact Sleeper API shape.
- `seed-rankings.sample.csv` — matching seed ranking rows for those players.
- `week-stats.sample.json` — one fake week of stats for those players in exact Sleeper stats shape (include: a monster game, a dud, a bye/absent player, a TE with high receptions for TEP testing).

All fetch code takes a `--fixtures` flag (or `EF_FIXTURES=1`) that reads these instead of hitting the network. Unit/integration tests use fixtures exclusively — tests never touch the network. Build fixture files early in Phase 2; when the real Sleeper response shape is first verified, make the fixtures match it exactly.

## Seeding (scripts/seed.ts)

1. Pull Sleeper players; filter to QB/RB/WR/TE with an NFL team or notable FA status; insert `players` + `assets` rows. Skip players with no meaningful fantasy relevance (e.g. keep top ~400 by Sleeper search rank to avoid 3,000 dead rows).
2. Fetch source rankings for the **4 base sets**: `DYN_1QB`, `DYN_SF`, `RED_1QB`, `RED_SF` (PPR baseline).
3. Convert rank → value 1.0–1000.0 with a monotone curve (not linear — the gap between rank 1 and 10 is much bigger than 101 and 110):
   `value = 999.9 * exp(-k * (rank - 1) / N)` shaped so rank 1 = 999.9, rank ~50 ≈ 620, rank ~200 ≈ 143, floor 1.0. Tune `k` and document the chosen constants in code.
4. **Expand 4 base sets → 24 league types** by applying scoring deltas, then re-normalizing to 1–1000:
   - `HALF`: WR/TE/pass-catching RB values × ~0.97; `ZERO`: × ~0.93 (position-level multipliers; QBs unchanged).
   - `TEP`: TE values × ~1.12 in TEP sets.
   - These multipliers are **seed-time only** heuristics — after seeding, all 24 sets evolve independently. Constants live in `seedService` config, easy to tweak.
5. Seed pick values into all 12 DYN sets. Default table (1QB; SF multiplies rookie 1sts × ~1.05 since QBs go earlier):

   | Pick | Value |
   |---|---|
   | next-year Early 1st | 650 | Mid 1st 550 | Late 1st 450 |
   | Early 2nd 320 | Mid 2nd 270 | Late 2nd 230 |
   | Early 3rd 150 | Mid 3rd 120 | Late 3rd 100 |
   | Early 4th 60 | Mid 4th 50 | Late 4th 40 |

   Years further out: × 0.95 per additional year.
6. Write every seeded value to `adjustment_log` with `reason='seed'`, `old_value=new_value` on first insert (delta 0), and take a day-0 `value_history` snapshot.
7. Export all 24 CSVs.

## Precision rebase (scripts/rebase-precision.ts)

Run `npm run rankings:rebase` (or `tsx scripts/rebase-precision.ts`) to restore full-precision values that were quantized by migration 004 (which multiplied 1-decimal 100-scale values by 10). The script:

1. Recovers each asset's original seed rank from the same CSV sources `seedService` uses (four base CSVs + four root CSVs).
2. Computes `preciseBase = rankToValue(rank, N)` with the 999.9 amplitude, then applies the exact same scoring-multiplier chain `seedService` uses.
3. Computes `drift = currentValue − quantizedBase`, where `quantizedBase` is what migration 004 produced (old 100-scale curve clamped, then ×10).
4. Writes `newValue = clampRound(preciseBase + drift)`, preserving all accumulated vote/stat/manual/decay drift.
5. Logs each change to `adjustment_log` with `reason='manual'` and a detail explaining the rebase (e.g. `base 990.0→990.2, drift +0.4`).
6. Run with `--dry-run` first to preview touched assets, largest deltas, and the resulting % of values ending in `.0`.

This is idempotent (no-op if re-run) and never reorders rankings — it only restores decimals while preserving all crowd/stat history.

## CSV format (data/rankings/{CODE}.csv)

One file per league type. Sorted by value desc. Includes picks for DYN files.

```csv
asset_id,kind,name,position,team,age,value
101,player,Justin Jefferson,WR,MIN,27,994.0
2001,pick,2027 Early 1st,PICK,,,642.0
```

- `export-rankings.ts`: DB → CSVs (overwrite).
- `import-rankings.ts`: read CSVs, diff `value` against DB per asset/league type; for each difference, update `asset_values` and log `reason='manual'` with `detail={"file":"DYN_SF_PPR_TEP.csv"}`. Only `value` is writable via CSV; other columns are informational.
- Print a summary of changes on import. Refuse values outside [1.0, 1000.0].
- Both scripts resolve the DB via `DATABASE_PATH` (falling back to the local `empire-fantasy.db`) and the rankings dir via `DATA_DIR` — this is what lets `rankings:import` be run inside the deployed container against the production DB. The Dockerfile bundles `data/rankings/`, `scripts/`, and `server/src` for exactly this. Editing a CSV locally never affects production on its own — see the "Editing rankings manually" runbook in `README.md` for the full commit → deploy → `fly ssh console` sequence.

## Weekly stat ingestion (scripts/ingest-week.ts)

Run manually or via cron each Tuesday during the season:

1. Fetch week stats from Sleeper; upsert `weekly_stats` (raw JSON).
2. For each player with a game and each league type, compute fantasy points under that league type's scoring:
   - Base: standard scoring (pass yds /25, pass TD 4, INT −2, rush/rec yds /10, TD 6, fumble −2).
   - Receptions: +1.0 (`PPR`), +0.5 (`HALF`), +0 (`ZERO`); TEs get an additional +0.5/rec when `TEP`.
   - QB axis doesn't change scoring — `1QB` vs `SF` affects value, not points. Points are identical across the QB axis; the *adjustment* differs (see 03).
3. Hand per-league-type points to `statService.applyPerformanceAdjustments(season, week)` (algorithm in 03). Idempotency: record processed (season, week) in a `meta` table; re-running a week is a no-op unless `--force`.
4. Also refresh player metadata (team changes, age, status) from the cached Sleeper players file.

## Nightly snapshot

Small cron (or on-demand script) writes current `asset_values` into `value_history` once per day. This powers value-over-time charts regardless of how many adjustments happened that day.

## Boom/Bust Generation (scripts/generate-boom-bust.ts)

Run `npm run boom-bust:generate` to populate `boom_pct` and `bust_pct` on the `players` table.

- **What it does**: For every player row, generates independent random integers for `boom_pct` and `bust_pct` in the range **5–65** (not the full 0–100 — values near the extremes are implausible placeholders). The RNG is seeded deterministically from the player's `sleeper_id`, so the same player always gets the same placeholder numbers across reseeds.
- **Idempotent by default**: Only fills rows where the column is currently `NULL`. Re-running without flags reports 0 filled and changes no existing numbers.
- **`--force` flag**: Regenerates all rows, overwriting existing values.
- **Not part of `npm run seed`**: This is a separate manual step. The seed pipeline does not call it automatically.
- **Single transaction**: All writes are wrapped in one DB transaction.
- **Log output**: One-line summary: how many players filled, how many skipped (already had values).
- **Placeholders only**: The current numbers are random placeholders. Real computation will derive ratings from `weekly_stats` against positional baselines (see roadmap).

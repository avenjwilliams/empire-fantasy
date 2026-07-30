# Prompt: recoverSeedRanks keeps one rank per asset — it must keep one per base set

**Paste into opencode: everything from `## TASK` down to the END PROMPT marker, plus the dispatch line quoted in ROUTING. Do not paste the ROUTING section itself — it's for you, not the agent.**

---

## TASK

The precision rebase ran against production and silently skipped **18 of the 24 league types**. Values in those 18 are still quantized to `.0`. This is a data-correctness bug in `recoverSeedRanks`; fix it, then the rebase gets re-run.

### The bug

`recoverSeedRanks` in `server/src/services/seedService.ts`:

```ts
const seedRanks = new Map<number, { rank: number; position: Position; baseSet: string }>();

for (const setCode of CSV_SETS) {                 // ['DYN_1QB','RED_1QB','DYN_SF','RED_SF']
  const seedRankings = loadSeedRankings(config, setCode);
  for (const row of seedRankings) {
    ...
    if (!seedRanks.has(asset.id)) {               // ← first base set wins; other three discarded
      seedRanks.set(asset.id, { rank: row.rank, position: row.position as Position, baseSet: setCode });
    }
  }
}
```

**A player has four ranks — one in each base set's seed CSV — and they are different numbers.** This map stores one. Because `DYN_1QB` is first in `CSV_SETS`, every player present in `DYN_1QB.csv` (343 players, i.e. essentially the whole meaningful board) is tagged `baseSet: 'DYN_1QB'` and their `RED_1QB`, `DYN_SF`, and `RED_SF` ranks are thrown away.

`scripts/rebase-precision.ts` then does:

```ts
const baseKey = `${lt.format}_${lt.qb}`;
if (baseKey !== baseSet) continue;        // skips 18 of 24 league types for every asset
```

Observed consequence in production: in `RED_1QB_PPR_STD`, the top ~36 TEs are all whole numbers (`868`, `825`, `654`, `597`, …) while values below ~72 have real decimals (`71.7`, `54.3`, `48.8`, `45.2`, `41.9`, `33.1`, `31.3`). The only assets rebased in `RED_1QB_*` were those **absent** from `DYN_1QB.csv` — redraft-only deep players. Rank 1 is still `1000.0` instead of `999.9`. The rebase wrote ~900 `adjustment_log` rows where it should have written on the order of 9,000.

### The fix

**Key the recovery by (asset, base set), not by asset.** Change the return type of `recoverSeedRanks` to carry every base set an asset appears in — either:

```ts
Map<number, Map<string, { rank: number; position: Position }>>   // assetId → baseSet → rank
```

or a flat `Map<string, …>` keyed `${assetId}:${setCode}`. Either is fine; pick one and use it consistently.

Requirements:

- **Delete the `if (!seedRanks.has(asset.id))` guard.** That line is the bug. Every (asset, base set) pair found in a CSV must be recorded. Within a single base set, keep first-wins if a name matches twice — that mirrors current behavior for genuine duplicates — but never across base sets.
- Position comes from the CSV row and should be identical across sets for a given player. If a player's position differs between two base-set CSVs, that's a data problem: log a warning naming the player and both positions, and keep the first. Do not silently pick one.
- In `scripts/rebase-precision.ts`, replace the `if (baseKey !== baseSet) continue;` skip with a **lookup**: for each league type, compute `baseKey` and fetch that asset's rank for that base set. `continue` only when the asset genuinely has no rank in that base set (a legitimate case — `RED_SF.csv` has 253 rows, `DYN_1QB.csv` has 343, so plenty of assets are missing from some sets). Count those separately in the summary as `skipped (no rank in this base set)` — distinct from the existing `noRank` counter, which should now mean "no rank in any base set."
- `N` must be the row count of the base set actually being used for that league type. `baseSetSizes` already holds the four values — index it by the same `baseKey`, never by a single per-asset base set.

### Second defect — fix while you're in here

The script models migration 004's base incorrectly for any league type with a non-1.0 multiplier:

```ts
const quantizedBase = oldRankToValue100(rank, N);                    // clampRound at 100 scale
const quantizedBaseAfter = applyScoringMultipliers(quantizedBase, …);
const quantizedBaseFinal = clampRound(quantizedBaseAfter * 10);      // rounds to 0.1 at 1000 scale
```

`seedService` applies the multipliers and then calls `clampRound` **at the 100-point scale** (rounding to 0.1 there = 1.0 at the new scale), and migration 004 multiplied that already-rounded number by 10. So the faithful model is:

```
migratedBase = clampRound_100(rankToValue100(rank, N) × multipliers) × 10
```

i.e. round at 100-scale **after** the multipliers, then multiply by 10 — not multiply by 10 then round at 1000-scale. Reproduce that exactly, so `drift = currentValue − migratedBase` is right.

This is invisible in `PPR`/`STD` types (all multipliers are 1.0), which is why the numbers looked plausible. It is wrong in the 16 `HALF`/`ZERO`/`TEP` types, where it corrupts drift by up to a few tenths.

### Idempotency — required

The rebase has already run once against prod and partially applied. Re-running must converge, not compound. Because `drift = currentValue − migratedBase` is recomputed from the *current* value, a second run on an already-rebased asset computes a drift that now includes the first run's correction, and re-adds it.

Make the script detect and handle this: before computing drift, check whether the asset already has a `reason='manual'` `adjustment_log` row with `detail` containing `"rebase":true` for that league type. If it does, use that row's recorded pre-rebase `old_value` as the basis for the drift computation instead of the current value. Assert in the dry-run summary that no asset would move by more than ~2.0; a larger delta means the idempotency logic is wrong.

### Tests

- `recoverSeedRanks` returns **four** entries for a player present in all four seed CSVs, with the correct distinct rank for each, and fewer entries for a player missing from some. Use a real player you can verify against the CSVs.
- The four base-set row counts are what the loader reports: `DYN_1QB` 343, `DYN_SF` 309, `RED_1QB` 346, `RED_SF` 253. This catches CSV changes that would otherwise surface as shifted decimals.
- The migration-004 model reproduces a known stored value: for an untouched asset in a `TEP` or `HALF` league type, `migratedBase` must equal the value currently in the DB exactly. This is the test that would have caught the second defect.
- Running the rebase transform twice over the same input yields the same output (idempotency).

### Verification

- `npm test` green.
- `npm run rankings:rebase -- --dry-run`. Expect **~9,000 assets touched**, not ~900. If the count is in the hundreds, the base-set lookup is still wrong. Max absolute delta under ~2.0.
- After the real local run plus `npm run rankings:export`, check **all 24** CSVs, not one: each should show roughly 8% of values ending in `.0`. Any file still at ~100% means that league type is still being skipped.
- `RED_1QB_PPR_STD` rank 1 must read `999.9`.
- Rank order unchanged in all 24 league types, before vs. after.
- Confirm on prod after running: `/api/log?reason=manual&limit=5` returns rebase rows, and the TE board for `RED_1QB_PPR_STD` shows decimals at the **top**, not just below rank 36.

### Out of scope

Do not change the 999.9 amplitude, `RANK_DECAY_K`, `clampRound`, the multiplier values or their order, or the definition of drift. Do not reseed. Do not run the rebase against production — that's Aven's step.

<!-- ==================== END PROMPT — stop pasting here ==================== -->

---

## ROUTING (for Aven — do not paste)

**Send to `rankings`.** `server/src/services/seedService.ts`, `scripts/rebase-precision.ts`, and the test file are all in its allow-list. Append:

> Fix recoverSeedRanks' return type first so it carries a rank per base set, then update the script's lookup to match, then the migration-004 model, then idempotency. Do not start from the script — the map's shape is the root cause and everything else follows from it.

**The thing to check before you run anything:** the dry-run's "Assets touched" count. It should be ~9,000. That single number distinguishes a real fix from another partial one, and it's cheaper to read than 24 CSVs.

**Re-running against prod.** The first run already applied ~900 partial corrections, which is why the prompt requires idempotency handling. Sequence:

```
npm test
npm run rankings:rebase -- --dry-run          # confirm ~9,000 touched, max delta < 2.0
npm run rankings:rebase
npm run rankings:export                        # 24 CSVs, still stale from before
```

Then prod, backup first:

```
fly ssh console -a empire-fantasy -C "cp /data/empire-fantasy.db /data/backup-$(date +%F).db"
fly ssh console -a empire-fantasy -C "npm run rankings:rebase -- --dry-run"
fly ssh console -a empire-fantasy -C "npm run rankings:rebase"
```

If the idempotency logic looks shaky in review, the safer alternative is to restore prod from the backup taken before the first rebase (if you have one) and run the fixed script against clean data. That sidesteps the compounding question entirely — worth doing if a backup exists.

Also worth noting for your own use: `/api/log?reason=manual` returned `total: 0` on prod while `/api/log` (unfiltered) returned rebase rows with `reason: "manual"`. The `reason` query filter on `GET /api/log` looks broken. Unrelated to this bug and it cost me a wrong first conclusion — worth adding to `docs/06-roadmap.md` as its own small fix.

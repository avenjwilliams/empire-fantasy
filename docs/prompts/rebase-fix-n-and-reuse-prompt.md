# Prompt: fix the rebase script's hardcoded N and its duplicated seed logic

**Paste into opencode: everything from `## TASK` down to the END PROMPT marker, plus the dispatch line quoted in ROUTING. Do not paste the ROUTING section itself — it's for you, not the agent.**

---

## TASK

`scripts/rebase-precision.ts` has not been run yet, and it must not be run until this is fixed. It computes the wrong values.

### The bug

Line ~303:

```ts
const totalPlayers = 358; // Fixed N as used in seedService
```

The comment is false. `seedService` passes `seedRankings.length` to `rankToValue` — the row count of the base set's seed CSV — and that differs per base set:

| base set | actual N |
|---|---|
| `DYN_1QB` | 343 |
| `DYN_SF` | 309 |
| `RED_1QB` | 346 |
| `RED_SF` | 253 |

None is 358. Because `computePreciseBase` and `computeQuantizedBase` both use the same wrong N, most of the error cancels in `preciseBase + (current − quantizedBase)` — so the output *looks* plausible. It isn't:

| base set | rank | correct | current script writes | error |
|---|---|---|---|---|
| DYN_1QB | 50 | 606.5 | 607.3 | +0.8 |
| RED_SF | 50 | 507.6 | 508.3 | +0.7 |
| RED_1QB | 150 | 221.5 | 222.0 | +0.5 |
| DYN_SF | 10 | 903.0 | 902.7 | −0.3 |

Rank 1 is unaffected (error 0.0), so eyeballing the top of the rankings will not reveal this. The error lands entirely in the tenths digit — the exact digit the rebase exists to restore. The result would be values that no longer satisfy `value === rankToValue(rank, seedRankings.length)`, so a future reseed would silently move every player.

### Root cause — fix this, not just the constant

The script reimplements `parseSleeperPlayers`, the seed-CSV loader, the scoring-multiplier expansion chain, and the rank curve as private copies. `const totalPlayers = 358` is what a copy looks like after it drifts from its original. Changing 358 to the right number per base set without removing the duplication just resets the clock on the same failure.

**Export the real implementations from `seedService.ts` and import them.** Specifically:

1. In `server/src/services/seedService.ts`, add named exports for the seed-rank recovery path — the Sleeper player parser, the per-base-set seed-CSV loader, and the multiplier-expansion function that turns a base value into a per-league-type value. Do not change their behavior, do not reorder the multiplier chain, do not alter their signatures beyond what's needed to export them. This is a visibility change only.
2. In `scripts/rebase-precision.ts`, delete the local copies of all of the above plus the local `rankToValue`, and import from `seedService` and `@empire-fantasy/shared` instead. `rankToValue` already lives in `shared/src/value.ts` — use it from there, do not redefine it.
3. Keep `oldRankToValue100` local to the script. It models what migration 004 produced and deliberately has no live counterpart — comment it as such so nobody "unifies" it later.
4. Carry N per base set through from the loader's actual row count. Never hardcode it, and do not derive it from a DB count.

After this, `grep -c "Math.exp" scripts/rebase-precision.ts` should return 1 (only `oldRankToValue100`), and the script should contain no CSV parsing of its own.

### Regression test

Add a test asserting the script and `seedService` agree, so this can't drift again. Given a fixed rank and base set, the rebase path's precise base must equal what `seedService` would assign to a fresh seed of the same asset — for all four base sets, at ranks 1, 10, 50, and 150. This test must fail if anyone reintroduces a hardcoded N.

Also assert the per-base-set N values above are what the loader actually returns, so a change to a seed CSV's row count surfaces here rather than as silently shifted decimals.

### Verification

- `npm test` green, including the new agreement test.
- `npm run rankings:rebase -- --dry-run` and read the summary. Expect: **~8% of values ending in `.0`** (down from 100%), max absolute delta under ~2.0, and `Assets without rank: 0` — a nonzero count there means the rank recovery is still broken.
- Sanity-check the dry-run output against this table before writing anything. All four must match:

  | base set | rank | expected |
  |---|---|---|
  | DYN_1QB | 50 | 606.5 |
  | DYN_SF | 10 | 903.0 |
  | RED_1QB | 150 | 221.5 |
  | RED_SF | 50 | 507.6 |

  (These are pre-drift base values. An asset with accumulated votes will differ by its drift — check an untouched asset.)
- Rank 1 must come out at exactly `999.9` in every league type.
- Rank order must be identical before and after, in all 24 league types. This is the one failure the other checks can't see.

### Out of scope

Do not change the 999.9 amplitude, `RANK_DECAY_K`, `clampRound`, the multiplier chain's math or order, or anything about how drift is computed. Do not reseed. Do not run the rebase for real — leave that to Aven.

<!-- ==================== END PROMPT — stop pasting here ==================== -->

---

## ROUTING (for Aven — do not paste)

**Send to `rankings`.** Both files are in its allow-list (`server/src/services/seedService.ts`, `scripts/rebase-precision.ts`, `shared/src/value.test.ts`). No `build` hop, no `documentation` hop — nothing here changes behavior, so no doc updates are owed. Append:

> Fix the duplication first by exporting from seedService and importing in the script, then confirm the hardcoded N is gone as a consequence rather than patching it directly.

Ordering it that way matters: if it patches `358` first it will likely stop there and leave the copies in place, which is how you get this same bug again in a month.

**Then run it yourself, in this order:**

```
npm test
npm run rankings:rebase -- --dry-run     # check against the table above
npm run rankings:rebase
npm run rankings:export                   # the 24 CSVs are committed and currently stale
```

Then prod, and only after a backup:

```
fly ssh console -a empire-fantasy -C "cp /data/empire-fantasy.db /data/backup-$(date +%F).db"
fly ssh console -a empire-fantasy -C "npm run rankings:rebase -- --dry-run"
fly ssh console -a empire-fantasy -C "npm run rankings:rebase"
```

`fly deploy` alone will not change a single stored value — that's what happened last round. The rebase is a manual data step, permanently.

Verify on the live site: Bijan reads `999.9`, and the board shows varied decimals rather than a column of `.0`.

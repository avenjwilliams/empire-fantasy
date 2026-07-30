# Prompt: restore real decimal precision to values, and cap the curve at 999.9

**Paste into opencode: everything from `## TASK` down to the END PROMPT marker, plus the dispatch line quoted in ROUTING. Do not paste the ROUTING section itself — it's for you, not the agent.**

---

## TASK

The 1–1000 migration landed, but the extra resolution it was supposed to buy does not exist in the data. **Every single value in every league type ends in `.0`** — 358 of 358 rows in each of the 24 CSVs. Fix the cause, not the display.

### Root cause — read this before changing anything

Migration 004 multiplied values that had **already been rounded to one decimal on the 100-point scale**. The quantization happened *before* the scale change, so the tenths digit was destroyed on the way in:

```
rankToValue(rank 2) on old scale  →  99.0271…
clampRound (1 decimal, 100 scale) →  99.0        ← precision lost HERE
migration 004: × 10               →  990.0
```

Every value is therefore an exact multiple of 1.0. The scale has 10,000 representable steps and the data occupies 1,000 of them. This is a **data** problem, not a formatting problem — `.toFixed(1)` is faithfully rendering a `.0` that really is there.

`rankToValue` in `server/src/services/seedService.ts` is already correct after the migration — `1000 * Math.exp(-RANK_DECAY_K * (rank - 1) / N)` then `clampRound` would produce `990.2` for rank 2 at native 1000-scale precision. The seeding code was fixed; the **stored data never went through it**. Those numbers came from the SQL migration, not from a reseed.

So: do not "fix" `rankToValue`'s formula, and do not add decimal places to `clampRound`. One decimal on a 1000-point scale is correct and is CLAUDE.md hard rule 1. The job is to get the stored values recomputed through the curve at full precision while preserving accumulated crowd votes.

---

### Fix 1 — curve amplitude 1000 → 999.9

In `seedService.rankToValue`, change the amplitude:

```ts
const raw = 999.9 * Math.exp(-RANK_DECAY_K * (rank - 1) / N);
```

Leave `RANK_DECAY_K` at `3.5` and leave `clampRound`'s bounds at `[1.0, 1000.0]`. Update the docstring: rank 1 = 999.9, rank ~50 ≈ 620, rank ~200 ≈ 143.

**Verified expected output** at `A = 999.9, k = 3.5, N = 358` — use these as test fixtures:

| rank | value |
|---|---|
| 1 | 999.9 |
| 2 | 990.2 |
| 3 | 980.5 |
| 5 | 961.6 |
| 10 | 915.7 |
| 50 | 619.3 |
| 100 | 379.9 |
| 200 | 142.9 |
| 358 | 30.5 |

With this curve, **8.1% of ranks land on `.0`** (29 of 358) — which is what you'd expect from an exponential sampled at one decimal, versus the 100% you see today. That percentage is the acceptance criterion for Fix 2.

#### Known consequence — log it, don't solve it here

Seeding rank 1 at `999.9` against a `clampRound` ceiling of `1000.0` leaves the top player **0.1 of headroom — roughly one vote.** He is effectively pinned: KEEP votes he wins are discarded by the clamp while losses still move him, so the crowd can only ever push the #1 asset down. This asymmetry predates the migration (rank 1 used to seed at `100.0` against a `100.0` ceiling, i.e. zero headroom) and 999.9 marginally improves it.

**Do not fix this by lowering the amplitude or raising the ceiling.** The 999.9 top value is a deliberate product decision. Add a roadmap item instead — see the Docs section.

---

### Fix 2 — rebase stored values to full precision, preserving vote drift

Add a new script **`scripts/rebase-precision.ts`**, wired up as `npm run rankings:rebase` in the root `package.json`. A SQL migration cannot do this: recovering each asset's original rank requires reading the seed CSVs, which is application logic.

Do **not** reseed. Production holds live crowd votes and a reseed would discard them.

For each league type, for each asset:

1. **Recover the seed rank.** Read the same seed sources `seedService` uses (`data/seed-rankings/` plus the four root `*.csv` sheets) and rebuild the rank ordering exactly as `seedRankings` does at seed time. Reuse `seedService`'s existing parsing helpers rather than reimplementing the CSV reader — if the two ever disagree about rank, this script silently corrupts values.
2. **Compute `preciseBase`** = `rankToValue(rank, N)` with the new 999.9 amplitude, then the same `SCORING_MULTIPLIERS` chain `seedService` applies to expand the 4 base sets into 24 league types. The multiplier order matters and must match `seedService` exactly.
3. **Compute the drift already accumulated:**
   ```
   quantizedBase = round1(oldRankToValue100(rank, N)) * 10    // what migration 004 produced
   drift         = currentValue − quantizedBase
   ```
   `drift` is everything votes, stat ingestion, age nudges, decay, and manual edits have contributed since seeding. It is usually 0 for untouched assets.
4. **Write** `newValue = clampRound(preciseBase + drift)`.
5. **Log every change** to `adjustment_log` per CLAUDE.md hard rule 2 — `reason='manual'`, `detail` explaining the rebase (e.g. `precision rebase: base 990.0→990.2, drift preserved +0.4`). Do **not** add a new `reason` enum value; `adjustment_log.reason` has a CHECK constraint and widening it would force a table rebuild for no benefit.
6. Skip the write and skip the log row when `newValue === currentValue`. Most bottom-of-the-board assets will be unchanged and shouldn't generate noise.

Requirements:

- Wrap the whole thing in a single transaction. A half-rebased DB has no clean recovery path.
- Support `--dry-run` printing a summary — assets touched, largest deltas, and the resulting percentage of values ending in `.0` — without writing. Make this the thing you run first.
- Respect `DATABASE_PATH` / `DATA_DIR` the way `import-rankings.ts` and `export-rankings.ts` do, so it can run inside the Fly container against `/data/empire-fantasy.db`.
- Assets with no recoverable seed rank (added post-seed, or unmatched in the CSVs) must be **left completely alone**, and reported in the summary count. Never guess a rank from current value ordering — current values reflect drift, so inferring rank from them would rewrite exactly the assets that have the most accumulated history.
- Rookie **picks** are excluded. Their values come from the hand-set `PICK_VALUES` table, not the rank curve, so they legitimately stay on round numbers (650.0, 550.0, …). Do not synthesize decimals for them.

---

### Fix 3 — the guard that keeps this from regressing

Add to `shared/src/value.test.ts` (or a new `seedService.test.ts` if `rankToValue` isn't currently reachable from the shared tests):

1. `rankToValue(1, N)` returns exactly `999.9` — never `1000.0`.
2. The fixture table in Fix 1 matches, exactly, at `N = 358`.
3. **The precision invariant:** over `rankToValue(r, 358)` for all `r` in 1…358, fewer than 15% of results land on a whole number. This is the test that would have caught the original bug — it fails loudly at 100%.
4. `rankToValue` is strictly monotonically decreasing in rank.
5. `rankToValue(r, N) <= 999.9` for all r, and `>= 1.0`.

---

### Verification

- `npm test` green.
- `npm run rankings:rebase -- --dry-run` locally first. Read the summary before running for real.
- After the real run: `npm run rankings:export`, then confirm the fraction of values ending in `.0` in `data/rankings/*.csv` has dropped from 100% to roughly 8% (allow 5–15%; the exact figure shifts with each league type's row count and the scoring multipliers). Check several files, not just one — a bug in the multiplier chain could leave one base set quantized while the others look fine.
- Confirm the top of `RED_1QB_PPR_STD.csv` reads `999.9`, and that **rank order is unchanged** for the top 50 in at least two league types. This rebase must not reorder anybody — if it does, the rank recovery in step 1 is wrong.
- Spot-check an asset that has real votes against it: its `drift` must survive, i.e. its new value should differ from `preciseBase` by the same amount its old value differed from `quantizedBase`.
- Confirm `adjustment_log` gained one `reason='manual'` row per changed asset and zero rows for unchanged ones.
- **Before running against prod:** back up `/data/empire-fantasy.db` and dry-run inside the container.

---

### Docs

- **`docs/02-data-pipeline.md`** — update the rank→value curve section: amplitude 999.9, the new tuning targets (rank 1 = 999.9, ~50 ≈ 620, ~200 ≈ 143), and document `rankings:rebase` in the script list.
- **`docs/03-scoring-adjustments.md`** — add a short note that one decimal on the 1–1000 scale is meaningful precision, that seed values are computed at native scale rather than derived from the old 100-point values, and why the rebase logs as `reason='manual'`.
- **`README.md`** — add `npm run rankings:rebase` to the commands table and a line in the season-operations runbook.
- **`docs/06-roadmap.md`** — add to Deferred: **"Top-asset ceiling pinning"** — rank 1 seeds at 999.9 against a 1000.0 clamp, so the #1 asset has ~0.1 of upside (one vote) and the crowd can only move it down. Options to weigh later: lower the curve amplitude to reserve real headroom, or make the clamp ceiling soft. Also move the 1–1000 migration itself to Done with today's date if that hasn't been recorded yet.

### Out of scope

No client changes — `.toFixed(1)` is correct and stays. Do not touch `clampRound`'s bounds, `RANK_DECAY_K`, `PICK_VALUES`, the vote or stat constants, or anything in the trade calculator. Do not reseed. Do not reorder rankings.

<!-- ==================== END PROMPT — stop pasting here ==================== -->

---

## ROUTING (for Aven — do not paste)

**Send this one straight to `rankings`** — no `build` hop needed, unlike the last two prompts. Everything it touches is inside rankings' allow-list:

| Work | File(s) | In rankings' allow-list? |
|---|---|---|
| Curve amplitude | `server/src/services/seedService.ts` | yes |
| Rebase script | `scripts/rebase-precision.ts` | yes — `scripts/` is allowed |
| Tests | `shared/src/value.test.ts` | yes |
| Pipeline + adjustment docs | `docs/02`, `docs/03` | yes |

Two things fall outside it, and `rankings` can reach both by dispatching to `documentation` (which holds `docs/**` and `README.md`):

> Handle the curve change, the rebase script, and the tests yourself, plus docs/02 and docs/03. Then dispatch to documentation for the README command-table entry and the docs/06 roadmap items. Do not edit README.md or docs/06 directly.

The one snag: `package.json` is **not** in rankings' allow-list — only `build` can edit it. So either add the `rankings:rebase` script line yourself by hand (it's one line), or run a short `build` pass first just for that. Doing it by hand is faster and avoids build deciding to "help" with the rest.

**Watch for two specific failure modes in the output:**

1. **Reimplemented CSV parsing.** The spec says reuse `seedService`'s helpers for rank recovery. If the agent writes its own CSV reader in `rebase-precision.ts`, reject it — a rank-recovery mismatch corrupts values silently and rank order is the one thing the verification steps can catch only by manual spot-check.
2. **"Fixing" the pinning.** If it lowers the amplitude below 999.9 or raises the clamp ceiling to give the top player headroom, that's it exceeding scope. 999.9 is the decision; the pinning goes on the roadmap.

Skip `plan` here. Single domain, and the spec is already sequenced.

Then `@git` to commit (runs `npm test` first), and `@deployment` for the prod backup before the rebase runs against `/data/empire-fantasy.db`.

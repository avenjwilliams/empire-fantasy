# Prompt: migrate the value scale from 1–100 to 1–1000

**Paste into opencode: everything from `## TASK` down to the END PROMPT marker, plus the dispatch line quoted in ROUTING. Do not paste the ROUTING section itself — it's for you, not the agent.**

---

## TASK

Widen the player value scale from `[1.0, 100.0]` to `[1.0, 1000.0]`. **Read this entire brief before editing anything.** This is a cross-cutting numeric migration with live production data behind it, and there are three places where the obvious change is the wrong one. Those are called out explicitly below — if you skip to the find-and-replace, you will silently break voting.

### Why

Two goals, and they pull in different directions on purpose:

1. **More resolution.** 24 league types × ~400 assets on a 100-point scale means constant ties and no room to express fine distinctions between adjacent players. A 1000-point scale with one decimal gives ~10,000 distinct steps.
2. **Damping the crowd.** Vote and stat deltas keep their **current absolute magnitudes** while the scale grows 10×, so each individual vote moves a player 10× less in relative terms. Rankings become harder for a handful of votes to yank around, and the seeded expert consensus holds its shape longer.

So this is deliberately **not** a uniform ×10 of every constant. Some constants scale, some must not, and one must scale even though it isn't a value.

---

### The three landmines

Handle these first, before the mechanical edits.

#### Landmine 1 — `ELO_SCALE` is denominated in value units and MUST scale

`shared/src/value.ts`, `computePairwiseDelta`:

```ts
const expected = 1 / (1 + Math.pow(10, (loserValue - winnerValue) / VOTE_CONSTANTS.ELO_SCALE));
```

`ELO_SCALE` is currently `12`, tuned so a ±6-point value gap yields roughly a 24–76% expectation. The divisor is in the same units as the values. If values become 10× larger and `ELO_SCALE` stays at 12, a gap that used to be 6 points is now 60:

```
10^(60/12) = 10^5  →  expected ≈ 0.99999
winnerDelta = K × (1 − expected) ≈ 0.000002   // effectively zero
```

Every vote would hand the winner nothing and the loser the full −K. The Elo model stops responding to value gaps entirely, and it fails *quietly* — tests that only assert "winner delta is positive" still pass.

**Set `ELO_SCALE: 120.`** Verify the behavior is preserved: a 60-point gap on the new scale must produce `expected ≈ 0.760`, exactly as a 6-point gap does today.

#### Landmine 2 — `INACTIVE_DECAY_RATE` is multiplicative and must NOT scale

`shared/src/constants.ts` has `INACTIVE_DECAY_RATE = 0.15`, applied in `statService.ts` as:

```ts
const newValue = clampRound(oldValue * (1 - INACTIVE_DECAY_RATE));
```

This is a **percentage**, not a delta. It is already scale-invariant — 15% of 500 is automatically 10× the absolute drop that 15% of 50 was. Multiplying it to `1.5` would compute `oldValue * -0.5` and send values negative. **Leave it at 0.15.**

What *does* scale alongside it are the thresholds it gates on: `INACTIVE_MIN_VALUE` and `MIN_VALUE_FOR_EXPECTATION` (both `5` → `50`).

#### Landmine 3 — not every literal `100` in this codebase is the value scale

Do **not** blanket find-and-replace. These occurrences of `100` must stay exactly as they are:

| Location | What the 100 means | Verdict |
|---|---|---|
| `value.ts` `computeFantasyPoints`: `Math.round(pts * 100) / 100` | 2-decimal rounding of **fantasy points** | leave |
| `statService.ts` ~L209–210: `Math.round(exp.expected * 100) / 100` | 2-decimal rounding of **fantasy points** | leave |
| `value.ts` `evaluateTrade`: `Math.max(-100, Math.min(100, ...))` | the trade **needle range**, −100…100 | leave |
| `value.ts` `differencePct`: `Math.round(... * 1000) / 10` | percentage formatting | leave |
| `client/src/theme.css` — `width: 100%`, `z-index: 100`, `100vh`, `#e65100` | CSS | leave |
| `client/src/components/TradeScale.tsx` — all of it | operates on `scale`, not values | leave |
| `session.ts` `365 * 24 * 60 * 60 * 1000` | cookie TTL in ms | leave |

---

### Constant-by-constant spec

Work through this table exactly. The "why" column is the reasoning you should preserve in code comments where a constant's relationship to the scale is non-obvious.

#### `shared/src/value.ts`

| Constant / function | Now | New | Why |
|---|---|---|---|
| `clampRound` bounds | `[1.0, 100.0]` | `[1.0, 1000.0]` | the scale itself. Keep the floor at **1.0**, not 10.0 — the extra headroom below the ×10 mapping is deliberate, so deep bench players and late picks can differentiate instead of all piling onto the floor |
| `VOTE_CONSTANTS.ELO_SCALE` | `12` | `120` | Landmine 1 — value-denominated |
| `VOTE_CONSTANTS.K` | `0.20` | **`0.20` — unchanged** | this is the whole point of the exercise. Vote deltas stay absolute, so their relative influence drops 10× |
| `VOTE_CONSTANTS.K_DAMPENED` | `0.10` | **`0.10` — unchanged** | same |
| `VOTE_CONSTANTS.DAMPEN_THRESHOLD` | `30` | unchanged | a vote count, not a value |
| `TRADE_CONSTANTS.DEPTH_WEIGHTS`, `DEPTH_FLOOR` | — | unchanged | dimensionless multipliers |
| `TRADE_CONSTANTS.SCALE_MULTIPLIER`, `BANDS` | — | unchanged | applied to `lean`, which is a **ratio** — see the invariance note below |
| `computeAdviceGap`: `if (neededValue > 100) return null` | `100` | `1000` | "no single player can close this gap" ceiling — must track the max value |
| `round1`, `trueValue` | — | unchanged | scale-agnostic |

Add a comment on `K` making the intent explicit, so nobody "fixes" it later:

```ts
/** Elo K-factor per pairwise comparison. Deliberately NOT scaled with the
 *  1–1000 value range: keeping deltas absolute (~0.1–0.2 per pair) is what
 *  damps individual vote influence to ~1/10 of its old relative weight. */
```

#### `shared/src/constants.ts`

| Constant | Now | New | Why |
|---|---|---|---|
| `PICK_VALUES` (all 12 entries) | `65, 55, 45, 32, 27, 23, 15, 12, 10, 6, 5, 4` | `650, 550, 450, 320, 270, 230, 150, 120, 100, 60, 50, 40` | seeded values |
| `RANK_DECAY_K` | `3.5` | unchanged | it's an **exponent** shaping the curve, not an amplitude. The amplitude lives in `seedService.rankToValue` |
| `SCORING_MULTIPLIERS` | — | unchanged | ratios |
| `PICK_YEAR_DECAY`, `PICK_SF_FIRST_ROUND_MULTIPLIER` | — | unchanged | ratios |
| `SCORING`, `REC_BONUS`, `TEP_BONUS` | — | unchanged | **fantasy points**, a different unit entirely |
| `STAT_SENSITIVITY` | `RED 0.35, DYN 0.15` | **unchanged** | z-score multiplier producing an absolute delta — damped 10× relatively, same as votes. This is intentional |
| `STAT_CAP` | `RED 0.8, DYN 0.4` | **unchanged** | same. A monster week now moves a player at most 0.8 out of 1000 |
| `AGE_NUDGE` | RB `-0.05`, WR/TE/QB `-0.03` | RB `-0.5`, WR `-0.3`, TE `-0.3`, QB `-0.3` | **scales ×10.** Aging is a slow structural drift, not crowd noise — it should keep its current relative effect over a season |
| `MIN_VALUE_FOR_EXPECTATION` | `5` | `50` | a value threshold |
| `INACTIVE_THRESHOLD_WEEKS` | `8` | unchanged | weeks |
| `INACTIVE_DECAY_RATE` | `0.15` | **unchanged** | Landmine 2 — multiplicative |
| `INACTIVE_FLOOR` | `1.0` | `1.0` | matches the new clamp floor |
| `INACTIVE_MIN_VALUE` | `5` | `50` | a value threshold |

Note the deliberate asymmetry and comment it: **votes and stat adjustments stay absolute (10× damped); age nudges and seeded values scale ×10.**

#### `server/src/services/seedService.ts`

`rankToValue` is the amplitude:

```ts
const raw = 100 * Math.exp(-RANK_DECAY_K * (rank - 1) / N);   // → 1000 *
```

Change the multiplier to `1000` and update the docstring: rank 1 ≈ 1000, rank ~50 ≈ 650, rank ~200 ≈ 150, floor 1.0. `RANK_DECAY_K` stays `3.5` so the curve **shape** is identical — verify that `rankToValue(r, N) === 10 × old_rankToValue(r, N)` for all r, modulo rounding.

The `clampRound` calls at ~L397 and ~L454 need no change; they pick up the new bounds.

#### `scripts/import-rankings.ts`

The validation gate at ~L67:

```ts
if (newValue < 1.0 || newValue > 100.0) {      // → 1000.0
  errors.push(`${file}:${i + 1} - value ${newValue} outside [1.0, 1000.0]`);
```

---

### Scale invariance of the trade calculator — this is a hard requirement

`evaluateTrade` derives everything from `lean = diff / total`, a **ratio**. Multiply every input value by 10 and `diff` and `total` both scale by 10, so `lean` is unchanged, so `scale`, `verdict`, `verdictLabel`, and `differencePct` are all unchanged.

**Therefore: no trade verdict may change as a result of this migration.** If any existing verdict assertion in `shared/src/value.test.ts` starts failing after you ×10 its input values, you have introduced a bug — go find it. Do **not** retune `BANDS` or `SCALE_MULTIPLIER` to make a test pass.

The quantities that do scale linearly and whose expected values must be ×10'd in tests: `sideValue`, `rawSum`, `adjustment`, `valueAdjustment`, `adviceGap`.

#### One existing defect to fix while you're in here

`computeValueAdjustment` ends with:

```ts
const adjustment = clampRound(penaltyDiff);
```

`penaltyDiff` is a **delta**, but `clampRound` imposes a minimum of 1.0 — so a genuine depth-penalty difference of 0.4 is inflated to 1.0, and the reported adjustment stops matching `rawSum + adjustment`. The docstring already claims "clamped to [0, 100]," which the code does not do. **Use `round1(penaltyDiff)` instead** and correct the docstring to `[0, 1000]`. Fix this in the same pass so the ×10 test updates are computed against correct behavior.

---

### Database migration

The production DB at `/data/empire-fantasy.db` on Fly holds live crowd votes. All existing rows must move to the new scale — current values, the full adjustment log, and the history snapshots — so charts stay continuous and `adjustment_log.old_value` still reconciles against the running value.

Add **`server/src/db/migrations/004_value_scale_1000.sql`**. Do not edit `001_init.sql` — it is already applied.

The complication: `asset_values` carries `value REAL NOT NULL CHECK (value BETWEEN 1.0 AND 100.0)`, and **SQLite cannot ALTER a CHECK constraint.** The table must be rebuilt. Follow the documented 12-step ALTER TABLE procedure:

1. `PRAGMA foreign_keys=off;` and wrap the whole migration in a transaction.
2. `CREATE TABLE asset_values_new (...)` — identical to the current definition except `CHECK (value BETWEEN 1.0 AND 1000.0)`. Copy the PK, FKs, and any indexes verbatim from `001_init.sql`; don't reconstruct them from memory.
3. `INSERT INTO asset_values_new SELECT asset_id, league_type_id, MIN(1000.0, value * 10), updated_at FROM asset_values;` — the `MIN` guards the ceiling; nothing should hit it, but a rounding artifact at exactly 100.0 shouldn't abort the migration.
4. `DROP TABLE asset_values;` then `ALTER TABLE asset_values_new RENAME TO asset_values;`
5. Recreate any indexes that lived on the old table.
6. `PRAGMA foreign_key_check;` before committing.

Then the unconstrained tables, straightforward UPDATEs:

```sql
UPDATE adjustment_log SET old_value = old_value * 10, new_value = new_value * 10, delta = delta * 10;
UPDATE value_history  SET value = value * 10;
```

Scaling `delta` alongside `old_value`/`new_value` keeps historical rows internally consistent (`old + delta = new`). Historical vote deltas will therefore read as 1.0–2.0 while new ones read 0.1–0.2 — that is correct and expected: it accurately records that old votes *did* carry 10× the relative weight. Do not attempt to rewrite history to look like the new regime.

Round after scaling so stored values keep one decimal: `ROUND(value * 10, 1)`.

Finally, update `docs/01-architecture.md`'s schema listing to show the new CHECK bound.

---

### CSVs

`data/rankings/*.csv` (24 files) are exports of the DB, not hand-maintained sources. **Do not hand-edit them and do not ×10 them with a script.** After the migration applies, regenerate with `npm run rankings:export`. Confirm the header row is unchanged (`asset_id,kind,name,position,team,age,value`) and spot-check that the top value reads ~1000 rather than ~100.

The seed inputs — `data/seed-rankings/`, `data/fixtures/`, and the four root-level `*.csv` sheets — are **rank-ordered, not value-ordered**. They need no change. Confirm this before touching anything in `data/`.

---

### Client

| File | Change |
|---|---|
| `client/src/components/ValueChart.tsx` ~L59 | `const yMax = Math.min(100, ...)` → `1000`. This currently caps the y-axis at 100 and would flatten every chart into a clipped line at the top of the plot |
| `client/src/pages/Rankings.tsx`, `PlayerDetail.tsx`, `Calculator.tsx`, `components/AssetSearch.tsx` | `.toFixed(1)` calls need no logic change, but check column widths and chip sizing — values go from 4 characters (`98.9`) to 6 (`998.9`), and the rankings table, asset chips, and the "show the math" table are all tight enough that this may wrap or overflow. Widen what needs widening in `theme.css` |
| `client/src/pages/Calculator.tsx` ~L251 | `add a ~{result.adviceGap.toFixed(0)}-value player` — still correct, just verify it reads sensibly with a 3-digit number |
| `client/src/components/TradeScale.tsx` | **no change** — operates on the −100…100 needle |

Keep the retro terminal theme intact (`docs/05-ui-spec.md`). No new colors, no restyle — this is a numeric width accommodation only.

---

### Tests (`shared/src/value.test.ts`)

Every existing test must still pass, updated for the new scale:

- `clampRound`: the "clamps above 100.0" case becomes "clamps above 1000.0". Keep the floor case at 1.0.
- `trueValue`: "maps 100 to 100" → adapt to the new range.
- All `evaluateTrade` invariants (1–5): ×10 the input values and the expected `sideValue` / `rawSum` / `adjustment` / `adviceGap` numbers. **Verdicts and `scale` values must be unchanged** — that's the regression guard.
- The McMillan / Harrison + Stowers fixture becomes `737.0` vs `518.0 + 237.0`. Verified expected output on the new scale:

  ```
  Team 1: rawSum 737.0, weighted 737.0,                        penalty  0.0
  Team 2: rawSum 755.0, weighted 518.0 + 237.0×0.9 = 731.3,    penalty 23.7

  valueAdjustment = 23.7 → Team 1     (not 24.0 — note this is now exact,
  Team 1 total = 760.7                 where the old scale's 2.37 rounded to 2.4)
  Team 2 total = 755.0
  diff = 5.7  →  lean 0.00376  →  scale 1  →  Fair trade
  ```

  Same verdict and same `scale` as the old-scale fixture. That is the point.

Add these new cases:

1. **Scale invariance of verdicts.** Over a table of fixtures, assert `evaluateTrade(values)` and `evaluateTrade(values.map(v => v * 10))` produce identical `verdict` and `scale`. This is the single most valuable test in this change.
2. **`ELO_SCALE` preservation.** `computePairwiseDelta(560, 500)` on the new scale must equal `computePairwiseDelta(56, 50)` on the old — assert `expected ≈ 0.760` and the delta ≈ 0.048.
3. **Vote deltas stayed absolute.** `computeVoteDeltas(500, 500, 500)` yields the same deltas as `computeVoteDeltas(50, 50, 50)` did: `keepDelta ≈ 0.2`, `cutDelta ≈ -0.2`. Assert the magnitude is < 0.5, i.e. under 0.05% of the scale.
4. **Depth-penalty adjustment is no longer floor-inflated.** A fixture whose true `penaltyDiff` is below 1.0 must report that value, not 1.0.
5. `rankToValue` (if reachable from tests) produces ~1000 at rank 1 and preserves the old curve shape ×10.

---

### Verification

- `npm test` green.
- **Back up production before the migration runs.** Take a copy of `/data/empire-fantasy.db` via `fly ssh console` first. This migration drops and rebuilds a table holding live user data.
- Apply the migration against a **copy** of the prod DB first. Then assert, by query: `MAX(value)` in `asset_values` is ≈1000 and ≤1000; `MIN(value)` ≥ 1.0; row count is identical pre/post; `PRAGMA foreign_key_check` is clean; and for a sampled asset, `old_value + delta = new_value` still holds across its `adjustment_log` rows.
- Manual: rankings page top player reads ~1000.0; no column overflow or wrapping in the table.
- Manual: a player detail chart renders with a sane y-axis, not clipped flat at the top.
- Manual: run a trade you have a "before" verdict for and confirm the **verdict and needle position are unchanged**. Side totals should read 10× larger.
- Manual: cast a KTC vote and check the Log — the delta should read ~0.1–0.2 against a value in the hundreds, and the three `reason='vote'` rows should show `old_value + delta = new_value`.
- Manual: confirm older log rows still show their original (now ×10) deltas without breaking the Log UI's formatting.

---

### Docs

Per CLAUDE.md, docs ship in the same commit. Every one of these currently states the old range:

- **`CLAUDE.md` hard rule 1** — "Player values are 1.0–100.0" → 1.0–1000.0. Also the `docs/03` row in the doc map table ("1–100 value system").
- **`docs/00-overview.md`** L8, L24, L35 — the 1–100 references.
- **`docs/01-architecture.md`** L87 — the `asset_values` CHECK constraint.
- **`docs/02-data-pipeline.md`** L32–34 (the `rankToValue` curve and its tuning targets), L63 (the import bounds).
- **`docs/03-scoring-adjustments.md`** L5, plus the adjustment caps section. **Document the asymmetry explicitly**: why vote and stat deltas stayed absolute while age nudges scaled, and why `INACTIVE_DECAY_RATE` needed no change.
- **`docs/04-trade-calculator.md`** L17 — "raw linear 1–100 score."
- **`README.md`** L8 — "Player values (1-100)."
- **`docs/06-roadmap.md`** — add to Done with today's date.

---

### Out of scope

Do not retune `RANK_DECAY_K`, the depth weights, `SCALE_MULTIPLIER`, or the verdict bands. Do not change the fantasy-points scoring constants. Do not "rebalance" any player's relative position — this migration must be a pure ×10 of the existing ranking order plus the constant asymmetry specified above. If the new resolution reveals distinctions you think are wrong, that's a separate task for the roadmap, not this one.

<!-- ==================== END PROMPT — stop pasting here ==================== -->

---

## ROUTING (for Aven — do not paste)

This spans four agents plus two @mention-only ones.

| Work | File(s) | Agent |
|---|---|---|
| `CLAUDE.md` hard rule 1, `docs/00`, `docs/01`, `docs/06`, `README.md` | — | **build** only |
| `clampRound` bounds, `ELO_SCALE`, `K` comment, all of `constants.ts`, `seedService.rankToValue`, `import-rankings.ts`, migration `004`, docs 02–03 | `shared/src/value.ts` (vote/stat sections), `shared/src/constants.ts`, `server/src/services/*`, `scripts/`, `migrations/` | **rankings** |
| `computeAdviceGap` ceiling, `computeValueAdjustment` floor-inflation fix, docs 04 | `shared/src/value.ts` (trade section), `docs/04` | **trade-calculator** |
| `ValueChart` yMax, column/chip widths, docs 05 | `client/**` | **ui** |
| Backup + deploy | — | **@deployment** |
| Commit + push | — | **@git** |

**Send it to `build`.** `CLAUDE.md` hard rule 1 is the canonical statement of the value range and no domain agent can edit it. Append this line to the prompt:

> Update CLAUDE.md hard rule 1, docs/00, docs/01, docs/06 and README.md yourself first. Then dispatch in this order: (1) rankings — constants.ts, clampRound, ELO_SCALE, seedService, import-rankings, migration 004, docs 02–03; (2) trade-calculator — the adviceGap ceiling, the computeValueAdjustment round1 fix, and docs/04; (3) ui — the client width and chart-axis work, docs/05. Do not edit their files directly, and do not let a later pass revisit an earlier pass's constants.

**Order is load-bearing.** `clampRound` and `constants.ts` must land before trade-calculator computes its ×10 test expectations, and both must land before `ui` sees 4-digit values to size against. `rankings` and `trade-calculator` both edit `shared/src/value.ts` and `value.test.ts` — sequential passes are what keeps them from clobbering each other. If build's dispatching gets unreliable, run the three manually in that exact order.

**Then, separately:**

1. `@deployment` — `fly status`, then back up `/data/empire-fantasy.db` via `fly ssh console` **before** migration 004 ever runs against prod. Apply to a local copy of the prod DB and run the verification queries first. This migration drops and rebuilds `asset_values`; a bad rebuild loses every vote cast to date.
2. `npm run rankings:export` locally after the migration, so the 24 committed CSVs match the new scale. Easy to forget — they're committed, and stale ones will confuse the next `rankings:import`.
3. `@git` — commit and push (it runs `npm test` first).

**Consider one `plan` pass here**, unlike the last two prompts. This touches ~15 files across four agents with a destructive migration in the middle, and the file-by-file spec above is detailed but doesn't sequence the *prod cutover*. A planning pass at temperature 0.1 is a cheap second opinion on migration ordering. Ignore it if it proposes retuning constants — the asymmetry in the table is a decision, not a suggestion.

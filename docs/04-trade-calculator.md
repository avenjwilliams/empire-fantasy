# 04 — Trade Calculator

Two teams, any league type, any mix of players (and picks in DYN). Stateless evaluation.

## Why raw sums fail (legacy context)

The original design used a convex transformation to make elite players resist quantity: a 99-value player was worth far more than three 33s because he occupied one slot and the extras displaced nothing. The algorithm used:

1. **Nonlinear true value**: `trueValue(v) = (v / 100) ^ EXP * 10000` (EXP = 2.6)
2. **Depth weighting**: roster-spot discounts for additional assets
3. **Weighted side values**: minimized impact of multiple lower-value players vs single elite asset

## Algorithm (`shared/value.ts` → `evaluateTrade`) — **Linear Version with Value Adjustment Credit**

### Step 1 — linear values (no convex transformation)

Use each asset's raw linear 1–1000 score directly. No convex curve transformation applied.

### Step 2 — depth (roster-spot) discount and Value Adjustment credit

Sort each side's assets by linear value descending, apply depth weights:

```
weights = [1.0, 0.9, 0.8, 0.65, 0.5, 0.4, 0.3, ...]  # 0.3 floor after 6th asset
weightedSum = Σ linearValue_i * weight_i
rawSum      = Σ linearValue_i
depthPenalty = rawSum − weightedSum              # ≥ 0, larger for deeper/more-fragmented sides
```

**Value Adjustment (roster-spot credit):**

```
valueAdjustment = |depthPenalty_1 − depthPenalty_2|
valueAdjustmentSide = side with SMALLER depthPenalty  # fewer / more concentrated pieces
sideTotal(side) = rawSum + (side === valueAdjustmentSide ? valueAdjustment : 0)
```

This is algebraically identical to the old weighted-sum math. With `a_i = raw_i − penalty_i` (today's sideValue), the new difference is `(raw_1 + penalty_2 − penalty_1) − raw_2 = a_1 − a_2`. Same diff, same lean, same verdict, same scale. If a verdict changes for any input, you have a bug — go find it, do not "fix" it by tuning constants.

Key properties:
- **Equal piece counts** ⇒ equal penalties ⇒ zero adjustment. Verified for 1-for-1 and 2-for-2 with identical value distributions.
- **Adjustment reported on Fair trades too** — it's a structural roster-spot correction, not a "someone is losing" signal. Only when both sides have identical depth penalties (e.g., 1-for-1, or 2-for-2 in current weight scheme) is it 0 / null.
- **valueAdjustment ≠ adviceGap**. `adviceGap` = "add a ~540-value player to even this out" (losing-side additive). `valueAdjustment` = the roster-spot credit. Both exist in the response.

### Direction convention

**Team 1 and Team 2 are the sides *receiving* assets.** The side with the higher `sideValue` (raw sum + value adjustment) received more value and is the side the trade favors. This convention is used everywhere: `diff = sideTotal1 − sideTotal2`; when `diff > 0`, Team 1 received more and the trade favors Team 1; when `diff < 0`, Team 2 received more and the trade favors Team 2.

### Step 3 — verdict

```
diff    = sideTotal1 − sideTotal2           # >0 means Team 1 receives more, trade favors Team 1
total   = sideTotal1 + sideTotal2
lean    = diff / max(total, 1)              # -1..1
```

Map lean to a **display scale from −100 (favors Team 1) to +100 (favors Team 2)**: `scale = round(-lean * 300)` clamped to ±100 (×300 so a 1/3 imbalance pegs the meter). Bands:

| |lean| | Verdict |
|---|---|
| < 0.03 | Fair trade |
| 0.03–0.08 | Slight edge |
| 0.08–0.18 | Clear win |
| > 0.18 | Landslide |

### Response shape (POST /api/trade/evaluate)

```json
{
  "leagueType": "DYN_SF_PPR_STD",
  "team1": { 
    "assets": [{"id":1, "name":"...", "value":737.0, "trueValue":737, "weight":1.0}],
    "sideValue": 760.7,
    "rawSum": 737.0,
    "adjustment": 23.7
  },
  "team2": { 
    "assets": [{"id":2, "name":"...", "value":518.0, "trueValue":518, "weight":1.0}, {"id":3, "name":"...", "value":237.0, "trueValue":237, "weight":0.9}],
    "sideValue": 755.0,
    "rawSum": 755.0,
    "adjustment": 0
  },
  "scale": 1,
  "verdict": "Fair trade",
  "differencePct": 0.8,
  "adviceGap": null,
  "valueAdjustment": 23.7,
  "valueAdjustmentSide": 1,
  "suggestions": [
    {
      "id": 10,
      "name": "Justin Jefferson",
      "position": "WR",
      "team": "MIN",
      "value": 920.5,
      "side": 2,
      "resultingLean": 0.012,
      "resultingVerdict": "Fair trade"
    }
  ]
}
```

- `sideValue`: displayed total = `rawSum + adjustment` (rounded to 1 decimal)
- `rawSum`: plain sum of player values (matches the chips exactly)
- `adjustment`: value adjustment credit (0 if this side receives none)
- `valueAdjustment`: absolute difference in depth penalties between sides (null when equal)
- `valueAdjustmentSide`: 1 or 2 (side receiving the credit), or null
- `adviceGap`: unchanged — linear value needed on losing side at next slot weight to close `|diff|` (null on Fair trade)
- `suggestions`: up to 3 concrete assets that would move the trade toward Fair, closest fit first. Empty array when verdict is already "Fair trade". See **Trade Suggestions** below.

### Trade Suggestions (Players to Even Trade)

When the verdict is not "Fair trade", the API returns up to three concrete assets that, if added to the losing side, would bring the trade closer to fair. This mirrors Keep Trade Cut's "Players to Even Trade" panel.

#### Selection Algorithm: Simulate, Don't Filter

The obvious implementation — `SELECT ... WHERE value BETWEEN adviceGap * 0.9 AND adviceGap * 1.1` — is **wrong** in this codebase.

Since the value-adjustment refactor, a side's total is `rawSum + adjustment`, where the adjustment derives from the difference in depth penalties between the two sides. Adding an asset to the losing side changes that side's piece count, which changes its depth penalty, which changes **both** sides' adjustments. The arithmetic is not additive, so an asset whose raw value equals `adviceGap` does **not** land the trade on Fair.

KTC's own panel shows this: against a stated target of 6458 their suggestions are 7030, 6820, 6360, and 6353 — spread around the target, not clustered on it.

**Therefore: simulate, don't filter.** For each candidate asset, construct the hypothetical trade with that asset appended to the losing side, run the real `evaluateTrade` on it, and score the candidate by the resulting `|lean|`. This is exact by construction and immune to future changes in the trade math. Cost is trivial — a few hundred candidates of pure arithmetic, no extra queries once the values are loaded.

Use `adviceGap` only to pre-narrow the candidate pool for performance (e.g., assets within ±40% of it), never as the final ranking. If the pool comes back with fewer than ~20 candidates, widen it rather than returning a short list.

#### Selection: Position-Diverse, Best Fit Per Position

Ranking purely by `|lean_after|` tends to return three near-identical WRs. Instead:

1. **Simulate every candidate.** Discard any that makes the trade worse (i.e. `|lean_after| >= |lean_before|`) — adding an asset that widens the gap is never a suggestion.
2. **Group survivors by position** (QB, RB, WR, TE, and treat PICK as its own group).
3. **Take the single best candidate** (lowest `|lean_after|`) from each group.
3. **Sort those group-winners by `|lean_after|` ascending** and return the top 3.
4. If fewer than 3 groups produced a candidate, backfill from the remaining pool by `|lean_after|` — better to show three suggestions from two positions than to show two.

Return them sorted by `|lean_after|` ascending, so the closest fit is first.

#### Eligibility

- Exclude any asset already on either side of the trade.
- Exclude assets with no `asset_values` row for the current league type.
- **Rookie picks are eligible in DYN_* league types and must never be suggested in RED_* — CLAUDE.md hard rule 5.** The existing endpoint already rejects picks in Redraft; the suggestion path needs the same guard, and it's a separate code path so it won't inherit it for free.
- Suggestions always go to the side that is receiving less (the losing side), which is the side `adviceGap` already refers to.
- Return no suggestions when the verdict is "Fair trade". Nothing to fix.

### Worked example

Team 1 receives: **Tetairoa McMillan 737.0**  
Team 2 receives: **Marvin Harrison Jr. 518.0**, **Eli Stowers 237.0**

| | Team 1 | Team 2 |
|---|---|---|
| Raw sum | 737.0 | 755.0 |
| Weighted sum | 737.0 × 1.0 = 737.0 | 518.0 × 1.0 + 237.0 × 0.9 = 731.3 |
| Depth penalty | 0.0 | 23.7 |
| Value adjustment | **+23.7** (to Team 1) | 0 |
| **Total (displayed)** | **760.7** | **755.0** |

diff = 5.7 → lean = 0.00376 → **Fair trade** (same as old: 737.0 vs 731.3)

The adjustment updates as players are added to either side — it is not a static constant.

## Constants

Depth weights, band thresholds — all in one exported `TRADE_CONSTANTS` object in `shared/value.ts`. Unit-test invariants:

1. Equal single players → scale 0, "Fair trade".
2. One 950 vs three 550s → favors the three 550s side (Team 2 receives more total value).
3. One 950 vs three 550s in the other order → symmetric result (sign flips exactly).
4. Adding a 100-value throw-in to a landslide barely moves the scale.
5. Weights monotone non-increasing.
6. **Equal piece counts ⇒ valueAdjustment === null on both sides.**
7. **1-for-2 ⇒ adjustment goes to the one-player side, equals that side's depth-penalty shortfall.**
8. **McMillan / Harrison+Stowers example ⇒ Fair trade with valueAdjustment ≈ 23.7 to Team 1.**
9. **Adding a piece to either side changes the adjustment (not static).**
10. **Adjusted totals produce identical verdict as old weighted-sum math across a table of fixtures (regression guard).**
11. **Label/sign agreement: a verdict naming Team 1 always carries scale < 0; a verdict naming Team 2 always carries scale > 0.**

## Boom / Bust Profile (Descriptive Only)
7. **1-for-2 ⇒ adjustment goes to the one-player side, equals that side's depth-penalty shortfall.**
8. **McMillan / Harrison+Stowers example ⇒ Fair trade with valueAdjustment ≈ 23.7 to Team 1.**
9. **Adding a piece to either side changes the adjustment (not static).**
10. **Adjusted totals produce identical verdict as old weighted-sum math across a table of fixtures (regression guard).**

## Boom / Bust Profile (Descriptive Only)

When the trade evaluator receives assets with `boom_pct` and `bust_pct` (integer 0–100, or null for unrated assets/picks), it computes value-weighted averages for each side and attaches them to the response as `boomBust`. **This is purely descriptive — it never affects scale, verdict, lean, valueAdjustment, adviceGap, or suggestions.**

### Averaging Formula

For each side, the average is a value-weighted mean over **rated assets only** (assets where at least one of boom/bust is non-null):

```
boom = Σ(value_i × boom_pct_i) / Σ(value_i)   for all i where boom_pct_i ≠ null
bust = Σ(value_i × bust_pct_i) / Σ(value_i)   for all i where bust_pct_i ≠ null
```

- **Weight is raw value**, not the depth weight (`getWeight(i)`). Using depth weights would couple the overlay to the verdict pipeline and make a side's boom number change based on how many other pieces are in the trade.
- **Unrated assets (picks, ungenerated players) are excluded from both numerator and denominator**. They are not treated as 0, and they do not shrink the result by staying in the denominator. They are counted in `unratedCount` for the coverage note.
- **Round to integer** with `Math.round`. These are integer percentages matching the players table. Do not use `clampRound` or `round1` — those belong to the 1.0–1000.0 value scale.
- **Return `null` when no rated assets** (empty side, all-picks side, or all ungenerated players). Do not return 0 — zero is a real rating and means something different from "unknown."
- **Boom and bust are independent** — each uses its own denominator. In practice they're always both set or both null, but the function does not assume this.

### Response Shape Additions

```json
{
  "boomBust": {
    "team1": { "boom": 40, "bust": 25, "ratedCount": 1, "unratedCount": 0 },
    "team2": { "boom": 57, "bust": 17, "ratedCount": 2, "unratedCount": 0 }
  }
}
```

`boomBust` is always present — both sides always return an object with the four fields. Never null or absent at the top level.

### Regression Guard

The primary test invariant: **for every fixture, the six verdict fields (`scale`, `verdict`, `differencePct`, `adviceGap`, `valueAdjustment`, `valueAdjustmentSide`) are bit-for-bit identical whether or not boom/bust is supplied on the input assets.** If any changes, the implementation has leaked the overlay into the verdict pipeline — find and fix the leak, do not "re-tune" the constants.

### Why Raw Value Weighting (Not Depth Weighting)

The depth weights model roster scarcity in the verdict math. If the boom overlay used depth weights, a side's average boom would change simply by adding or removing a throw-in piece, even though the underlying players haven't changed. Raw value weighting makes the overlay stable and intuitive: the average represents the value-weighted volatility profile of the assets actually being traded.

### Unrated Assets and Coverage

Picks are always unrated. Players may be unrated if `scripts/generate-boom-bust.ts` hasn't covered them. An excluded asset must not be silently treated as 0, and must not shrink the result by staying in the denominator.

When a side has `unratedCount > 0`, the UI renders a coverage note: "excludes N unrated". This is mandatory — in Dynasty, a package of one player plus three picks would otherwise show a confident-looking average that describes a single asset.

## Edge cases

- Empty side → reject with 400 **only when both sides are empty**. One empty side is now allowed (see Architecture doc).
- Picks selected while league type is RED → reject at input (UI hides picks; server validates).
- Max 15 assets per side.
- Duplicate asset on both sides → 400.
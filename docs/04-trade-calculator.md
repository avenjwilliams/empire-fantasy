# 04 — Trade Calculator

Two teams, any league type, any mix of players (and picks in DYN). Stateless evaluation.

## Why raw sums fail (legacy context)

The original design used a convex transformation to make elite players resist quantity: a 99-value player was worth far more than three 33s because he occupied one slot and the extras displaced nothing. The algorithm used:

1. **Nonlinear true value**: `trueValue(v) = (v / 100) ^ EXP * 10000` (EXP = 2.6)
2. **Depth weighting**: roster-spot discounts for additional assets
3. **Weighted side values**: minimized impact of multiple lower-value players vs single elite asset

## Algorithm (`shared/value.ts` → `evaluateTrade`) — **Linear Version with Value Adjustment Credit**

### Step 1 — linear values (no convex transformation)

Use each asset's raw linear 1–100 score directly. No convex curve transformation applied.

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
- **valueAdjustment ≠ adviceGap**. `adviceGap` = "add a ~54-value player to even this out" (losing-side additive). `valueAdjustment` = the roster-spot credit. Both exist in the response.

### Step 3 — verdict

```
diff    = sideTotal1 − sideTotal2           # >0 means Team 1 gives more, i.e. trade favors Team 2
total   = sideTotal1 + sideTotal2
lean    = diff / max(total, 1)              # -1..1
```

Map lean to a **display scale from −100 (favors Team 1) to +100 (favors Team 2)**: `scale = round(lean * 300)` clamped to ±100 (×300 so a 1/3 imbalance pegs the meter). Bands:

| |lean| | Verdict |
|---|---|
| < 0.03 | Fair trade |
| 0.03–0.08 | Slight edge |
| 0.08–0.18 | Clear win |
| > 0.18 | Landslide |

### Response shape

```json
{
  "leagueType": "DYN_SF_PPR_STD",
  "team1": { 
    "assets": [{"id":1, "name":"...", "value":73.7, "trueValue":74, "weight":1.0}],
    "sideValue": 76.1,
    "rawSum": 73.7,
    "adjustment": 2.4
  },
  "team2": { 
    "assets": [{"id":2, "name":"...", "value":51.8, "trueValue":52, "weight":1.0}, {"id":3, "name":"...", "value":23.7, "trueValue":24, "weight":0.9}],
    "sideValue": 75.5,
    "rawSum": 75.5,
    "adjustment": 0
  },
  "scale": 0,
  "verdict": "Fair trade",
  "differencePct": 0.8,
  "adviceGap": null,
  "valueAdjustment": 2.4,
  "valueAdjustmentSide": 1
}
```

- `sideValue`: displayed total = `rawSum + adjustment` (rounded to 1 decimal)
- `rawSum`: plain sum of player values (matches the chips exactly)
- `adjustment`: value adjustment credit (0 if this side receives none)
- `valueAdjustment`: absolute difference in depth penalties between sides (null when equal)
- `valueAdjustmentSide`: 1 or 2 (side receiving the credit), or null
- `adviceGap`: unchanged — linear value needed on losing side at next slot weight to close `|diff|` (null on Fair trade)

### Worked example

Team 1 receives: **Tetairoa McMillan 73.7**  
Team 2 receives: **Marvin Harrison Jr. 51.8**, **Eli Stowers 23.7**

| | Team 1 | Team 2 |
|---|---|---|
| Raw sum | 73.7 | 75.5 |
| Weighted sum | 73.7 × 1.0 = 73.7 | 51.8 × 1.0 + 23.7 × 0.9 = 73.13 |
| Depth penalty | 0.0 | 2.37 |
| Value adjustment | **+2.37 → 2.4** (to Team 1) | 0 |
| **Total (displayed)** | **76.1** | **75.5** |

diff = 0.6 → lean = 0.004 → **Fair trade** (same as old: 73.7 vs 73.13)

The adjustment updates as players are added to either side — it is not a static constant.

## Constants

Depth weights, band thresholds — all in one exported `TRADE_CONSTANTS` object in `shared/value.ts`. Unit-test invariants:

1. Equal single players → scale 0, "Fair trade".
2. One 95 vs three 55s → favors the 95 side (depth weighting only).
3. One 95 vs three 55s in the other order → symmetric result (sign flips exactly).
4. Adding a 10-value throw-in to a landslide barely moves the scale.
5. Weights monotone non-increasing.
6. **Equal piece counts ⇒ valueAdjustment === null on both sides.**
7. **1-for-2 ⇒ adjustment goes to the one-player side, equals that side's depth-penalty shortfall.**
8. **McMillan / Harrison+Stowers example ⇒ Fair trade with valueAdjustment ≈ 2.4 to Team 1.**
9. **Adding a piece to either side changes the adjustment (not static).**
10. **Adjusted totals produce identical verdict as old weighted-sum math across a table of fixtures (regression guard).**

## Edge cases

- Empty side → reject with 400 ("both teams need at least one asset").
- Picks selected while league type is RED → reject at input (UI hides picks; server validates).
- Max 15 assets per side.
- Duplicate asset on both sides → 400.
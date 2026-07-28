# 04 — Trade Calculator

Two teams, any league type, any mix of players (and picks in DYN). Stateless evaluation.

## Why raw sums fail (legacy context)

The original design used a convex transformation to make elite players resist quantity: a 99-value player was worth far more than three 33s because he occupied one slot and the extras displaced nothing. The algorithm used:

1. **Nonlinear true value**: `trueValue(v) = (v / 100) ^ EXP * 10000` (EXP = 2.6)
2. **Depth weighting**: roster-spot discounts for additional assets
3. **Weighted side values**: minimized impact of multiple lower-value players vs single elite asset

## Algorithm (`shared/value.ts` → `evaluateTrade`) — **Linear Version**

### Step 1 — linear values (no convex transformation)

Use each asset's raw linear 1–100 score directly. No convex curve transformation applied.

### Step 2 — depth (roster-spot) discount

Sort each side's assets by linear value descending, apply depth weights:

```
weights = [1.0, 0.9, 0.8, 0.65, 0.5, 0.4, 0.3, ...]  # 0.3 floor after 6th asset
sideValue = Σ linearValue_i * weight_i
```

This model still reflects diminishing roster utility of each additional incoming piece. Picks count as assets like any other.

### Step 3 — verdict

```
diff    = sideValue1 - sideValue2          # >0 means Team 1 gives more, i.e. trade favors Team 2
total   = sideValue1 + sideValue2
lean    = diff / max(total, 1)             # -1..1
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
  "team1": { "assets": [{"id":1, "name":"...", "value":92.1, "trueValue":92, "weight":1.0 }], "sideValue": 183.4 },
  "team2": { ... },
  "scale": -23,
  "verdict": "Clear win — Team 1",
  "differencePct": 7.7,
  "adviceGap": 54,
  "valueAdjustment": 85.7
}
```

`adviceGap`: the linear value a hypothetical added asset would need to roughly even the trade (find v where v·nextWeight ≥ |diff|) — powers a "to make it fair, add a ~54-value player" hint. `null` when trade is fair.

`valueAdjustment`: total linear value difference between sides (sum of values on side A - sum on side B). This number is positive and assigned to indicate how much value the winning side has beyond the losing side, without changing actual player values.

The client's "Show the math" panel renders per-asset breakdowns from the `assets` array: `value` (linear 1–100), `trueValue` (now equals linear value), `weight` (slot depth discount), and `weighted` (linearValue × weight).

## Constants

Depth weights, band thresholds — all in one exported `TRADE_CONSTANTS` object in `shared/value.ts`. Unit-test invariants (note: updated based on linear evaluation):

1. Equal single players → scale 0, "Fair trade".
2. One 95 vs three 55s → favors the 95 side (now depends on depth weighting only).
3. One 95 vs three 55s in the other order → symmetric result (sign flips exactly).
4. Adding a 10-value throw-in to a landslide barely moves the scale.
5. Weights monotone non-increasing.

## Edge cases

- Empty side → reject with 400 ("both teams need at least one asset").
- Picks selected while league type is RED → reject at input (UI hides picks; server validates).
- Max 15 assets per side.
- Duplicate asset on both sides → 400.

# 04 — Trade Calculator

Two teams, any league type, any mix of players (and picks in DYN). Stateless evaluation.

## Why raw sums fail

Fantasy rosters have limited starting slots. A 99-value player is worth far more than three 33s: he occupies one slot and outscores what any of those players produce in one slot, and the extras displace nothing. The algorithm must make elite players resist quantity.

## Algorithm (`shared/value.ts` → `evaluateTrade`)

### Step 1 — nonlinear true value

Convert each asset's linear 1–100 score to trade value with a convex curve:

```
trueValue(v) = (v / 100) ^ EXP * 10000     # EXP = 2.6
```

Examples: v=100 → 10000; v=80 → ~5600; v=60 → ~2650; v=40 → ~925; v=20 → ~152. Three 60s (≈7950) no longer beat one 100 by default slot math — the curve does most of the anti-quantity work.

### Step 2 — depth (roster-spot) discount

Sort each side's assets by trueValue descending, weight by slot:

```
weights = [1.0, 0.9, 0.8, 0.65, 0.5, 0.4, 0.3, ...]  # 0.3 floor after 6th asset
sideValue = Σ trueValue_i * weight_i
```

This models the diminishing roster utility of each additional incoming piece. Picks count as assets like any other.

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
  "team1": { "assets": [{ "id":1, "name":"...", "value":92.1, "trueValue":8062, "weight":1.0 }], "sideValue": 8062 },
  "team2": { ... },
  "scale": -23,
  "verdict": "Clear win — Team 1",
  "differencePct": 7.7,
  "adviceGap": 54
}
```

`adviceGap`: the linear value a hypothetical added asset would need to roughly even the trade (find v where adding trueValue(v)·nextWeight closes |diff|) — powers a "to make it fair, add a ~54-value player" hint. `null` when trade is fair.

The client's "Show the math" panel renders per-asset breakdowns from the `assets` array: `value` (linear 1–100), `trueValue` (nonlinear trade value), `weight` (slot depth discount), and `trueValue × weight` (weighted contribution).

## Constants

`EXP = 2.6`, weight ladder, band thresholds — all in one exported `TRADE_CONSTANTS` object in `shared/value.ts`. Unit-test invariants:

1. Equal single players → scale 0, "Fair trade".
2. One 95 vs three 55s → favors the 95 side.
3. One 95 vs three 55s in the other order → symmetric result (sign flips exactly).
4. Adding a 10-value throw-in to a landslide barely moves the scale.
5. trueValue monotone; weights monotone non-increasing.

## Edge cases

- Empty side → reject with 400 ("both teams need at least one asset").
- Picks selected while league type is RED → reject at input (UI hides picks; server validates).
- Max 15 assets per side.
- Duplicate asset on both sides → 400.

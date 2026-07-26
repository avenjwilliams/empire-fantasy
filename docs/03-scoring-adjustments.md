# 03 — Value System & Adjustments

## Principles

- Values are 1.0–100.0, one decimal, per asset per league type.
- **Small steps, long horizon.** One vote or one game barely moves a value. Sustained crowd sentiment or repeated performance moves it meaningfully.
- **Everything is logged.** Every write to `asset_values` is paired with an `adjustment_log` row inside the same transaction.
- All math lives in pure functions in `shared/value.ts` with unit tests. Helpers: `clampRound(v) = min(100, max(1, round(v*10)/10))`.

## KEEP / TRADE / CUT (vote adjustments)

### Prompt generation (`GET /api/ktc/prompt`)

1. Pick a random league type (weight the common ones 2×: `DYN_SF_PPR_STD`, `DYN_1QB_PPR_STD`, `RED_1QB_HALF_STD`, `RED_1QB_PPR_STD`).
2. Pick a random anchor asset with value in [20, 95] (avoid dead zone and untouchable zone). Players only in RED sets; players or picks in DYN sets, but never mix picks and players in one prompt (keeps the question clean).
3. Pick two more assets of the **same kind** with values within ±6.0 of the anchor, excluding trios this session has seen. If fewer than 2 candidates, widen to ±10.0, then re-anchor.
4. Persist the prompt; return assets in random display order with name/team/position/age but **not** their values (don't anchor the user).

### Vote application (`POST /api/ktc/vote`)

The vote is an ordering: KEEP > TRADE > CUT. Convert to pairwise Elo-style updates among the three assets **in that prompt's league type only**:

For each ordered pair (winner W, loser L) — (keep,trade), (keep,cut), (trade,cut):

```
expected = 1 / (1 + 10^((V_L - V_W) / 12))   # 12-point scale: ±6 spread ≈ 24–76% expectation
delta    = K * (1 - expected)                # K = 0.20
V_W += delta ; V_L -= delta
```

- Max total movement per asset per vote ≈ 0.4 points (two pairwise wins/losses at K=0.20). An upset (crowd keeps the lower-valued player) moves more than a chalk result — exactly the Elo property we want.
- Apply all three pairwise updates, clamp/round once at the end, write 3 `asset_values` updates + 3 log rows (`reason='vote'`, `detail={"promptId":...}`) in one transaction. Assets whose net delta rounds to 0.0 still get a log row (delta 0) — cheap and keeps the audit complete.
- **Dampening**: per asset per league type, if the asset has received > 30 vote adjustments in the trailing 7 days, scale K by 0.5 (viral-player protection). Compute from `adjustment_log`.

## Performance (stat) adjustments

Applied per player per league type after each ingested week. Goal: reward over-performance *relative to expectation at their current value*, penalize under-performance. Redraft reacts faster than Dynasty.

### Expectation model

For a league type and week, compute each position's expected points as a function of current value:

1. Take all active players at the position with value ≥ 5.
2. Fit expectation by value percentile: `expected_points = position_week_median + slope * (value - position_median_value)`. Simplest robust version: rank players by value, rank week scores, and map by quantile. (Implement the simple quantile-map first; refine later.)

### Update rule

```
surprise = actual_points - expected_points
z        = surprise / position_week_stddev
raw      = z * S                       # S = sensitivity
S (RED sets) = 0.35 ; S (DYN sets) = 0.15
delta    = clamp(raw, -CAP, +CAP)      # CAP = 0.8 (RED), 0.4 (DYN)
```

- Players on bye / did not play: **no adjustment** (never penalize a bye).
- Injured during game (status change): apply the performance delta but no extra injury penalty in v1 — crowd votes will handle injury sentiment.
- Dynasty age nudge (DYN sets only, applied with week processing): RB age ≥ 27: −0.05/week; WR/TE age ≥ 30: −0.03/week; QB age ≥ 36: −0.03/week. Logged as part of the same `stat` adjustment's detail.
- Log per player per league type: `reason='stat'`, `detail={"season":2026,"week":3,"pts":24.7,"expected":16.2,"delta":0.6}`.

Season-scale sanity check: a player beating expectations by 1 stddev every week for 17 weeks gains ~6 points (RED) — noticeable, not silly. A breakout beating by 2–3 stddev weekly can climb 15–25 points over a season. That matches the design intent.

## Picks

- Vote-adjustable (in DYN prompts), never stat-adjusted.
- Optional `decay` job (post-v1): as the rookie draft approaches, drift pick values toward their round/tier consensus and roll `season` forward after the draft. Log `reason='decay'`.

## History & audit surfaces

- `value_history` daily snapshots → line chart on player detail page (selector for league type).
- `adjustment_log` filterable by asset, league type, reason, date — exposed at `GET /api/log` and a simple Log page in the UI.

# Prompt: KTC-style "Value Adjustment" line item

**Paste into opencode: everything from `## TASK` down to the END PROMPT marker, plus the dispatch line quoted in ROUTING. Do not paste the ROUTING section itself — it's for you, not the agent.**

---

## TASK

Add an explicit, user-facing **Value Adjustment** line item to the trade calculator, modeled on Keep Trade Cut. This is primarily a **reframing of math we already do**, not new math. Read this whole brief before editing anything.

### The problem

Today `evaluateTrade` computes each side's total as a depth-weighted sum:

```
sideValue = Σ (value_i × depthWeight_i)     weights [1.0, 0.9, 0.8, 0.65, 0.5, 0.4, 0.3…]
```

The depth discount is invisible. The UI shows player chips (73.7 on one side; 51.8 + 23.7 on the other) and then a side total (74 vs 73) that **does not equal the chips above it**. A user reading that screen concludes the calculator is broken. It isn't — the second side ate a 0.9 weight on its second piece — but nothing on screen says so.

KTC solved this by never hiding the discount. Their side total is a plain sum of the pieces plus one clearly labeled row: `Value Adjustment  +2342`. Every number on screen adds up, and the one line that isn't a player is labeled and explained.

### The concept (what Value Adjustment means)

A trade is not addition. Sending two players for one costs the receiving side an extra roster spot, and roster spots aren't free — the one-player side keeps a slot open for a waiver add, and a single elite player is harder to acquire than two good ones that sum to the same number. So **the side receiving fewer pieces is owed compensation**, and that compensation is exactly the depth discount the other side incurs.

Per KTC's own description: the adjustment is reverse-engineered from what the lighter side would need added to even things out, which is why it recomputes every time a player is added to either side.

### The spec

Do NOT change the depth weights, the bands, `SCALE_MULTIPLIER`, or the verdict logic. Restate the same arithmetic so the discount surfaces as a credit instead of hiding as a penalty.

For each side:

```
rawSum      = Σ value_i                      // plain sum, matches the chips exactly
weightedSum = Σ (value_i × depthWeight_i)    // what we compute today
depthPenalty = rawSum − weightedSum          // ≥ 0, larger for deeper/more-fragmented sides
```

Then:

```
valueAdjustment     = |depthPenalty_1 − depthPenalty_2|
valueAdjustmentSide = the side with the SMALLER depthPenalty   // fewer / more concentrated pieces
sideTotal(side)     = rawSum + (side === valueAdjustmentSide ? valueAdjustment : 0)
```

Compute `diff`, `lean`, `scale`, `verdict`, and `differencePct` from these new `sideTotal` values.

**This is algebraically identical to the current math.** With `a_i = raw_i − p_i` (today's `sideValue`), the new difference is `(raw_1 + p_2 − p_1) − raw_2 = a_1 − a_2`. Same diff, same lean, same verdict, same scale. If a verdict changes for any input, you have a bug — go find it, do not "fix" it by tuning constants.

Behavioral requirements:

- The adjustment is reported **whenever the depth penalties differ, including on Fair trades.** It is not a "someone is losing" signal — it is a structural roster-spot correction. Only when both sides have identical depth penalties (e.g. 1-for-1, or 2-for-2 in the current weight scheme) is it `0` / `null`.
- Equal piece counts ⇒ equal penalties ⇒ zero adjustment. Verify this holds.
- `valueAdjustment` must stop being an alias for `adviceGap`. They are different quantities and both belong in the response: `adviceGap` = "add a ~54-value player to even this out"; `valueAdjustment` = the roster-spot credit. Keep `adviceGap` exactly as it is.
- Values stay on the 1–100 scale (CLAUDE.md hard rule 1). Do not port KTC's four-digit numbers. Round side totals and the adjustment to **one decimal**, not to integers as `sideValue` does today.
- No new tunable constants. If you think you need one, stop and explain why instead of adding it.

### Worked example (use as a test case)

Team 1 receives: Tetairoa McMillan 73.7
Team 2 receives: Marvin Harrison 51.8, Eli Stowers 23.7

```
Team 1: rawSum 73.7,  weighted 73.7,                    penalty 0.0
Team 2: rawSum 75.5,  weighted 51.8 + 23.7×0.9 = 73.1,  penalty 2.4

valueAdjustment = 2.4 → Team 1 (smaller penalty)
Team 1 total = 73.7 + 2.4 = 76.1
Team 2 total = 75.5
diff = 0.6 → same diff as today's 73.7 vs 73.1 → Fair trade
```

### Response shape

Extend `TradeResult` / `TradeSide` in `shared/src/types.ts`:

- `TradeSide`: add `rawSum: number` and `adjustment: number` (0 for the side that receives none). Keep `sideValue` as the field the UI reads for the displayed total, now equal to `rawSum + adjustment`.
- `TradeResult`: keep `valueAdjustment: number | null` and `valueAdjustmentSide: 1 | 2 | null`, with the new meaning above.

### UI (client/src/pages/Calculator.tsx, client/src/theme.css)

- Under each team's player chips, render a **Value Adjustment row styled as a chip but visually distinct** — muted/hatched background, no position badge, no remove button — showing `+X.X`. Only render it on the side that receives it.
- The team header total must equal chips + adjustment. This is the whole point; if it doesn't add up, the feature has failed.
- Below the adjustment row on that side, add a small link/disclosure: **"More on value adjustment"**. Expanded, it reads:

  > Trading is more than simple addition. We add value to the side of the trade that's giving up more when you look at roster spots, players' "stud" factor, and so on. This counters trade math that says twelve third-round picks are a fair deal for one elite player.
  >
  > The adjustment is reverse-engineered from what the lighter side would need added to even the trade, which is why it updates as players are added to either side.

- Add a piece-count summary line per side matching KTC: `2 Total Pieces / 1 WR, 1 TE`.
- Keep the existing retro terminal theme (`docs/05-ui-spec.md`) — this is a KTC *layout* borrow, not a visual restyle. No new colors outside the existing palette.
- Update the "Show the math" panel: add `rawSum`, `depthPenalty`, and the adjustment to the per-side breakdown, and update the formula caption from "linear depth-weighted sum" to describe the credit framing.

### Tests (`shared/src/value.test.ts`)

Keep all five existing invariants passing unchanged. Add:

1. Equal piece counts ⇒ `valueAdjustment === 0` (or null) on both sides.
2. 1-for-2 ⇒ adjustment goes to the one-player side, and equals that side's depth-penalty shortfall.
3. Adjusted totals produce the identical `scale` and `verdict` as the old weighted-sum math across a table of fixtures — this is the regression guard for the refactor.
4. The McMillan / Harrison + Stowers example above resolves to Fair trade with `valueAdjustment ≈ 2.4` to Team 1.
5. Adding a piece to either side changes the adjustment (it is not static).

### Docs

Update `docs/04-trade-calculator.md`: replace the Step 2 / response-shape sections with the credit framing, correct the now-wrong description of `valueAdjustment` as "total linear value difference between sides," and add the worked example. Update `docs/05-ui-spec.md` for the new row and disclosure. Per CLAUDE.md, docs ship in the same commit.

### Out of scope

Position scarcity, TE-premium interaction with the adjustment, and any change to the 1–100 value scale. Don't touch vote math, stat ingestion, or anything under `server/src/services/`.

<!-- ==================== END PROMPT — stop pasting here ==================== -->

---

## ROUTING (for Aven — do not paste)

Your agents' edit permissions split this task across three of them:

| File | Agent that can edit it |
|---|---|
| `shared/src/types.ts` | **build** only |
| `shared/src/value.ts`, `value.test.ts`, `docs/04-*` | **trade-calculator** |
| `client/**`, `docs/05-*` | **ui** |

**Send it to `build`.** It's the only agent that can edit `shared/src/types.ts`, and it can dispatch to `trade-calculator` and `ui`. Append this line to the prompt:

> Do the `shared/src/types.ts` change yourself first, then dispatch the algorithm + tests + docs/04 work to trade-calculator, then the client work to ui. Do not edit their files directly.

If build's dispatching gets unreliable, run it manually in three passes in that order — types first, then trade-calculator, then ui — since the later passes depend on the response shape landing first.

Skip `plan`. The spec above already is the plan; a planning pass on a free flash model will mostly restate it and risks softening the "algebraically identical" constraint, which is the part that keeps this refactor safe.

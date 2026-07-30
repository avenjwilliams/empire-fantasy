# Prompt: suggest assets that would even a lopsided trade

**Paste into opencode: everything from `## TASK` down to the END PROMPT marker, plus the dispatch line quoted in ROUTING. Do not paste the ROUTING section itself — it's for you, not the agent.**

---

## TASK

When a trade is lopsided, offer three concrete assets that would even it out, and let the user add one with a click. Modeled on Keep Trade Cut's "Players to Even Trade" panel. **Read the whole brief before editing** — the selection algorithm is the part that's easy to get subtly wrong, and it's specified precisely for that reason.

### What exists today

`evaluateTrade` already computes the target number. `computeAdviceGap(diff, losingAssetCount)` divides the value gap by the next open slot's depth weight and returns the raw value a single added asset would need. `Calculator.tsx` renders it as flat text: *"To even it, add a ~54-value player to the losing side."*

This task turns that number into three named, clickable assets. Do not change `computeAdviceGap` or what `adviceGap` means — it stays in the response exactly as-is.

---

### The trap: do not filter candidates by value

The obvious implementation is `SELECT ... WHERE value BETWEEN adviceGap * 0.9 AND adviceGap * 1.1`. **That is wrong in this codebase.**

Since the value-adjustment refactor, a side's total is `rawSum + adjustment`, where the adjustment derives from the *difference in depth penalties between the two sides*. Adding an asset to the losing side changes that side's piece count, which changes its depth penalty, which changes **both** sides' adjustment. The arithmetic is not additive, so an asset whose raw value equals `adviceGap` does **not** land the trade on Fair.

KTC's own panel shows this: against a stated target of 6458 their suggestions are 7030, 6820, 6360, and 6353 — spread around the target, not clustered on it.

**So: simulate, don't filter.** For each candidate asset, construct the hypothetical trade with that asset appended to the losing side, run the real `evaluateTrade` on it, and score the candidate by the resulting `|lean|`. This is exact by construction and immune to future changes in the trade math. Cost is trivial — a few hundred candidates of pure arithmetic, no extra queries once the values are loaded.

Use `adviceGap` only to pre-narrow the candidate pool for performance (e.g. assets within ±40% of it), never as the final ranking. If the pool comes back with fewer than ~20 candidates, widen it rather than returning a short list.

---

### Selection: position-diverse, best fit per position

Ranking purely by `|lean|` tends to return three near-identical WRs. Instead:

1. Simulate every candidate. Discard any that makes the trade *worse* (i.e. `|lean_after| >= |lean_before|`) — adding an asset that widens the gap is never a suggestion.
2. Group survivors by position (`QB`, `RB`, `WR`, `TE`, and treat `PICK` as its own group).
3. Take the single best candidate (lowest `|lean_after|`) from each group.
4. Sort those group-winners by `|lean_after|` ascending and return the top **3**.
5. If fewer than 3 groups produced a candidate, backfill from the remaining pool by `|lean_after|` — better to show three suggestions from two positions than to show two.

Return them sorted by `|lean_after|` ascending, so the closest fit is first.

### Eligibility

- Exclude any asset already on either side of the trade.
- Exclude assets with no `asset_values` row for the current league type.
- Rookie picks are eligible in `DYN_*` league types and **must never be suggested in `RED_*`** — CLAUDE.md hard rule 5. The existing endpoint already rejects picks in Redraft; the suggestion path needs the same guard, and it's a separate code path so it won't inherit it for free.
- Suggestions always go to the side that is **receiving less** (the losing side), which is the side `adviceGap` already refers to.
- Return no suggestions when the verdict is `Fair trade`. Nothing to fix.

---

### API

Extend the existing `POST /api/trade/evaluate` response rather than adding an endpoint — the client already calls this on every change and a second round-trip would make the panel lag behind the chips.

Add to `TradeResult` in `shared/src/types.ts`:

```ts
export interface TradeSuggestion {
  id: number;
  name: string;
  position: Position | 'PICK';
  team: string | null;
  value: number;
  /** Which side this asset should be added to. */
  side: 1 | 2;
  /** |lean| after adding this asset — lower is a closer fit. */
  resultingLean: number;
  /** Verdict this asset would produce. */
  resultingVerdict: string;
}
```

and on `TradeResult`:

```ts
/** Up to 3 assets that would move the trade toward Fair, closest fit first.
 *  Empty when the verdict is already Fair trade. */
suggestions: TradeSuggestion[];
```

`suggestions` is always present — an empty array, never `null` or absent — so the client needs no optional handling.

The candidate load is one query per evaluate call: all assets with a value for this league type, joined to name/position/team, excluding the ids already in the trade. Cache nothing; correctness over cleverness at this scale. If the query turns out to be slow, say so rather than adding a cache.

### Allow one empty side

`POST /api/trade/evaluate` currently returns 400 when either side is empty:

```ts
if (team1.length === 0 || team2.length === 0) {
  res.status(400).json({ error: 'Both teams need at least one asset' });
```

Relax this to reject only when **both** sides are empty. Dropping in one player and immediately seeing what it takes to match him is the most natural first interaction, and it's what the KTC reference does.

Before relaxing it, verify `evaluateTrade` handles a zero-asset side:

- `computeSideBreakdown([])` must return `rawSum: 0, weightedSum: 0, depthPenalty: 0`.
- `lean = diff / Math.max(total, 1)` — the `Math.max` guard already prevents division by zero, but confirm the resulting `scale` clamps sanely rather than reading as a false Landslide when both sides are empty (that case is still a 400, so it shouldn't arise).
- `computeAdviceGap` is called with `losingAssetCount = 0`, so `getWeight(0)` = 1.0. Correct, but add a test pinning it.

Do not change any existing validation other than this one condition. Max-per-side, duplicate-asset, unknown-league-type, and picks-in-Redraft all stay exactly as they are.

---

### UI (`client/src/pages/Calculator.tsx`, `client/src/theme.css`)

Below the trade scale and the existing difference/advice line, render a **"Players to Even Trade"** panel when `suggestions.length > 0`:

- Header label styled like the existing section headings.
- One row per suggestion: name, position badge (reuse the existing `.pos-badge--{POS}` classes), team, value, and a **+ button** on the right.
- Clicking **+** adds that asset to the indicated side, exactly as if it had been picked from `AssetSearch` — same state update path, so the trade re-evaluates and the panel refreshes with new suggestions. Do not duplicate the add logic; reuse the handler `AssetSearch`'s `onSelect` already feeds.
- Show which side it's for. With both sides populated it's ambiguous otherwise — a small `→ Team 2` marker on the row, or a panel subheading, either is fine.
- Keep the existing `adviceGap` text line above the panel. The number and the concrete suggestions complement each other.
- Retro terminal theme only (`docs/05-ui-spec.md`). No new colors outside the existing palette, no rounded-card look borrowed from the KTC screenshot — this is a layout borrow, not a visual restyle.
- Values render with `.toFixed(1)`, consistent with the rest of the app, and are now up to 6 characters (`999.9`) — size the column accordingly.

Empty and edge states:

- `Fair trade` → no panel at all, not an empty panel with a "nothing to suggest" message.
- Verdict is lopsided but **no** candidate improves it (possible on an extreme landslide where even the top asset falls short) → render the panel with a single muted line: *"No single asset can even this trade."* Do not silently hide the panel; the user needs to know the difference between "nothing fits" and "not computed."

---

### Tests (`shared/src/value.test.ts`)

All existing tests must keep passing unchanged. Add:

1. **Suggestions actually improve the trade.** For a lopsided fixture, every returned suggestion must produce `|lean_after| < |lean_before|`.
2. **Closest-first ordering.** `resultingLean` is non-decreasing across the returned array.
3. **Position diversity.** Given a candidate pool with strong fits at multiple positions, the three results span at least two positions.
4. **Fair trades return `[]`.**
5. **Exclusion.** An asset already on either side never appears in `suggestions`.
6. **Value-filtering would be wrong — pin it.** Construct a 1-for-2 fixture where the best-fitting asset's raw value differs from `adviceGap` by more than 5%, and assert the top suggestion is the simulated best rather than the one nearest `adviceGap`. This is the regression guard for the trap described above; without it, someone will "optimize" the simulation into a range query.
7. **Empty side.** `evaluateTrade` with `team2: []` returns `rawSum: 0`, `depthPenalty: 0` for side 2, a finite `lean`, and a populated `suggestions` array.
8. **No picks in Redraft.** A `RED_*` league type never yields a `PICK` suggestion even when picks exist in the candidate pool.

---

### Verification

- `npm test` green.
- Manual, matching the KTC reference: select Superflex Dynasty, add Tetairoa McMillan to Team 1 alone, leave Team 2 empty. The panel should suggest three assets whose values sit near McMillan's, spanning at least two positions.
- Click a **+** and confirm the asset lands on the correct side, the scale moves toward Fair, and the panel recomputes rather than going stale.
- Add pieces until the trade is Fair and confirm the panel disappears.
- Switch to a `RED_*` league type with picks in the pool and confirm no pick is ever suggested.
- Check a lopsided trade where the losing side already has 7+ assets — the depth weight at that slot is the 0.3 floor, so `adviceGap` will be large; confirm the panel either suggests something sane or shows the "no single asset" line rather than returning garbage.

### Docs

- `docs/04-trade-calculator.md` — document the suggestion algorithm, emphasizing that candidates are **simulated, not value-filtered**, and why (the adjustment is a function of both sides' piece counts). Document the new `suggestions` field and `TradeSuggestion` shape.
- `docs/01-architecture.md` — the updated `POST /api/trade/evaluate` response shape and the relaxed empty-side validation.
- `docs/05-ui-spec.md` — the new panel, the + affordance, and both empty states.
- `docs/06-roadmap.md` — add **"Multi-asset trade suggestions"** to Deferred: suggest 2-asset packages when no single asset can close the gap.

### Out of scope

Do not change `computeAdviceGap`, the depth weights, `TRADE_CONSTANTS`, the bands, or the verdict logic. Do not touch vote math, stat ingestion, or anything under `server/src/services/`. No multi-asset packages. No caching layer.

<!-- ==================== END PROMPT — stop pasting here ==================== -->

---

## ROUTING (for Aven — do not paste)

Three domains, and one file only `build` can touch:

| Work | File(s) | Agent |
|---|---|---|
| `TradeSuggestion` + `TradeResult.suggestions` | `shared/src/types.ts` | **build** only |
| Simulation + selection, empty-side validation, candidate query, docs/04 | `shared/src/value.ts` (trade section), `server/src/routes/trade.ts`, `shared/src/value.test.ts`, `docs/04` | **trade-calculator** |
| Panel, + button, styles, docs/05 | `client/**` | **ui** |
| `docs/01`, `docs/06` | — | **build** or **documentation** |

**Send it to `build`.** Same reason as the value-adjustment prompt — `shared/src/types.ts` is in no domain agent's allow-list. Append:

> Do the shared/src/types.ts additions yourself first, plus docs/01 and docs/06. Then dispatch the simulation, selection, candidate query, empty-side validation, tests and docs/04 to trade-calculator. Then the panel and styling to ui. Do not edit their files directly.

Order matters: the response shape must land before `ui` can render against it, and before `trade-calculator` writes tests that reference `TradeSuggestion`.

**One boundary question to expect.** `trade-calculator`'s own instructions say it is "pure and stateless" and must "never write to `adjustment_log` or touch `server/src/services/*`." The candidate query is a **read** in `routes/trade.ts`, which is in its allow-list, so this is within scope — but a literal-minded agent may stop and refuse. If it does, tell it the read is fine and that only writes and the services layer are off-limits. Don't let it push the query into `build`; that would split the algorithm across two agents.

**Watch for the value-filter shortcut.** The single most likely failure is the agent replacing the simulation with a `WHERE value BETWEEN ...` range query, because that's the obvious way to write this feature and it looks correct. Test 6 exists specifically to catch it. If the diff contains a value-range query used for final ranking rather than pool-narrowing, reject it.

Given the `rankings` model concerns from earlier, consider bumping `trade-calculator` off `north-mini-code-free` before running this — the simulation loop plus the non-additive-math reasoning is exactly the kind of task where the cheap model produced the hardcoded-`N` class of bug. `build` already has `nemotron-3-ultra-free` available.

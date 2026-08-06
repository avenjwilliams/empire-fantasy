# Prompt: boom/bust comparison in the trade calculator

**Paste into opencode: everything from `## TASK` down to the END PROMPT marker, plus the dispatch line quoted in ROUTING. Do not paste the ROUTING section itself — it's for you, not the agent.**

---

## TASK

Show each side's average boom and bust rating in the trade calculator, so a user can see the volatility profile they're giving up versus the one they're taking on.

**Read the whole brief before editing.** The first section is the one that matters most — this feature is display-only, and the single worst outcome is it leaking into the trade verdict.

---

### Boom/bust must not change the verdict. At all.

`evaluateTrade` currently produces `scale`, `verdict`, `verdictLabel`, `diff`, `lean`, `differencePct`, `adviceGap`, `valueAdjustment`, and `valueAdjustmentSide`. **Every one of those must be bit-for-bit identical before and after this change**, for every possible input.

Boom/bust is a *descriptive* overlay on a trade, not an input to whether the trade is fair. A high-boom package is not worth more — that's the entire point of showing boom and bust separately from value. Concretely:

- Do not add boom/bust to `computeSideBreakdown`, `computeValueAdjustment`, `computeSideValue`, `rawSum`, `weightedSum`, `sideValue`, or `adjustment`.
- Do not modify `TRADE_CONSTANTS`, the depth weights, the bands, or `getVerdict`.
- Do not let boom/bust influence `computeTradeSuggestions` ranking. Suggestions are still selected purely by simulated `|lean|`.
- The new averages are computed **alongside** the existing math, from the same inputs, and attached to the result object. They read; they never feed back.

Test 1 below pins this. If the diff changes any existing number, it's wrong.

---

### The math (`shared/src/value.ts`, Trade Calculator section)

Add a new exported function in the Trade Calculator section:

```ts
export interface SideBoomBust {
  /** Value-weighted mean boom %, 0–100, integer. Null when no rated asset on this side. */
  boom: number | null;
  /** Value-weighted mean bust %, 0–100, integer. Null when no rated asset on this side. */
  bust: number | null;
  /** How many assets on this side contributed to the average. */
  ratedCount: number;
  /** How many assets on this side were excluded for having no rating (picks, ungenerated players). */
  unratedCount: number;
}

export function computeSideBoomBust(
  assets: { value: number; boom_pct: number | null; bust_pct: number | null }[]
): SideBoomBust
```

**Value-weighted mean**, computed over rated assets only:

```
boom = Σ(value_i × boom_pct_i) / Σ(value_i)
```

for every asset where `boom_pct` is non-null. Same shape for bust, over assets where `bust_pct` is non-null (treat the two independently — in practice they're always both set or both null, but don't assume it).

Details that matter:

- **The weight is the raw `value`, not the depth weight.** `getWeight(i)` is trade-math machinery for modeling roster scarcity; using it here would couple this overlay to the verdict pipeline and would make a side's boom number change based on how many *other* pieces are in the trade. Weight by raw value only.
- **Exclude unrated assets from both the numerator and the denominator.** Picks are always unrated. Players may be unrated if `scripts/generate-boom-bust.ts` hasn't covered them. An excluded asset must not be silently treated as `0`, and must not shrink the result by staying in the denominator.
- **Round to an integer** with `Math.round`. These are integer percentages, matching the `players.boom_pct` column. Do **not** use `clampRound` or `round1` — those belong to the 1.0–1000.0 value scale and have no business here.
- Return `boom: null, bust: null` when `ratedCount === 0`. That covers an empty side, an all-picks side, and a side of ungenerated players. Do not return `0` — zero is a real boom rating and means something different from "unknown."
- `Σ(value_i)` over rated assets is guaranteed ≥ 1.0 when `ratedCount > 0` (values are clamped to ≥ 1.0), so no divide-by-zero guard is needed beyond the `ratedCount === 0` branch. Add a comment saying so.

Wire it into `evaluateTrade`: extend `EvaluateTradeInput`'s per-asset shape with **optional** `boom_pct?: number | null` and `bust_pct?: number | null`, compute a `SideBoomBust` for each side, and attach both to the returned object.

**The optionality is load-bearing.** `computeTradeSuggestions` builds hypothetical trades and calls `evaluateTrade` on them; its candidate objects do not carry boom/bust. Making these fields required would break that call site. Optional fields mean the simulation path keeps working untouched and simply produces `null` averages it never reads. Do not add boom/bust plumbing to `computeTradeSuggestions`.

---

### Types (`shared/src/types.ts`)

Add to `TradeResult`:

```ts
/** Value-weighted average boom/bust for each side. Descriptive only —
 *  never an input to scale, verdict, lean, or suggestions. */
boomBust: {
  team1: SideBoomBust;
  team2: SideBoomBust;
};
```

`boomBust` is **always present** — both sides always return an object, with `null` numbers where there's nothing to average. Never `null` or absent at the top level, so the client needs no optional handling.

Export `SideBoomBust` from wherever it ends up so both sides can import it. Keep the `boom_pct` / `bust_pct` snake_case convention already established on `Player`.

---

### Server (`server/src/routes/trade.ts`)

In `fetchAssets`, add to the SELECT:

```sql
CASE WHEN a.kind = 'player' THEN p.boom_pct ELSE NULL END as boom_pct,
CASE WHEN a.kind = 'player' THEN p.bust_pct ELSE NULL END as bust_pct,
```

so the fields flow into `evaluateTrade`. This is a read, joined to a table already in the query — no new query, no extra round-trip.

Do **not** add boom/bust to the candidate query that feeds `computeTradeSuggestions`. It doesn't need them and that query already runs over every asset in the league type.

Change nothing else in this file. All existing validation stays exactly as it is.

---

### UI (`client/src/pages/Calculator.tsx`, `client/src/theme.css`)

Add a **"Boom / Bust Profile"** panel inside `.calc-result`, positioned **after `calc-result__details` and before the "Players to Even Trade" suggestions panel**. It describes the trade as constructed, so it belongs with the verdict, above the prescriptive suggestions.

Layout — side by side, with the comparison called out:

```
              BOOM      BUST
  TEAM 1       41%       28%
  TEAM 2       53%       19%
  ─────────────────────────────
  Team 2 gets +12 boom, −9 bust
```

- Team 1 and Team 2 rows, each with a boom and a bust figure, aligned in columns so they read as a direct comparison.
- Below them, a delta line. Compute `boomDelta = team2.boom − team1.boom` and the same for bust, and phrase it in terms of the side receiving more boom: *"Team 2 gets +12 boom, −9 bust."* Use the existing `.delta--pos` / `.delta--neg` color tokens on the signed numbers.
- Render the delta line **only when both sides have a non-null value** for that metric. If one side is unrated, there's no comparison to draw — show the available side's numbers and omit the delta rather than comparing against nothing.
- Boom figures in `var(--positive)`, bust in `var(--negative)`, monospace, matching the density of the surrounding result panel. **No new colors.**
- Null renders as a muted `—`.

**Coverage note (required).** When a side has `unratedCount > 0`, render a small muted line beneath that side's row: *"excludes 2 unrated"* (or *"excludes 1 unrated"*). This is not optional polish — in Dynasty, a package of one player plus three picks would otherwise show a confident-looking average that describes a single asset. The user needs to see the average's coverage.

**States:**

- Both sides rated → full panel with delta line.
- One side entirely unrated (empty side, or all picks) → that side's row shows `—`, delta line omitted, coverage note still shown on the side that has exclusions.
- Neither side has a single rated asset → omit the whole panel. Nothing to say.

Retro terminal theme only, per `docs/05-ui-spec.md`. Square corners, monospace, no gradients, no animation. New classes go in `theme.css` near the existing `.calc-result` / `.suggestions-panel` block, following the same BEM-ish naming (e.g. `.boom-bust-compare`, `.boom-bust-compare__row`, `.boom-bust-compare__delta`). Add a responsive rule in the existing `@media` block so the panel stacks rather than squashes on mobile, consistent with how `.calc-result__details` already adapts.

Do not reuse the `.boom-bust` track markup from `PlayerDetail.tsx` — that block belongs to the profile page and the result panel is already tall. Do not modify it.

---

### Tests (`shared/src/value.test.ts`)

All existing tests must pass **unchanged**. Add:

1. **The verdict is untouched.** For a set of fixtures spanning Fair / Slight edge / Clear win / Landslide, assert that `scale`, `verdict`, `differencePct`, `adviceGap`, `valueAdjustment`, and `valueAdjustmentSide` are identical whether or not `boom_pct` / `bust_pct` are supplied on the input assets. This is the primary regression guard for this whole task.
2. **Weighting is by value, not count.** A side of `{value: 900, boom: 20}` and `{value: 100, boom: 80}` returns boom `26`, not the plain mean of `50`.
3. **Unrated assets are excluded, not zeroed.** A side of `{value: 500, boom: 40}` and `{value: 500, boom: null}` returns boom `40` with `ratedCount: 1, unratedCount: 1`. Assert it is not `20`.
4. **All-unrated side returns null.** A side of only picks returns `boom: null, bust: null, ratedCount: 0`, and specifically not `0`.
5. **Empty side.** `team2: []` returns a well-formed `SideBoomBust` with nulls and zero counts, and `evaluateTrade` still returns a finite `lean`.
6. **Suggestions are unaffected.** For a lopsided fixture, the returned `suggestions` array is identical with and without boom/bust on the input — same ids, same order. Guards against boom/bust leaking into candidate ranking.
7. **Integer output.** Averages are integers; assert `Number.isInteger` on a fixture whose weighted mean is fractional.
8. **Independent metrics.** A fixture where boom and bust sum above 100 computes both averages correctly and independently.

---

### Verification

- `npm test` green.
- Build a known trade, note `scale` and `verdict`, then confirm they're unchanged from before this feature.
- Superflex Dynasty: one player for three picks. Confirm the pick side shows `—` with no delta line, and the player side shows its numbers.
- A Dynasty trade of two players plus one pick per side: confirm each side's coverage note reads "excludes 1 unrated" and the averages reflect only the players.
- A 1-for-1 of two rated players: both averages equal those players' raw ratings exactly, and the delta is their difference.
- Drop one player on Team 1 with Team 2 empty (the relaxed-validation case): panel shows Team 1's numbers, Team 2 shows `—`, no delta, no crash.
- Add a very high-value low-boom player alongside a low-value high-boom player and confirm the average sits near the high-value player's rating, not midway.
- `UPDATE players SET boom_pct = NULL, bust_pct = NULL WHERE id = <one player>`, put him in a trade, confirm he's excluded and counted in the coverage note.
- Check the result panel at mobile width.

---

### Docs

- `docs/04-trade-calculator.md` — the value-weighted averaging formula, that weighting uses raw value rather than depth weights and why, the exclusion rule for unrated assets, and an explicit statement that **boom/bust never affects scale, verdict, or suggestions**.
- `docs/01-architecture.md` — the `boomBust` field on the `POST /api/trade/evaluate` response and the `SideBoomBust` shape.
- `docs/05-ui-spec.md` — the panel, its position in the result stack, the delta line, the coverage note, and all three states.
- `docs/06-roadmap.md` — add to Deferred: **"Boom/bust-aware trade advice"** — e.g. flagging when a contending roster is trading away floor for ceiling. Note that this would be the first place boom/bust influences anything prescriptive, and that it must remain separate from the value verdict.

Repeat in `docs/04` that the underlying numbers are **random placeholders** until the real computation lands.

---

### Out of scope

Do not modify the Vote Math or Stat Ingestion sections of `shared/src/value.ts`, anything under `server/src/services/`, `adjustment_log`, migration 005, `scripts/generate-boom-bust.ts`, `PlayerDetail.tsx`, the `.boom-bust` CSS block, the Rankings page, or the KTC page. Do not add boom/bust to the suggestions algorithm, the trade scale, or the verdict bands. No new dependencies.

<!-- ==================== END PROMPT — stop pasting here ==================== -->

---

## ROUTING (for Aven — do not paste)

Three domains, and one file only `build` can touch:

| Work | File(s) | Agent |
|---|---|---|
| `SideBoomBust`, `TradeResult.boomBust` | `shared/src/types.ts` | **build** only |
| `docs/01`, `docs/06` | — | **build** or **documentation** |
| `computeSideBoomBust`, `evaluateTrade` wiring, `fetchAssets` SELECT, tests, `docs/04` | `shared/src/value.ts` (trade section), `server/src/routes/trade.ts`, `shared/src/value.test.ts`, `docs/04` | **trade-calculator** |
| Comparison panel, CSS, `docs/05` | `client/**` | **ui** |

**Send it to `build`.** Append:

> Do the shared/src/types.ts additions yourself first, plus docs/01 and docs/06. Then dispatch the math, evaluateTrade wiring, the trade route SELECT, tests and docs/04 to trade-calculator. Then the comparison panel and styling to ui. Do not edit their files directly.

Order matters — `SideBoomBust` must exist before `trade-calculator` writes against it and before `ui` renders it.

**The failure to watch for is verdict contamination.** Averaging boom/bust into the trade evaluation is a natural-feeling thing to write — the function is right there, it already sums and weights per side, and "just add it to the side value" looks like the obvious integration. It would be silently wrong: the trade would start calling high-variance packages more valuable, which is the opposite of what this feature is for. Test 1 exists to catch it. If the diff touches `computeSideBreakdown`, `computeValueAdjustment`, `sideValue`, `rawSum`, or `getVerdict`, reject it outright.

**Second: depth-weight reuse.** `getWeight(i)` is sitting right there in the same function and looks like the natural weight. It isn't — it would make Team 1's boom number change when you add a piece to Team 2, which is indefensible for a descriptive stat. Weight by raw value.

**Third: breaking `computeTradeSuggestions`.** The suggestions simulator calls `evaluateTrade` with candidate objects that have no boom/bust fields. If the agent makes `boom_pct` / `bust_pct` required on `EvaluateTradeInput`, TypeScript will fail there and the likely "fix" is to thread boom/bust through the whole suggestions path — a lot of pointless churn in the most delicate code in the repo. The brief specifies optional fields; hold it to that. Test 6 checks suggestions came out identical.

**Fourth: null-as-zero.** Zero boom is a real, meaningful rating. An unrated pick is not a 0% boom player. Tests 3 and 4 cover both directions.

**`trade-calculator` is now on `nemotron-3-ultra-free`** after the earlier config fix, which is the right call here — this task is less algorithmically hairy than the suggestions simulator, but the "add a feature to a function without perturbing any of its existing outputs" discipline is exactly what the cheap model was bad at.

**Boundary question to expect.** `trade-calculator`'s brief says it is "pure and stateless" and must "never write to `adjustment_log` or touch `server/src/services/*`." Adding two columns to a SELECT in `routes/trade.ts` is a read in a file that's in its allow-list, so it's in scope — same call as the candidate query in the suggestions task. If it balks, tell it reads are fine.

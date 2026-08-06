# Prompt: fix inverted trade direction (verdict label + scale sign)

**Paste into opencode: everything from `## TASK` down to the END PROMPT marker. Do not paste the ROUTING section — it's for you, not the agent.**

---

## TASK

The trade calculator names the wrong winner. Fix the direction convention in `evaluateTrade`.

### The bug

Reproduce: Team 1 = Jameson Williams (509.3), Team 2 = James Cook (758.2).

Rendered result: **"LANDSLIDE — TEAM 1"**, with the scale needle at −59, sitting left of center in the green zone.

Team 2 is receiving 758.2 against Team 1's 509.3. Team 2 won the trade. The label names Team 1 and the needle points at Team 1.

### Root cause

A side's asset list is **what that team receives**. This is the documented convention — `docs/04-trade-calculator.md` line 146 reads "Team 1 receives: **Tetairoa McMillan 737.0**". So the side with the **higher** total is the side that got the better haul, and is the side the trade favors.

Four places in `shared/src/value.ts` key off trade direction. Two follow that convention correctly, two invert it:

**Correct — do not touch:**

- `adviceGap`: `const losingCount = diff > 0 ? team2.length : team1.length;` — treats the lower-total side as losing. Right. (Verified against the repro: it correctly told Team 1, the side with 509.3, to add ~277.)
- `computeTradeSuggestions`: `const losingSide = diff > 0 ? 2 : 1;` — same, right. Its adjacent comment is worded confusingly but the logic is correct.

**Inverted — fix both:**

1. `verdictLabel`:
   ```ts
   : `${verdict} — Team ${diff > 0 ? '2' : '1'}`;
   ```
   `diff = side1.sideValue − side2.sideValue`. When `diff > 0`, Team 1 received more and the trade favors **Team 1** — but this names Team 2. The ternary is backwards.

2. The `scale` sign. `scale = round(lean * 300)` where `lean = diff / max(total, 1)`. With `diff > 0` (Team 1 favored) this yields a **positive** scale, but the stated convention in the function's docblock and in `TradeScale.tsx` is "negative favors Team 1, positive favors Team 2." The magnitude is right; the sign is inverted.

These two are why the label and the needle agree with each other and both disagree with reality.

### The fix

Keep the **stated** convention — negative scale favors Team 1, positive favors Team 2 — and correct the computation to match it.

- Fix the `verdictLabel` ternary to `diff > 0 ? '1' : '2'`.
- Negate at the single point where `scale` is produced, e.g. `Math.round(-lean * TRADE_CONSTANTS.SCALE_MULTIPLIER)`, leaving the clamp as-is.

**Do not change `diff` or `lean` themselves.** `adviceGap` and `computeTradeSuggestions` both read them and both are already correct; flipping them at the source would break two working things to fix two broken ones. Negate only where `scale` is computed.

Confirm `getVerdict(lean)` bands on magnitude (`Math.abs`) rather than signed value. If it does, it needs no change — the verdict *word* is direction-free. If it doesn't, say so before changing anything.

Nothing else moves: `differencePct` is already absolute, `valueAdjustment` / `valueAdjustmentSide` derive from depth penalties and are direction-independent, and `computeTradeSuggestions` reads `Math.abs(hypoResult.scale)` so a sign flip cannot reach it.

### Tests (`shared/src/value.test.ts`)

Two existing tests pin the inverted sign and must flip. **These are the only two existing assertions that may change** — if anything else fails, stop and report it rather than adjusting it.

1. `invariant 2: one 950 vs three 550s favors the three 550s side in linear mode` — Team 2 receives 1485 weighted against Team 1's 950, so Team 2 is favored and `scale` must now be **positive**. Change `toBeLessThan(0)` to `toBeGreaterThan(0)` and correct the inline comment, which currently reads "Team 1 gives less value, so Team 2 favored" — under the receives convention Team 1 *receives* less.
2. The two-700s-vs-one-700 test asserting `expect(result.scale).toBeGreaterThan(0)` with comment "Team 1 gives more total value → favors Team 2" — Team 1 receives 1400 against 700, so Team 1 is favored. Must become `toBeLessThan(0)` with a corrected comment.

`invariant 3` (swap sides, sign flips exactly) is unaffected by a global sign flip and must keep passing untouched. Same for the clamp test, the throw-in test, and every verdict-band test that strips the `" — Team X"` suffix.

Add three new tests:

3. **The repro.** Team 1 `[509.3]`, Team 2 `[758.2]` → `verdict` ends with `"Team 2"`, and `scale > 0`.
4. **Mirror of the repro.** Team 1 `[758.2]`, Team 2 `[509.3]` → ends with `"Team 1"`, `scale < 0`.
5. **Label and sign never disagree.** Across a set of lopsided fixtures, assert that a verdict naming Team 1 always carries `scale < 0` and one naming Team 2 always carries `scale > 0`. This is the invariant whose absence let the bug ship.

### Docs

- `docs/04-trade-calculator.md` — line 48 currently reads `diff = sideTotal1 − sideTotal2  # >0 means Team 1 gives more, i.e. trade favors Team 2`. Under the receives convention `diff > 0` means Team 1 *receives* more and the trade favors Team 1. Correct that line, and line 53's scale-direction description. State the receives convention explicitly and early in the doc — its absence is what allowed two readings to coexist.
- Add the label/sign agreement invariant to the invariants list in that doc.

### Out of scope

Do not touch `adviceGap`, `computeAdviceGap`, `computeTradeSuggestions`, `computeValueAdjustment`, `computeSideBreakdown`, `TRADE_CONSTANTS`, the bands, the boom/bust overlay, or anything outside the Trade Calculator section of `shared/src/value.ts`. Do not retune any constant. The magnitudes in this bug are all correct — only two signs are wrong.

<!-- ==================== END PROMPT — stop pasting here ==================== -->

---

## ROUTING (for Aven — do not paste)

**Send it to `trade-calculator`.** Everything is in its allow-list: `shared/src/value.ts` (Trade Calculator section), `shared/src/value.test.ts`, `docs/04-trade-calculator.md`. No `shared/src/types.ts` change, so no `build` hop needed.

**Then a small follow-up to `ui`,** which `trade-calculator` cannot reach:

> In client/src/components/TradeScale.tsx, the comment "// scale: negative favors Team 1, positive favors Team 2" is now accurate — the computation was corrected to match it. Leave the needle formula alone. In docs/05-ui-spec.md line 30, add to the trade scale description that the needle points toward the favored side, and that a side's asset list is what that team RECEIVES.

No code change on the client — flipping the sign in `value.ts` flips the needle for free, because `needlePos` is a pure function of `scale`.

**Why the needle was wrong too, in case it's questioned:** the track is green on the left, red on the right, which reads from Team 1's perspective. In the repro the needle sat far left in the green while the verdict text rendered in red LANDSLIDE — a coherent view is impossible while the sign is inverted. After the fix, Team 2 winning puts the needle right, in the red.

**Watch for over-correction.** The tempting fix is to flip `diff` or `lean` at the source, since that's one edit instead of two. It would silently break `adviceGap` and `computeTradeSuggestions`, which currently read those values and are correct — you'd swap two visible bugs for two harder-to-see ones. The brief says negate only at `scale`; hold it there. If the diff touches the `diff` or `lean` assignments, reject it.

**Watch for test-fixing by assertion-flipping.** Only the two named tests may change. A model that hits an unexpected failure and "fixes" it by inverting the assertion will quietly undo the repair. If any test outside those two is modified, reject the diff and read what actually failed.

**Worth knowing how this shipped.** The two correct sites and the two inverted sites were almost certainly written at different times against different mental models of what a side's box means, and nothing asserted they agreed. New test 5 is the guard. It's also worth asking whether the calculator's column headers should read "TEAM 1 RECEIVES" — the ambiguity is real in the UI, not just the code, and a label would remove it permanently. Separate task if you want it.

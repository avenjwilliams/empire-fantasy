# Prompt: KTC popup per-visit, readable league labels, prompt/selector league-type tie

**Paste into opencode: everything from `## TASK` down to the END PROMPT marker, plus the dispatch line in ROUTING. Do not paste the ROUTING section.**

---

## TASK

Three related fixes to the Keep/Trade/Cut flow. Read the whole brief before editing — they interact, and shipping 2 of 3 makes the UI worse than shipping none.

---

### Fix 1 — The popup must appear on every visit, not once ever

`client/src/components/KtcPopup.tsx` gates on `localStorage.getItem('ef_ktc_seen')` and sets that key permanently in `dismiss()`. Once a user closes it, the popup never returns on that browser. That is the bug.

- Switch the gate from `localStorage` to `sessionStorage` (same key name is fine). `sessionStorage` clears when the tab/browser session ends, which is the "every time I restart the website" behavior we want, while still not re-nagging on every client-side route change within one visit.
- Put the storage choice behind a single named constant at the top of the file (e.g. `const GATE_STORAGE: Storage = sessionStorage`) with a one-line comment explaining the alternative: dropping storage entirely and using in-component state would re-show the popup on every page reload, which is more aggressive.
- The popup stays **dismissible**. The X button and overlay click still close it. Do not make it blocking, do not trap focus, do not disable the close affordances.
- Note React 18 `StrictMode` double-invokes effects in dev — make sure the gate read is idempotent and doesn't cause a flash of two popups.

While you're in this file, fix two adjacent defects:

- **Missing refresh event.** `KeepTradeCut.tsx` dispatches `window.dispatchEvent(new CustomEvent('empire-refresh'))` after a successful vote; `KtcPopup.tsx` does not. So a vote cast in the popup leaves the Log and Rankings pages showing stale data, which reads to the user as "my vote did nothing." Add the same dispatch to the popup's submit handler.
- **Skip is a no-op.** The popup's Skip calls `dismiss()` while the page's Skip calls `fetchPrompt()` — but `generatePrompt` returns the existing unanswered prompt for the session before generating a new one, so re-fetching hands back the identical trio. Skip visibly does nothing. Make Skip mean "give me a different trio" in both places (see Fix 3 for the server half).

---

### Fix 2 — Human-readable league type labels

Right now the badge renders the raw code (`RED_1QB_HALF_TEP`). Nobody can parse that at a glance.

Add a formatter to `shared/src/leagueTypes.ts`, next to the existing `buildCode` / `parseCode`:

```ts
export function formatLeagueLabel(code: string): string
```

Mapping, joined with `", "`, in this order — **format, receiving, QB, then TE premium only if enabled**:

| Part | Value | Renders as |
|---|---|---|
| format | `DYN` | `DYNASTY` |
| format | `RED` | `REDRAFT` |
| rec | `PPR` | `PPR` |
| rec | `HALF` | `.5 PPR` |
| rec | `ZERO` | `NON-PPR` |
| qb | `1QB` | `1QB` |
| qb | `SF` | `SUPERFLEX` |
| tep | `TEP` | `TE PREMIUM` |
| tep | `STD` | *omitted entirely — no trailing comma, no "STANDARD"* |

Examples that must hold:

```
DYN_SF_PPR_STD    → "DYNASTY, PPR, SUPERFLEX"
RED_1QB_HALF_TEP  → "REDRAFT, .5 PPR, 1QB, TE PREMIUM"
DYN_1QB_ZERO_STD  → "DYNASTY, NON-PPR, 1QB"
RED_SF_HALF_STD   → "REDRAFT, .5 PPR, SUPERFLEX"
```

Build it on top of `parseCode` rather than string-splitting again. Return the raw `code` unchanged if `parseCode` returns null — never throw, never render "undefined" in the UI. Add unit tests to `shared/src/leagueTypes.test.ts` covering all four examples above plus the null-parse fallback.

Then replace the raw-code renders in the client with `formatLeagueLabel(...)`:

- `client/src/components/KtcPopup.tsx` — `.ktc-league-badge`
- `client/src/pages/KeepTradeCut.tsx` — `.ktc-league-badge`
- `client/src/pages/PlayerDetail.tsx` — `.value-card__code` and the log-table league column

The badge is now longer than it was, so widen `.ktc-league-badge` in `client/src/theme.css` and let it size to content — do not let it wrap mid-label or clip. Keep the existing retro terminal styling; this is a content change, not a restyle.

Leave the compact codes alone in the top-right `LeagueTypeSelector` toggles (DYN/RED, 1QB/SF, etc.) — those are working controls, not labels.

---

### Fix 3 — Tie the prompt's league type to the user's selection

This is the reason the labels matter. `generatePrompt` in `server/src/services/voteService.ts` currently picks a **weighted-random** league type:

```ts
const lt = weighted[Math.floor(Math.random() * weighted.length)];
```

It has no connection to the league type the user has selected in the header. So a user sitting on Redraft / 1QB / .5 PPR / Standard gets served a prompt for `RED_1QB_HALF_TEP` and their vote lands in a bucket they never chose and can't see in the Log. Once Fix 2 spells the label out in plain English, this mismatch goes from invisible to glaring — that's why these ship together.

**A vote should still affect exactly one league type.** We are not propagating across all 24.

The two surfaces deliberately behave differently, and this is the one design decision in this brief that is easy to "helpfully" get wrong — implement it exactly as written:

| Surface | League type | Why |
|---|---|---|
| `/ktc` page (`KeepTradeCut.tsx`) | **The user's header selection** | They navigated there deliberately; the badge must match the selector. |
| On-open popup (`KtcPopup.tsx`) | **Weighted-random, as today** | It fires before the user has touched anything. Tying it to the selection would funnel nearly all vote volume into the default `DYN_SF_PPR_STD` and leave the other 23 codes parked at seed values forever. |

So:

- `generatePrompt(db, sessionId, leagueTypeCode?: string)` — the argument is **optional**. When supplied, resolve it to a `league_types` row and use it; return `{ error, code: 400 }` if it doesn't resolve. When omitted, keep the existing weighted-random selection.
- **Keep `WEIGHTED_CODES` and the weighted-random block.** They are still live for the popup path. Do not delete them.
- `GET /api/ktc/prompt` in `server/src/routes/ktc.ts` reads an **optional** `leagueType` query param and forwards it. Present but unknown → 400 with a clear message. Absent → weighted-random, not an error and not a silent default.
- **Unanswered-prompt reuse depends on the path.** With a `leagueType` param, reuse only an unanswered prompt whose `league_type_id` matches — otherwise a user who switches types mid-session keeps getting handed the stale prompt from the previous type, which is the original bug in a new costume. With no param, reuse the session's most recent unanswered prompt regardless of type. Dangling unanswered prompts in other types are harmless and the popup will pick them up.
- Client: `KeepTradeCut.tsx` reads `code` from `useLeagueType()`, passes `?leagueType=${code}`, and adds `code` to the `fetchPrompt` dependency array so switching types in the header swaps the prompt. `KtcPopup.tsx` sends **no** `leagueType` param and does not depend on `code`.
- Because the popup's badge will legitimately not match the header selector, prefix the popup's badge with a short label — `Rating for:` — so it reads as a deliberate assignment rather than a bug. The `/ktc` page badge needs no such prefix.
- `isDynasty` (and therefore whether rookie picks can appear) derives from whichever type was chosen on that path. Verify that a `RED_*` type never yields a pick-based trio, per CLAUDE.md hard rule 5.

**Skip / reroll (the server half of Fix 1).** Add migration `003_ktc_prompt_skipped.sql` adding a nullable `skipped_at TEXT` column to `ktc_prompts`. Add `POST /api/ktc/skip` taking `{ promptId }`, which validates session ownership and stamps `skipped_at`. The unanswered-prompt query then requires `answered_at IS NULL AND skipped_at IS NULL`, so the next `GET /prompt` genuinely generates a fresh trio. Client Skip calls `/skip` then re-fetches. Do not edit an already-applied migration — new numbered file only.

**Do not touch** the Elo math, `VOTE_CONSTANTS`, the delta caps, or `applyVote`'s adjustment-log writes. `applyVote` already derives its league type from the stored prompt row, so it needs no change once prompts carry the right type.

One robustness fix in `applyVote` while you're there: `getValue()` does `row.value` with no null guard, so an asset missing an `asset_values` row for that league type throws an unhandled 500 mid-transaction. Return a clean 409/422 instead.

---

### Verification

- `npm test` green, including the new `leagueTypes.test.ts` cases.
- Manual: select Redraft / 1QB / .5 PPR / Standard in the header, go to `/ktc` → the badge reads `REDRAFT, .5 PPR, 1QB` (no TE-premium segment) and matches the selector exactly.
- Manual: vote from the `/ktc` page → three `reason='vote'` rows appear in the Log **under the currently selected league type**, without changing the Log's filter.
- Manual: reopen the popup several times across sessions → the league type varies, and each vote's log rows land under the type shown on the popup badge (which may require changing the Log filter to see — that is expected, not a bug).
- Manual: click Skip → a different trio appears.
- Manual: close the popup, fully quit and reopen the browser → popup returns.
- Manual: switch league type in the header while a prompt is on screen → the prompt reloads for the new type.

### Docs

Update `docs/03-scoring-adjustments.md` (document the two prompt paths — selector-bound on `/ktc`, weighted-random in the popup — plus the rationale for keeping the popup random, the new optional query param, and the skip flow), `docs/01-architecture.md` (the `/api/ktc/prompt` and `/api/ktc/skip` shapes, plus the `skipped_at` column), and `docs/05-ui-spec.md` (readable label format, per-session popup gate). Per CLAUDE.md, docs ship in the same commit.

<!-- ==================== END PROMPT — stop pasting here ==================== -->

---

## ROUTING (for Aven — do not paste)

This spans all three domains:

| Work | File(s) | Agent |
|---|---|---|
| `formatLeagueLabel` + tests | `shared/src/leagueTypes.ts`, `leagueTypes.test.ts` | **build** only |
| Prompt league-type tie, skip endpoint, migration 003, `getValue` guard | `server/src/services/voteService.ts`, `server/src/routes/ktc.ts`, `server/src/db/migrations/003_*.sql` | **rankings** |
| Popup gate, refresh event, label rendering, badge CSS | `client/**` | **ui** |

**Send it to `build`.** It's the only agent that can edit `shared/src/leagueTypes.ts` — that file is in no other agent's allow list. Append:

> Do the `shared/src/leagueTypes.ts` formatter and its tests yourself first. Then dispatch Fix 3's server work to rankings, and Fix 1 + the client half of Fix 2 to ui. Do not edit their files directly.

Order matters: the formatter must exist before `ui` imports it, and the `leagueType` query param must exist before `ui` starts sending it. If build's dispatching is unreliable, run three manual passes in that same order — build, rankings, ui.

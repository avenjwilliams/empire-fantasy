# Prompt: favorite-team color theming

**Paste into opencode: everything from `## TASK` down to the END PROMPT marker, plus the dispatch line quoted in ROUTING. Do not paste the ROUTING section itself — it's for you, not the agent.**

---

## TASK

Let a user pick a favorite NFL team on first visit, and recolor the app in that team's colors. The choice persists in `localStorage`, is changeable at any time from the topbar, and defaults to the current amber terminal theme if the user skips.

**Read the whole brief before editing.** The section "Colors that must not change" is the part that's easy to get wrong and will look fine in casual testing while being broken for roughly a third of the teams.

---

### What exists today

`client/src/theme.css` defines the whole visual system as CSS custom properties in `:root` (lines 5–21). Two of them, `--accent` (`#e8a525`) and `--accent-dim` (`#b07c15`), carry the entire brand identity — `--accent` alone is referenced 45 times.

`client/src/context/LeagueTypeContext.tsx` is the pattern to follow for persisted client state: read `localStorage` synchronously in an initializer, write it back in a `useEffect`, expose via a hook that throws if used outside its provider. `main.tsx` wraps `<App/>` in `LeagueTypeProvider`.

`client/src/components/KtcPopup.tsx` is the existing first-visit modal. It gates on `sessionStorage` under `ef_ktc_seen` — note the comment explaining why it is deliberately `sessionStorage` and not `localStorage`. Do not change that decision.

There are currently no test files anywhere under `client/`. This task adds the first one.

---

### Scope

Three CSS variable groups change per team:

| Group | Variables | Source |
|---|---|---|
| Accent | `--accent`, `--accent-dim`, `--accent-alt` (new) | team's three colors, contrast-checked |
| Surface | `--bg`, `--bg-raised`, `--bg-hover`, `--border` | base value tinted toward the team's darkest color |
| Semantic | `--ink`, `--ink-muted`, `--positive`, `--negative` | **never change — identical in all 33 themes** |

`--font-mono`, `--font-body`, and `--radius` also never change.

---

### Colors that must not change, and the bug that follows from ignoring it

`--positive` (green) and `--negative` (red) are not decoration. They encode meaning in at least six places: value deltas (`.delta--pos` / `.delta--neg`, ~line 626), boom/bust labels bars and values (~lines 550–574), trade-scale zones (~808–810), KTC card borders (~1155–1157), KTC role chips (~1180–1182), and the trade verdict ramp (~845–848). Leave all four semantic variables alone.

That is necessary but **not sufficient**, because two ramps currently use `--accent` as a middle step between green and red:

```css
.trade-verdict--fair      { color: var(--ink-muted); }
.trade-verdict--slight    { color: var(--accent); }
.trade-verdict--clear     { color: var(--accent); }
.trade-verdict--landslide { color: var(--negative); }
```

```css
.ktc-role--keep  { background: rgba(61,220,132,0.15); color: var(--positive); }
.ktc-role--trade { background: rgba(232,165,37,0.15); color: var(--accent); }
.ktc-role--cut   { background: rgba(255,82,82,0.15); color: var(--negative); }
```

Both are ordered severity scales — the verdict ramp is escalating trade imbalance (per `docs/04-trade-calculator.md`, "Fair trade → Slight edge → Clear win → Landslide" is magnitude, not which side is good), and KEEP/TRADE/CUT is a descending preference scale. Amber sits in the middle of each on purpose.

Now theme the app for Kansas City. `--accent` becomes red, so Slight edge, Clear win and Landslide all render the same red and the ramp collapses to two steps. Theme it for Philadelphia and TRADE renders green next to KEEP's green. Roughly a third of the league has a primary that is some shade of red or green, so this is the common case, not an edge case.

**Fix: decouple both ramps from `--accent` before theming anything.** Add a fixed mid-severity token to `:root` that no team theme is allowed to override:

```css
--severity-mid: #e8a525;   /* fixed amber — never themed; middle step of the
                              verdict and KTC ramps, must stay distinct from
                              --positive and --negative in every theme */
```

Point `.trade-verdict--slight`, `.trade-verdict--clear`, and `.ktc-role--trade` (both its `color` and its now-hardcoded `rgba(232,165,37,0.15)` background) at it. `.trade-verdict--slight` and `--clear` being currently identical is pre-existing and out of scope — keep them identical, just no longer accent-derived.

Then grep `theme.css` for any remaining `rgba(232,165,37` literal. A hardcoded copy of the old amber will not follow the theme and will look like a rendering bug once a team is selected.

---

### The palette data (`client/src/teamThemes.ts`, new file)

This is presentation data with no server consumer, so it lives in `client/`, not in `shared/`. Do not add it to `shared/src/constants.ts`.

```ts
export interface TeamTheme {
  code: string;      // 'KC'
  name: string;      // 'Kansas City Chiefs'
  primary: string;   // official primary, hex
  secondary: string; // official secondary, hex
  tertiary: string;  // official tertiary, hex
}
```

**All 32 teams, plus a `NONE` entry** whose three colors reproduce today's theme exactly (`#e8a525`, `#b07c15`, and a tertiary of your choosing that resolves back to the current surface values) and which is labeled "Classic" in the UI.

Build the list from a static hardcoded array of all 32 franchises. **Do not derive the team list from the database or from any API.** The `players.team` column currently holds only 29 distinct codes — `CLE`, `LAC` and `TEN` have no rostered players in the current rankings — so a DB-derived list would silently ship a 29-team picker. Use the same code convention the DB does (`GB`, `KC`, `LV`, `SF`, `TB`, `NE`, `NO`, `JAX`, `WAS`, `LAR`, and add `LAC`, `CLE`, `TEN`).

Use each franchise's official published colors. Getting a hex slightly wrong is a cosmetic issue Aven can correct in one line; the derivation and contrast rules below are what keep the app functional regardless.

---

### Derivation (`client/src/teamThemes.ts`)

Export pure functions, no DOM access, so they can be unit-tested in a node environment:

```ts
export function resolveTheme(t: TeamTheme): Record<string, string>
```

returning the CSS variable name → hex map for that team.

**Surface tinting.** Never use a raw team color as a background. Mix it into the existing base value so the result stays dark enough for `--ink` to remain readable:

```
tint = the darkest of the team's three colors by relative luminance
--bg        = mix(tint, #0a0e14, 0.12)
--bg-raised = mix(tint, #111720, 0.12)
--bg-hover  = mix(tint, #1a2030, 0.14)
--border    = mix(tint, #2a3545, 0.20)
```

where `mix(a, b, w)` is per-channel linear interpolation in sRGB at weight `w` toward `a`, rounded to integer channels. Implement it in TS and return hex strings. Do **not** use the CSS `color-mix()` function — computing in TS keeps it unit-testable and removes any browser-support question.

For teams whose darkest color is at or near black (Pittsburgh, Las Vegas, New Orleans, Baltimore, Cincinnati, Jacksonville), the tint is a near-no-op and the surfaces land on today's values. That is correct and expected; those teams get their identity from the accent.

**Accent selection with a contrast fallback.** The team's primary is not always usable — several are dark enough to disappear against a near-black background. Select mechanically:

```
--accent = first of [primary, secondary, tertiary] with contrast ratio >= 4.5:1
           against that team's derived --bg
           (if none qualify, lighten primary in equal steps until it does)
--accent-dim = --accent darkened toward the team --bg until it lands
               between 2.0:1 and 3.0:1 against --bg
--accent-alt = the highest-contrast of the two colors not chosen as --accent
```

Implement WCAG 2.1 relative luminance and contrast ratio as exported pure functions. Record in a comment on each team entry which slot won, so a future reader can see that e.g. Baltimore is accented on its secondary by rule and not by someone's taste.

---

### Applying the theme (`client/src/theme.css`, `client/src/main.tsx`)

Set the variables as inline properties on `document.documentElement` via `style.setProperty()`. Do not generate 33 CSS classes or a `[data-team="KC"]` block per team in `theme.css` — that duplicates the palette in two places and they will drift.

**No flash of the default theme.** The variables must be applied before React's first paint. Do the initial `localStorage` read and `setProperty` loop at module scope in `main.tsx` (or in a module it imports), *before* `createRoot().render()` — not inside a `useEffect`, which runs after the first paint and will show a visible amber flash on every load.

Keep `:root` in `theme.css` exactly as it is today. It stays the fallback for the pre-JS paint and for `NONE`.

Also set `document.documentElement.dataset.team` to the code. Nothing needs it yet; it makes the active theme visible in devtools and greppable later.

---

### Context (`client/src/context/TeamThemeContext.tsx`, new file)

Mirror `LeagueTypeContext` in structure: `TeamThemeProvider`, a `useTeamTheme()` hook that throws outside the provider, `localStorage` key `ef_team`.

State is `{ team: string | null; setTeam: (code: string | null) => void; hasChosen: boolean }`.

Three states, and they must stay distinguishable:

| `ef_team` value | meaning | theme |
|---|---|---|
| absent | never asked | classic — and the picker shows |
| `'NONE'` | explicitly chose Classic, or skipped | classic — picker does not show |
| a team code | chose a team | that team |

Storing `null`/`''` for "skipped" and letting it read as "absent" would re-show the picker on every visit forever. `hasChosen` is `ef_team !== null`, not `team !== null`.

Wrap `<App/>` in `main.tsx`, outside `LeagueTypeProvider` (the theme is more global than the league type; nesting order otherwise doesn't matter here).

---

### First-visit picker (`client/src/components/TeamPicker.tsx`, new file)

Modal over an overlay, reusing the existing `.ktc-popup-overlay` / `.ktc-popup` visual language — same border, radius, backdrop, and close affordance. Do not invent a second modal style.

- Title along the lines of "Pick your team", one line of subtitle explaining it only changes colors.
- A grid of 33 tiles: 32 teams plus **Classic**. Each tile shows the team code in large mono, the full name small beneath, and a row of three small color swatches drawn from that team's `primary`/`secondary`/`tertiary`.
- **No logos or team wordmarks.** No image assets, no external logo CDN. Swatches and text only — it fits the terminal aesthetic and avoids trademarked artwork.
- Hovering or keyboard-focusing a tile **live-previews** the theme; moving away reverts to the current one. Committing happens only on click. This is the whole appeal of the feature and it costs one `setProperty` loop per hover.
- Clicking a tile writes `ef_team` and closes.
- A "Skip" control writes `'NONE'` and closes. Dismissing via the overlay or ✕ does the same — there is no way to close this without recording a decision, because a dismiss that records nothing means the modal returns on the next load and reads as a bug.
- Grid is scrollable within the modal at small viewport heights; the modal itself must not exceed the viewport.
- Tiles are real `<button>` elements. Arrow-key navigation is not required; tab order and Enter/Space are.

**Gating against `KtcPopup`.** Two modals must never be on screen at once. In `App.tsx`, render `<TeamPicker/>` when `!hasChosen`, and render `<KtcPopup/>` only when `hasChosen` is true. On a true first visit the user sees the team picker, decides, and the KTC popup follows in the same session. Do not touch `KtcPopup`'s internals or its `sessionStorage` gate — the conditional mount is the entire change, and it must go on the `<KtcPopup/>` element in `App.tsx`, not inside the component.

---

### Persistent selector (`client/src/components/TeamSelector.tsx`, new file)

The user must be able to change teams at any time, from the top right.

- Mount in `.topbar` in `App.tsx`, **after** `<LeagueTypeSelector/>`, pushed to the right edge (`margin-left: auto` on the selector, since `.topbar` is a wrapping flex row — verify the existing wrap behavior at narrow widths still works and the league selector doesn't get orphaned).
- Collapsed state is a small button showing the current team code (or `CLASSIC`) with its three swatches. Clicking opens the same tile grid used by the picker.
- **Extract the grid into one shared component** used by both `TeamPicker` and `TeamSelector`. Two copies of a 33-tile grid is the wrong outcome; hover-preview logic in particular should exist once.
- Opens as a dropdown panel anchored to the button on desktop. On mobile (<768px) reuse the modal presentation rather than a dropdown — a 33-item dropdown in a wrapping topbar will be unusable otherwise.
- Closes on outside click and on Escape.

`.topbar` is `position: sticky; z-index: 100`. The dropdown must sit above it and above page content; check it against a scrolled Rankings table, whose `th` is also sticky with `z-index: 10`.

**Mobile:** the topbar already wraps at 768px. The selector collapses to the team code and swatches with no label text. It must not push the nav links onto a third row on a 375px-wide viewport — check this specifically.

---

### Docs

Add a section to `docs/05-ui-spec.md` covering the picker, the persistent selector, the three-state `ef_team` convention, the derivation and contrast rules, and — explicitly — the fixed `--severity-mid` token and why the verdict and KTC ramps must never be accent-derived. That last point is the one a future change will otherwise undo.

---

### Tests (`client/src/teamThemes.test.ts`, new file)

The root `vitest.config.ts` sets only `globals: true`, so tests run in the **node** environment. Keep this file pure color math — no React rendering, no `document`, no jsdom, and do not add an environment to the vitest config.

Assert:

1. Exactly 33 entries; all 32 NFL codes present exactly once, plus `NONE`; codes match the DB convention (assert `GB`, `KC`, `LV`, `SF`, `TB`, `NE`, `NO`, `JAX`, `WAS`, `LAR`, `LAC`, `CLE`, `TEN` specifically).
2. Every color in the table is a valid 6-digit hex.
3. **For every one of the 33 themes**, `contrast(--ink, --bg) >= 7.0`. This is the test that stops a tinting change from quietly making body text unreadable for one team.
4. **For every one of the 33 themes**, `contrast(--accent, --bg) >= 4.5` — proving the fallback chain actually fires rather than silently passing through a dark primary.
5. For every theme, `--accent-dim` contrast against `--bg` is within `[2.0, 3.0]`.
6. `resolveTheme(NONE)` returns exactly today's `:root` values for `--accent`, `--accent-dim`, `--bg`, `--bg-raised`, `--bg-hover`, `--border`. Hardcode the six expected hexes as literals in the test — this is the regression guard on "skipping changes nothing."
7. No theme returns a value for `--ink`, `--ink-muted`, `--positive`, `--negative`, or `--severity-mid`. Assert on the returned key set, so an attempt to theme a semantic color fails the build rather than shipping.
8. `contrast(--accent, --positive)` and `contrast(--accent, --negative)` are reported for all 33 themes — not asserted, since a red-accented team legitimately has a red accent, but logged so the collision is visible.

---

### Verification

- `npm test` green, all 92 existing tests plus the new file.
- `npm run dev`, clear `localStorage`, reload: picker appears with no amber flash before it.
- Hover across several tiles and confirm the live preview tracks and reverts.
- Pick Kansas City. Go to the Calculator and build a lopsided trade. **Confirm Slight edge, Clear win and Landslide are still three visually distinct colors** and that none of them is the KC red accent. Then open the KTC popup and confirm KEEP / TRADE / CUT are still three distinct colors.
- Repeat that check with Philadelphia (green primary) and Baltimore (dark primary — confirm the accent fell back to secondary and is legible).
- Reload: no picker, theme persists. Change team from the topbar, reload, new theme persists.
- Clear `localStorage`, reload, hit Skip: classic theme, and reloading does **not** re-show the picker.
- At 375px width, confirm the topbar doesn't reflow to three rows and the selector opens as a modal, not a clipped dropdown.
- Scroll the Rankings table with the selector open and confirm the panel is above the sticky header.

### Out of scope

Do not add a server route, a migration, or any `sessions`-table column — this is `localStorage`-only, by decision. Do not touch `shared/`, `server/`, or `scripts/`. Do not change `--positive`, `--negative`, `--ink`, or `--ink-muted` in any theme. Do not modify `KtcPopup.tsx` itself or its `sessionStorage` gate. Do not add logo images. Do not implement a light-mode or dark-mode toggle — it's a separate roadmap item and the tinting math here assumes a dark base.

<!-- ==================== END PROMPT — stop pasting here ==================== -->

---

## ROUTING (for Aven — do not paste)

**Send to `ui`.** Every file is inside its allow-list: `client/**` covers `teamThemes.ts`, `teamThemes.test.ts`, `TeamThemeContext.tsx`, `TeamPicker.tsx`, `TeamSelector.tsx`, `theme.css`, `App.tsx`, `main.tsx`, and `docs/05-ui-spec.md` is explicitly allowed. No `build` hop is needed — nothing touches `shared/`, which is what would otherwise force one.

Append this dispatch line:

> Do the `--severity-mid` decoupling of the verdict and KTC ramps as a first, self-contained step and confirm the app looks unchanged under the classic theme before you add any team colors. Then build the palette and contrast functions with their tests passing, and only then wire up the picker and selector.

That ordering matters. If it builds the picker first, the accent-vs-semantic collision surfaces as "hmm, red on red looks a bit off" during your manual check rather than as a structural fix, and the likely response is to tweak one team's hex instead of removing the coupling.

**`documentation` hop:** `docs/06-roadmap.md` is not in `ui`'s allow-list. After `ui` finishes, dispatch:

> Move favorite-team color theming to the Done section of docs/06-roadmap.md dated today, noting it's localStorage-only with no server persistence. Add a new deferred item for per-user team persistence on the session record, since the current implementation doesn't follow a user across devices.

**Then, yourself:**

```
npm test
npm run dev          # walk the verification list above
```

**`git` hop** when you're satisfied — `@git commit and push`. No `deployment` hop is required for correctness, but nothing ships until you `fly deploy`; unlike the rebase, this one is pure client code, so a deploy is all it needs.

**Judgment call to watch:** hex accuracy across 32 franchises is the one thing the tests can't check. They prove every palette is *legible and internally consistent*, not that it's the *right* shade. Click through all 33 tiles once and correct anything that looks off — it's a one-line fix per team in `teamThemes.ts`, and the contrast tests will catch you if a correction makes something unreadable.

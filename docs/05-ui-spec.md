# 05 — UI Spec

## Design direction: minimalist retro

Implementation may choose the specific retro flavor (terminal/CRT, 8-bit, or vintage-football-program) but must honor these constraints:

- **Minimalist first**: lots of whitespace (or dark-space), one accent color, no gradients/shadows/glassmorphism. Retro comes from typography, color, and small touches — not clutter.
- Monospace or slab display font for headings and numbers (numbers are the star of this app — make values/ranks feel like scoreboard digits). System/sans is fine for body.
- Chunky 2px borders, square corners (or 2–4px max), visible focus states.
- Suggested palette approach: 1 background, 1 ink, 1 accent (e.g. phosphor green, mustard, or burnt orange), 1 danger/negative. Define as CSS variables in `theme.css`; support the chosen theme only (no light/dark toggle in v1).
- Subtle allowed flourishes: scanline texture on the header, blinking block cursor on empty search inputs, ASCII-style dividers. Skip anything animated beyond 200ms micro-transitions.
- Responsive: usable on mobile (calculator especially).

## Layout

Persistent top bar: `EMPIRE FANTASY` wordmark left; tabs: **Calculator · Rankings · Keep/Trade/Cut · Log**. Global **league type selector** lives in the top bar and persists across tabs (in `localStorage` + URL param). Selector = 4 compact segmented controls: `DYN|RED` `1QB|SF` `PPR|½|0` `TEP on|off`.

## Pages

### 1. Trade Calculator (`/`)

- Two columns: TEAM 1 / TEAM 2. Each has an asset search (typeahead: name, shows pos·team·age·value) and a stacked list of added assets with per-asset value and remove ✕. Picks appear in search only for DYN league types.
- **Chip values follow the selected league type.** Each added asset stores its value across **all 24 league types** (fetched once from `GET /api/assets/:id` at add time, seeded immediately with the search value). The chip renders the value for the **currently selected** `code`, so switching league types updates every chip instantly (a muted `—` if that format has no entry, e.g. while a fetch is pending or for a pick under a redraft code). Totals, scale, verdict, and the math panel always recompute server-side from the current `code`.
- **Switching to a Redraft league type removes picks.** Picks only carry values in Dynasty, and the evaluate endpoint rejects them in Redraft (400). So when the active `code` changes to a `RED_*` league type, any picks already on both sides are dropped immediately (before evaluation) and a dismissible muted notice appears: "Removed N pick(s) — picks aren't tradeable in Redraft."
- **Under each team's player chips**: Value Adjustment row (only on the side receiving it). Styled as a chip but visually distinct — muted/hatched background, no position badge, no remove button — showing `+X.X`. Only rendered on the side that receives the credit.
- **Piece-count summary line** per side (matching KTC): `2 Total Pieces / 1 WR, 1 TE` (or appropriate positions).
- **Below the Value Adjustment row on the credit-receiving side**: small link/disclosure: **"More on value adjustment"**. Expanded, it reads:
  > Trading is more than simple addition. We add value to the side of the trade that's giving up more when you look at roster spots, players' "stud" factor, and so on. This counters trade math that says twelve third-round picks are a fair deal for one elite player.
  >
  > The adjustment is reverse-engineered from what the lighter side would need added to even the trade, which is why it updates as players are added to either side.
- **Team header total** must equal chips + adjustment. This is the whole point; if it doesn't add up, the feature has failed.
- Below: horizontal **trade scale** — a meter from TEAM 1 ←→ TEAM 2 with a needle at `scale` (−100..+100), verdict text ("FAIR TRADE", "CLEAR WIN — TEAM 1"), each side's total, and the "add a ~X-value player to even it" hint.
- **Players to Even Trade panel** (appears below the scale when `suggestions.length > 0`):
  - Header label styled like existing section headings ("Players to Even Trade").
  - One row per suggestion: position badge (reuse `.pos-badge--{POS}` classes), name, team, value, target side indicator (e.g. `→ Team 2`), and a `+` button on the right.
  - Clicking `+` adds that asset to the indicated side, exactly as if it had been picked from AssetSearch — same state update path, so the trade re-evaluates and the panel refreshes with new suggestions. Do not duplicate the add logic; reuse the handler `AssetSearch`'s `onSelect` already feeds.
  - Show which side it's for. With both sides populated it's ambiguous otherwise — a small `→ Team 2` marker on the row, or a panel subheading, either is fine.
  - Keep the existing `adviceGap` text line above the panel. The number and the concrete suggestions complement each other.
  - **Retro terminal theme only** (docs/05-ui-spec.md). No new colors outside the existing palette, no rounded-card look borrowed from the KTC screenshot — this is a layout borrow, not a visual restyle.
  - Values render with `.toFixed(1)`, consistent with the rest of the app, and are now up to 6 characters (999.9) — size the column accordingly.
- **Empty and edge states**:
  - **Fair trade** → no panel at all, not an empty panel with a "nothing to suggest" message.
  - **Verdict is lopsided but no candidate improves it** (possible on an extreme landslide where even the top asset falls short) → render the panel with a single muted line: "No single asset can even this trade." Do not silently hide the panel; the user needs to know the difference between "nothing fits" and "not computed."
- Expandable **"Show the math"** panel: per-asset breakdown (linear value → curved trueValue → slot weight → weighted contribution), **plus new per-side breakdown showing rawSum, depthPenalty, and adjustment**, and formula caption updated from "linear depth-weighted sum" to describe the credit framing. Toggled via dashed-border button below the verdict.
- Evaluation auto-runs on every change (debounced); no submit button.

### Trade Calculator — Volatility Profile Panel

Positioned inside `.calc-result`, after `.calc-result__details` and before the "Players to Even Trade" suggestions panel. It describes the trade as constructed, so it belongs with the verdict, above the prescriptive suggestions.

**Layout — side-by-side comparison with delta line:**

```
              VOL
  TEAM 1       41%
  TEAM 2       53%
  ─────────────────
  Team 2 gets +12 volatility
```

- Team 1 and Team 2 rows, each with a single volatility figure, aligned in columns so they read as a direct comparison.
- Below them, a delta line. Compute `volDelta = team2.volatility − team1.volatility` and phrase it in terms of the side receiving more: "Team 2 gets +12 volatility." Render it with **no `.delta--pos` / `.delta--neg` class** — a signed volatility difference has no good/bad direction. This is a deliberate departure from the old boom/bust panel, not an oversight: those tokens mean value direction everywhere else, and volatility is directionless.
- Render the delta line only when **both** sides have a non-null value. If one side is unrated, there's no comparison to draw — show the available side's number and omit the delta rather than comparing against nothing.
- Figures in default ink, monospace, matching the density of the surrounding result panel. No color coding — volatility is neutral, not good/bad. No new colors.
- Null renders as a muted `—`.

**Coverage note (required).** When a side has `unratedCount > 0`, render a small muted line beneath that side's row: "excludes 2 unrated" (or "excludes 1 unrated"). This is not optional polish — in Dynasty, a package of one player plus three picks would otherwise show a confident-looking average that describes a single asset. The user needs to see the average's coverage.

**States:**

1. **Both sides rated** → full panel with delta line.
2. **One side entirely unrated** (empty side, or all picks) → that side's row shows `—`, delta line omitted, coverage note still shown on the side that has exclusions.
3. **Neither side has a single rated asset** → omit the whole panel. Nothing to say.

**Responsive:** At mobile width, the panel stacks rather than squashes, consistent with how `.calc-result__details` already adapts (see `@media (max-width: 768px)` block in `theme.css`).

**CSS classes:** `.volatility-compare`, `.volatility-compare__header`, `.volatility-compare__label`, `.volatility-compare__col`, `.volatility-compare__row`, `.volatility-compare__side`, `.volatility-compare__val`, `.volatility-compare__coverage`, `.volatility-compare__delta`, `.volatility-compare__delta-item`.

### 2. Rankings (`/rankings`)

- Table for current league type: overall rank (#), positional rank (Pos), name, position (Pos badge), team, age, **Volatility (VOL)**, value.
- Controls: position filter tabs (ALL · QB · RB · WR · TE · PICKS when DYN), text search.
- **Sortable columns**: Value, Volatility, Age. Non-sortable: #, Pos, Name, Team.
- **Default state**: unsorted — renders in the API's natural value DESC order (byte-identical to no-sort behavior).
- **Three-state sort cycle**: clicking a sortable header cycles descending → ascending → default (unsorted). The third click returns to the canonical view.
- **Single-column sort**: only one column sorts at a time; clicking a new header replaces the previous sort.
- **Sort reset**: sort state resets to default when the position tab or league type changes. It does **not** reset on search input — filtering and sorting compose.
- **Null handling**: nulls (picks, unrated players) sort to the bottom in **both** directions. Not treated as 0 or -Infinity.
- **Tie-breaking**: equal values break by overallRank ascending for stable, meaningful ordering.
- **Rank columns do not renumber on sort**: overallRank (#) and positionalLabel (Pos) are identity computed server-side from value order. They travel with their rows. After sorting by Volatility, the top row might read #47 / WR12 — this is correct. Do not recompute rank client-side.
- **Header affordance**: sortable headers are `<button>` elements with pointer cursor, monospace sort indicator (▼ desc, ▲ asc, none for default), and `aria-sort` attribute. Keyboard accessible (Enter/Space).
- **Sticky header**: thead is `position: sticky; top: 0; z-index: 10` — header markup must not break this.
- Row click → Player detail (`/player/:assetId`): header shows pos-badge, name/team/age/status plus two rank badges (POS, e.g. "RB2", and OVR, e.g. "#4") when ranks exist; a hero row with the current value + label and, for players, a single volatility ring (picks get the value only, no ring); the value-across-all-24-formats grid behind a "Show all 24 formats" disclosure (closed by default); the value-over-time chart with a 30D / 90D / ALL range toggle; and the recent adjustment log behind a "Recent adjustments (N)" disclosure (closed by default).
- Virtualize or paginate at 100 rows.

**Mobile (< 768px)**: the Volatility column is hidden (`display: none` on both th/td). Remaining columns still sortable. Table horizontally scrolls for rank/name/value.

### Player Detail — Volatility Ring

A single donut-gauge ring sits in the player detail **hero row**, to the right of the
value, above the "Show all 24 formats" disclosure. It renders in `var(--accent)`.

**Visual: one SVG ring**

```
  [  ████░░░░░░  38% ]
         VOL
```

- Ring spec (hard numbers, do not derive): `viewBox="0 0 86 86"`, `cx/cy = 43`, `r = 34`,
  `stroke-width = 9`, circumference `213.6`. Track circle is full `var(--bg-hover)`. Value arc
  uses `stroke-dasharray = (pct/100)*213.6 , 213.6 - (pct/100)*213.6` with
  `transform="rotate(-90 43 43)"` so the arc opens from 12 o'clock.
- Centered inside the ring: the percentage (~20px) in the arc's color (`var(--accent)`), and
  below it the label `VOL` (~10px, `--ink-muted`).
- The ring color is **`var(--accent)`, NOT `--positive` or `--negative`**. High volatility is
  not good or bad, and those tokens encode value direction everywhere else in the app. This
  is a deliberate exclusion, not an oversight.
- Retro terminal theme only. Square corners, monospace numbers, 2px track strokes, no
  gradients, no shadows, no load animation on the ring.
- CSS: `.player-hero`, `.player-hero__value`, `.player-hero__label`, `.player-hero__rings`,
  `.ring`, `.ring__pct`, `.ring__label`.

**Required states:**

1. **Player with rating** → the ring draws a proportional arc, number matches DB.
2. **Player with null rating** (`volatility_pct` null) → empty arc (track only) with a muted
   `—` where the percentage goes. Do **not** hide the ring and do **not** draw it as 0%.
3. **Pick** (`data.kind === 'pick'`) → the ring side of the hero is omitted entirely; the
   value sits alone. Picks have no volatility and an empty ring would be noise. (Rank badges
   in the header do render for picks in Dynasty — `positionalLabel` reads e.g. "PICK3".)

**Responsive (< 768px):** hero stacks value above the ring; the ring shrinks (72px) but stays
put; rank badges wrap under the name. Consistent with the existing
`@media (max-width: 768px)` block.

- **Header rank badges**: two badges replace the bare value in the `.detail-header` right
  side — `POS` above `positionalLabel` (accent, 2px accent border) and `OVR` above
  `#${overallRank}` (ink, 2px default border). Both null → render neither. Picks render them
  in Dynasty (`positionalLabel` reads "PICK3").

### Player Detail — Discussion

A flat, anonymous, newest-first thread per asset, rendered as a section **below** the
existing player-page content (after the recent-adjustments disclosure) on the same route —
not a new route, not a tab. It lives in `client/src/components/Discussion.tsx` and owns its
own fetching (`GET /api/comments/:assetId`); it is deliberately **not** part of the
`AssetDetail` payload, which stays a single call that returns values/history/logs only.

**Composer:**

- Textarea, submit button, and a live character counter showing `n / 1000`.
- The limit shadows the server's `MAX_COMMENT_LENGTH` (in `server/src/services/commentService.ts`) — the value must stay in lockstep with it; it is never retyped ad hoc in the component. (Ideally it would be imported from `@empire-fantasy/shared`; that shared export is not yet wired, so it is mirrored with a pointer comment.)
- The counter turns `--negative` **past** the limit and the submit button disables. Submit is
  also disabled while the body is empty-after-trim and while a request is in flight.
- Above the textarea: **`Posting as Anonymous {Nickname} Fan`** (or `Anonymous Fan`), composed
  client-side **for this preview only** — the stored `authorName` still comes from the server.
- On success, prepend the returned comment to the list and clear the textarea — no refetch.
- `429` renders "Daily comment limit reached. Come back tomorrow." (matches `KtcPopup`'s
  capped copy). Other errors render inline; the typed body must **survive a failed submit**.

**Identity mapping — the `'NONE'` → `null` rule:** `useTeamTheme()` has three states. Both
"never asked" (`null`) and "Classic" (`'NONE'`) are **sent as `null` teamCode** on `POST`; a
team code is sent as-is. The server has no `'NONE'` team and would reject it with a `400`.

**List:**

- Rows render **newest first**. Each row: author name, relative
  timestamp, body, and a `✕`/`Sure?` delete control when `isMine`.
- Author names are styled with `--severity-mid` or `--ink`, **never `--accent`** (which is the
  *reader's* team color and would read as if every commenter backed the reader's team).
  Optionally each name is tinted with the commenter's own team color from `teamThemes.ts`,
  run through the theme's `contrast >= 4.5:1` rule against the current `--bg` and falling
  back to `--ink` on failure — a dark color on a dark background is unreadable regardless.
- Empty state: "No discussion yet." in `--ink-muted`.
- Pagination: 50 per page, a "Load more" button appends the next `offset` while
  `list.length < total`. No infinite scroll.

**Rendering the body — the security-relevant part:**

- The body is a **React text node**: `<p className="comment__body">{c.body}</p>`.
- **Never `dangerouslySetInnerHTML`.** No markdown, no link auto-detection, no `<br>`
  substitution via HTML — escaping happens here by rendering as text; the server stores the
  body verbatim (see `docs/01-architecture.md`), so any HTML-special characters in a comment
  are shown literally, never executed.
- Line breaks are preserved with CSS (`white-space: pre-wrap`), not by splitting/injecting
  elements.
- `.comment__body` also sets `overflow-wrap: anywhere` so a 1000-character string with no
  spaces can't blow out the page width.

**Delete:** confirm inline (the control becomes "Sure?"), then `DELETE`, then remove from
local state. No `window.confirm`.

**Responsive (< 768px):** the composer goes full width; the author line wraps above the
timestamp rather than sharing a row.

**CSS classes:** `.discussion`, `.comment`, `.comment__author`, `.comment__meta`,
`.comment__body`, `.comment-composer`, `.comment-composer__count` (plus supporting
`.comment__timestamp`, `.comment__delete`, `.comment__empty`, `.comment-composer__input`,
`.comment-composer__submit`, `.comment-composer__error`, `.discussion__list`,
`.discussion__pagination`). Reuses existing tokens — no new colors, no new fonts, no icon
library (delete is the `✕` character, matching `.ktc-popup__close`).

### 3. Keep / Trade / Cut (`/ktc`)

- **Per-session popup**: on every new browser/tab session (gate on `sessionStorage['ef_ktc_seen']`, not localStorage), a modal overlay appears over whatever page the user landed on. Same KTC card UI as the full page. Dismissible (✕ or Skip); after voting or skipping, sets sessionStorage flag and won't re-appear until the tab/browser is closed and reopened. The KTC tab remains for voluntary additional votes.
- Prompt UI: league type shown as a human-readable badge using `formatLeagueLabel()` — e.g. "DYNASTY, PPR, SUPERFLEX" or "REDRAFT, .5 PPR, 1QB, TE PREMIUM". On the popup, prefix with **"Rating for: "** so it reads as a deliberate assignment rather than a bug. On the `/ktc` page, no prefix — the badge matches the selector exactly.
- Three player cards (name, pos, team, age — **no values shown**). User taps to assign KEEP / TRADE / CUT (tap-cycle on mobile). Submit → subtle confirmation ("market updated"), auto-dismisses popup or loads next prompt. Skip button available.
- Daily cap reached → friendly "market's closed for you today" message.

### 4. Log (`/log`)

- Reverse-chron table of `adjustment_log`: time, asset, league type (human-readable label), reason chip (SEED/VOTE/STAT/MANUAL/DECAY), old → new, delta (colored ±). Filters: asset search, reason, league type. Paginated.

## Components inventory

`LeagueTypeSelector`, `AssetSearch`, `AssetChip`, `TradeScale`, `VerdictBanner`, `RankingsTable`, `ValueChart` (Recharts line), `KtcCard`, `LogTable`, `ReasonChip`, `SuggestionsPanel`, `VolatilityRing`, `TeamSelector`, `TeamPicker`, `TeamGrid`.

## Team color themes

The app lets a user pick a favorite NFL team on first visit and recolors itself in that team's colors. The choice persists in `localStorage` under `ef_team`, is changeable any time from a selector in the top bar, and defaults to the current amber "Classic" theme if the user skips.

### The three persistent states (`ef_team`)

`ef_team` is a plain string with three distinguishable states:

| `ef_team` value | meaning | theme | picker shows |
|---|---|---|---|
| *(absent)* | never asked | Classic | yes |
| `'NONE'` | explicitly chose Classic, or skipped | Classic | no |
| a team code (e.g. `'KC'`) | chose a team | that team | no |

`hasChosen` is `ef_team !== null`, **not** `team !== null`. Storing `null`/`''` for "skipped" and letting it read back as "absent" would re-show the picker on every visit forever. Skipping writes `'NONE'`. There is no way to dismiss the first-visit picker without recording a decision.

### Scope: only three variable groups change per team

`client/src/teamThemes.ts` defines the 33-entry `TEAMS` array (32 franchises + `NONE` Classic) and pure functions to derive the CSS. It lives in `client/`, **not** `shared/` — this is presentation data with no server consumer. The team list is a hardcoded static array; it is deliberately **not** derived from the DB (the `players.team` column currently holds only 29 distinct codes — CLE, LAC, TEN have no rostered players) or any API.

Only the ACCENT and SURFACE groups vary:

| Group | Variables | Source |
|---|---|---|
| Accent | `--accent`, `--accent-dim`, `--accent-alt` | team's three colors, contrast-checked |
| Surface | `--bg`, `--bg-raised`, `--bg-hover`, `--border` | base value tinted toward the team's darkest color |
| Semantic | `--ink`, `--ink-muted`, `--positive`, `--negative` | **never change** — identical in all 33 themes |

`--font-mono`, `--font-body`, `--radius` also never change.

### Derivation and contrast rules

`resolveTeam(t)` is a pure function (no DOM) returning the var→hex map, so it is unit-testable in node. NONE returns today's `:root` values byte-for-byte (regression guard: "skipping changes nothing").

- **Surface tinting** — never a raw team color as a background. `tint` = the darkest of the team's three colors by relative luminance, then mix it into the base at low weight: `--bg = mix(tint, #0a0e14, 0.12)`, `--bg-raised = mix(tint, #111720, 0.12)`, `--bg-hover = mix(tint, #1a2030, 0.14)`, `--border = mix(tint, #2a3545, 0.2)`. `mix(a, b, w)` is per-channel sRGB interpolation at weight `w` toward `a`, rounded to integer channels — computed in TypeScript (not CSS `color-mix()`), which keeps it unit-testable and browser-support-free.
  - Teams whose darkest color is near-black (PIT, LV, NO, BAL, CIN, JAX) get a near-no-op tint and land on today's surfaces; they get their identity from the accent. Correct and expected.
- **Accent selection with a contrast fallback** — chosen mechanically, not by taste: `--accent = first of [primary, secondary, tertiary]` with contrast ratio `>= 4.5:1` against that team's derived `--bg`; if none qualify, lighten the primary in equal steps until one does. `--accent-dim` is the accent darkened toward `--bg` until it lands between `2.0:1` and `3.0:1`. `--accent-alt` is the higher-contrast of the two colors not chosen as accent.
- **Contrast functions** are exported and WCAG 2.1 (`luminance`, `contrast`).

### The fixed `--severity-mid` (amber) token

`--positive` (green) and `--negative` (red) are **not decoration** — they encode meaning in value deltas, trade-scale zones, KTC card borders, KTC role chips, and the trade verdict ramp. They never change.

**Volatility is deliberately excluded from that pair.** High volatility is not good or bad, so nothing volatility-related uses `--positive` / `--negative`: the rankings VOL column renders in default ink, the player-detail ring uses `var(--accent)`, and the trade volatility panel's signed delta line carries no `delta--pos` / `delta--neg` class.

That is necessary but not sufficient: two ramps previously used `--accent` as the *middle* step between green and red (`.trade-verdict--slight`/`--clear` and `.ktc-role--trade`, plus the `ktc-card--trade` border). Both are ordered severity scales, and for a team whose primary is red or green, an `--accent` in the middle collapses the ramp to two steps (`Slight`/`Clear` blur together with `Landslide`, or `TRADE`/`KEEP` blur together). Roughly a third of the league has a red or green primary, so this is the common case.

Therefore the middle step is a **fixed, non-themable token in `:root`**:

```css
--severity-mid: #e8a525; /* fixed amber — never themed; middle step of the
                           verdict and KTC ramps; must stay distinct from
                           --positive and --negative in every theme */
```

`.trade-verdict--slight`, `.trade-verdict--clear`, `.ktc-card--trade`, and `.ktc-role--trade` all point at `--severity-mid`. **A future change must never re-point these at `--accent` or a team color** — that reintroduces the ramp-collapse bug for red/green-accented teams. `--severity-mid` is also asserted (in the tests) to never be present in any `resolveTeam()` output, so a theme can't touch it.

### Applying a theme (no flash of default)

Apply vars as inline `style.setProperty()` on `document.documentElement`. Do **not** generate per-team CSS classes or `[data-team]` blocks — that would duplicate the palette in two places and let them drift. `:root` in `theme.css` stays exactly as it is: it remains the fallback for the pre-JS paint and for `NONE`.

The initial read + set loop happens at module scope in `main.tsx` **before** `createRoot().render()` — NOT in a `useEffect`, which would run after first paint and flash amber on every load. `document.documentElement.dataset.team` is also set to the code (visible/greppable in devtools).

### Context

`TeamThemeContext` mirrors `LeagueTypeContext` (localStorage read sync in the initializer, write back in effects, throws outside its provider). `applyTeamTheme(code)` is a separate pure side-effect used both pre-paint and for hover-preview; it clears vars when `code` is `null`/`'NONE'` so classic is a real fallback.

### First-visit picker + persistent selector

- **Picker** (`TeamPicker`) — mounted in `App.tsx` only when `!hasChosen`. Reuses the existing `.ktc-popup` overlay/visual language (same border/radius/backdrop/close). Overlay click, ✕, and **Skip** all write `'NONE'`; there is no way to close without recording. Wired into a shared `TeamGrid`.
- **Persistent selector** (`TeamSelector`) lives in the top bar, after `LeagueTypeSelector`, collapsed to the current code + three swatches. Above 768px it opens as a dropdown panel; below, it reuses the modal presentation (a 33-item grid in a wrapping top bar is unusable). Closes on outside click and Escape. Its dropdown `z-index` sits above the sticky `.topbar` (100) and the sticky table header (10).
- **Grid** (`TeamGrid`) is the single shared 33-tile grid (32 teams + Classic). Tiles are real `<button>`s. Hover / focus live-previews the theme via `applyTeamTheme` and reverts to the current selection on leave; committing happens only on click. No logos, no image assets — swatches + text fit the terminal aesthetic.
- On mobile the selector collapses to code + swatches (label hidden) and shares row 1 with the brand so it never pushes the nav links to an extra row at 375px.

### Tests

`client/teamThemes.test.ts` is pure color math (node env, reported to vitest's config — no React/jsdom). It asserts: 33 entries with the DB-convention codes (e.g. GB, KC, LV, SF, TB, NE, NO, JAX, WAS, LAR, LAC, CLE, TEN) present; all hexes valid; for every theme `contrast(--ink, --bg) >= 7.0`, `contrast(--accent, --bg) >= 4.5`, `--accent-dim` in `[2.0, 3.0]`; `resolveTeam(NONE)` reproduces today's `:root` values byte-for-byte; and no theme sets a semantic or `--severity-mid` key (an attempt to theme one fails the build). `--accent` vs `--positive`/`--negative` collision distances are logged (a red accent is legitimate) but not asserted.
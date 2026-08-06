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

### Trade Calculator — Boom / Bust Profile Panel

Positioned inside `.calc-result`, after `.calc-result__details` and before the "Players to Even Trade" suggestions panel. It describes the trade as constructed, so it belongs with the verdict, above the prescriptive suggestions.

**Layout — side-by-side comparison with delta line:**

```
              BOOM      BUST
  TEAM 1       41%       28%
  TEAM 2       53%       19%
  ─────────────────────────────
  Team 2 gets +12 boom, −9 bust
```

- Team 1 and Team 2 rows, each with a boom and a bust figure, aligned in columns so they read as a direct comparison.
- Below them, a delta line. Compute `boomDelta = team2.boom − team1.boom` and the same for bust, and phrase it in terms of the side receiving more boom: "Team 2 gets +12 boom, −9 bust." Use the existing `.delta--pos` / `.delta--neg` color tokens on the signed numbers.
- Render the delta line only when **both** sides have a non-null value for that metric. If one side is unrated, there's no comparison to draw — show the available side's numbers and omit the delta rather than comparing against nothing.
- Boom figures in `var(--positive)`, bust in `var(--negative)`, monospace, matching the density of the surrounding result panel. No new colors.
- Null renders as a muted `—`.

**Coverage note (required).** When a side has `unratedCount > 0`, render a small muted line beneath that side's row: "excludes 2 unrated" (or "excludes 1 unrated"). This is not optional polish — in Dynasty, a package of one player plus three picks would otherwise show a confident-looking average that describes a single asset. The user needs to see the average's coverage.

**States:**

1. **Both sides rated** → full panel with delta line.
2. **One side entirely unrated** (empty side, or all picks) → that side's row shows `—`, delta line omitted, coverage note still shown on the side that has exclusions.
3. **Neither side has a single rated asset** → omit the whole panel. Nothing to say.

**Responsive:** At mobile width, the panel stacks rather than squashes, consistent with how `.calc-result__details` already adapts (see `@media (max-width: 768px)` block in `theme.css`).

**CSS classes:** `.boom-bust-compare`, `.boom-bust-compare__header`, `.boom-bust-compare__label`, `.boom-bust-compare__col`, `.boom-bust-compare__col--boom`, `.boom-bust-compare__col--bust`, `.boom-bust-compare__row`, `.boom-bust-compare__side`, `.boom-bust-compare__val`, `.boom-bust-compare__val--boom`, `.boom-bust-compare__val--bust`, `.boom-bust-compare__coverage`, `.boom-bust-compare__delta`, `.boom-bust-compare__delta-item`.

**Important:** Do not reuse the `.boom-bust` track markup from PlayerDetail.tsx — that block belongs to the profile page and the result panel is already tall. Do not modify it.

### 2. Rankings (`/rankings`)

- Table for current league type: overall rank (#), positional rank (Pos), name, position (Pos badge), team, age, **Boom**, **Bust**, value.
- Controls: position filter tabs (ALL · QB · RB · WR · TE · PICKS when DYN), text search.
- **Sortable columns**: Value, Boom, Bust, Age. Non-sortable: #, Pos, Name, Team.
- **Default state**: unsorted — renders in the API's natural value DESC order (byte-identical to no-sort behavior).
- **Three-state sort cycle**: clicking a sortable header cycles descending → ascending → default (unsorted). The third click returns to the canonical view.
- **Single-column sort**: only one column sorts at a time; clicking a new header replaces the previous sort.
- **Sort reset**: sort state resets to default when the position tab or league type changes. It does **not** reset on search input — filtering and sorting compose.
- **Null handling**: nulls (picks, unrated players) sort to the bottom in **both** directions. Not treated as 0 or -Infinity.
- **Tie-breaking**: equal values break by overallRank ascending for stable, meaningful ordering.
- **Rank columns do not renumber on sort**: overallRank (#) and positionalLabel (Pos) are identity computed server-side from value order. They travel with their rows. After sorting by Boom, the top row might read #47 / WR12 — this is correct. Do not recompute rank client-side.
- **Header affordance**: sortable headers are `<button>` elements with pointer cursor, monospace sort indicator (▼ desc, ▲ asc, none for default), and `aria-sort` attribute. Keyboard accessible (Enter/Space).
- **Sticky header**: thead is `position: sticky; top: 0; z-index: 10` — header markup must not break this.
- Row click → Player detail (`/player/:assetId`): header shows pos-badge, name/team/age/status plus two rank badges (POS, e.g. "RB2", and OVR, e.g. "#4") when ranks exist; a hero row with the current value + label and, for players, boom/bust rings (picks get the value only, no rings); the value-across-all-24-formats grid behind a "Show all 24 formats" disclosure (closed by default); the value-over-time chart with a 30D / 90D / ALL range toggle; and the recent adjustment log behind a "Recent adjustments (N)" disclosure (closed by default).
- Virtualize or paginate at 100 rows.

**Mobile (< 768px)**: Boom and Bust columns hidden (`display: none` on both th/td). Remaining columns still sortable. Table horizontally scrolls for rank/name/value.

### Player Detail — Boom / Bust Section

Two independent donut-gauge rings sit in the player detail **hero row**, to the right of the
value, above the "Show all 24 formats" disclosure. Boom uses `var(--positive)`, bust uses
`var(--negative)`.

**Visual: two side-by-side SVG rings**

```
  [  ████░░░░░░  38% ]   [  ██░░░░░░░░  21% ]
        BOOM                  BUST
```

- Ring spec (hard numbers, do not derive): `viewBox="0 0 86 86"`, `cx/cy = 43`, `r = 34`,
  `stroke-width = 9`, circumference `213.6`. Track circle is full `var(--bg-hover)`. Value arc
  uses `stroke-dasharray = (pct/100)*213.6 , 213.6 - (pct/100)*213.6` with
  `transform="rotate(-90 43 43)"` so the arc opens from 12 o'clock.
- Centered inside each ring: the percentage (~20px) in the arc's color (boom
  `--positive`, bust `--negative`), and below it the label `BOOM` / `BUST` (~10px,
  `--ink-muted`).
- `boomPct` and `bustPct` are generated independently and can sum to more than 100. They are
  two separate rings, **not** two halves of one dial — do not imply a "steady" remainder or a
  shared 100% baseline.
- Retro terminal theme only. Square corners, monospace numbers, 2px track strokes, no
  gradients, no shadows, no load animation on the rings.
- CSS: `.player-hero`, `.player-hero__value`, `.player-hero__label`, `.player-hero__rings`,
  `.ring`, `.ring__pct`, `.ring__label`.

**Required states:**

1. **Player with ratings** → both rings draw proportional arcs, numbers match DB.
2. **Player with null ratings** (`boom_pct` or `bust_pct` null) → that ring shows an empty
   arc (track only) with a muted `—` where the percentage goes. Do **not** hide the ring and
   do **not** draw it as 0%.
3. **Pick** (`data.kind === 'pick'`) → the ring side of the hero is omitted entirely; the
   value sits alone. Picks have no boom/bust and an empty ring would be noise. (Rank badges
   in the header do render for picks in Dynasty — `positionalLabel` reads e.g. "PICK3".)

**Responsive (< 768px):** hero stacks value above the rings; rings shrink (72px) but stay
side by side; rank badges wrap under the name. Consistent with the existing
`@media (max-width: 768px)` block.

- **Header rank badges**: two badges replace the bare value in the `.detail-header` right
  side — `POS` above `positionalLabel` (accent, 2px accent border) and `OVR` above
  `#${overallRank}` (ink, 2px default border). Both null → render neither. Picks render them
  in Dynasty (`positionalLabel` reads "PICK3").

### 3. Keep / Trade / Cut (`/ktc`)

- **Per-session popup**: on every new browser/tab session (gate on `sessionStorage['ef_ktc_seen']`, not localStorage), a modal overlay appears over whatever page the user landed on. Same KTC card UI as the full page. Dismissible (✕ or Skip); after voting or skipping, sets sessionStorage flag and won't re-appear until the tab/browser is closed and reopened. The KTC tab remains for voluntary additional votes.
- Prompt UI: league type shown as a human-readable badge using `formatLeagueLabel()` — e.g. "DYNASTY, PPR, SUPERFLEX" or "REDRAFT, .5 PPR, 1QB, TE PREMIUM". On the popup, prefix with **"Rating for: "** so it reads as a deliberate assignment rather than a bug. On the `/ktc` page, no prefix — the badge matches the selector exactly.
- Three player cards (name, pos, team, age — **no values shown**). User taps to assign KEEP / TRADE / CUT (tap-cycle on mobile). Submit → subtle confirmation ("market updated"), auto-dismisses popup or loads next prompt. Skip button available.
- Daily cap reached → friendly "market's closed for you today" message.

### 4. Log (`/log`)

- Reverse-chron table of `adjustment_log`: time, asset, league type (human-readable label), reason chip (SEED/VOTE/STAT/MANUAL/DECAY), old → new, delta (colored ±). Filters: asset search, reason, league type. Paginated.

## Components inventory

`LeagueTypeSelector`, `AssetSearch`, `AssetChip`, `TradeScale`, `VerdictBanner`, `RankingsTable`, `ValueChart` (Recharts line), `KtcCard`, `LogTable`, `ReasonChip`, `SuggestionsPanel`, `BoomBust`.
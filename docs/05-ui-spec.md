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

### 2. Rankings (`/rankings`)

- Table for current league type: overall rank, positional rank (e.g. WR4), name, position, team, age, value.
- Controls: position filter tabs (ALL · QB · RB · WR · TE · PICKS when DYN), text search, sort by value default.
- Row click → Player detail (`/player/:assetId`): metadata, value across **all 24 league types** (compact grid), value-over-time line chart (league type selector), recent adjustment log entries for that player.
- Virtualize or paginate at 100 rows.

### 3. Keep / Trade / Cut (`/ktc`)

- **Per-session popup**: on every new browser/tab session (gate on `sessionStorage['ef_ktc_seen']`, not localStorage), a modal overlay appears over whatever page the user landed on. Same KTC card UI as the full page. Dismissible (✕ or Skip); after voting or skipping, sets sessionStorage flag and won't re-appear until the tab/browser is closed and reopened. The KTC tab remains for voluntary additional votes.
- Prompt UI: league type shown as a human-readable badge using `formatLeagueLabel()` — e.g. "DYNASTY, PPR, SUPERFLEX" or "REDRAFT, .5 PPR, 1QB, TE PREMIUM". On the popup, prefix with **"Rating for: "** so it reads as a deliberate assignment rather than a bug. On the `/ktc` page, no prefix — the badge matches the selector exactly.
- Three player cards (name, pos, team, age — **no values shown**). User taps to assign KEEP / TRADE / CUT (tap-cycle on mobile). Submit → subtle confirmation ("market updated"), auto-dismisses popup or loads next prompt. Skip button available.
- Daily cap reached → friendly "market's closed for you today" message.

### 4. Log (`/log`)

- Reverse-chron table of `adjustment_log`: time, asset, league type (human-readable label), reason chip (SEED/VOTE/STAT/MANUAL/DECAY), old → new, delta (colored ±). Filters: asset search, reason, league type. Paginated.

## Components inventory

`LeagueTypeSelector`, `AssetSearch`, `AssetChip`, `TradeScale`, `VerdictBanner`, `RankingsTable`, `ValueChart` (Recharts line), `KtcCard`, `LogTable`, `ReasonChip`, `SuggestionsPanel`.
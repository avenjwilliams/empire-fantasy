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
- Below: horizontal **trade scale** — a meter from TEAM 1 ←→ TEAM 2 with a needle at `scale` (−100..+100), verdict text ("FAIR TRADE", "CLEAR WIN — TEAM 1"), each side's total, and the "add a ~X-value player to even it" hint.
- Evaluation auto-runs on every change (debounced); no submit button.

### 2. Rankings (`/rankings`)

- Table for current league type: overall rank, positional rank (e.g. WR4), name, position, team, age, value.
- Controls: position filter tabs (ALL · QB · RB · WR · TE · PICKS when DYN), text search, sort by value default.
- Row click → Player detail (`/player/:assetId`): metadata, value across **all 24 league types** (compact grid), value-over-time line chart (league type selector), recent adjustment log entries for that player.
- Virtualize or paginate at 100 rows.

### 3. Keep / Trade / Cut (`/ktc`)

- First visit (no session cookie): this page is the landing experience — brief one-liner "Your picks tune the market," then the prompt.
- Prompt UI: league type shown as a small badge; three player cards (name, pos, team, age — **no values shown**). User drags or taps to assign KEEP / TRADE / CUT (tap-cycle is fine on mobile). Submit → subtle confirmation ("market updated"), auto-load next prompt. Skip button available.
- Daily cap reached → friendly "market's closed for you today" message.

### 4. Log (`/log`)

- Reverse-chron table of `adjustment_log`: time, asset, league type, reason chip (SEED/VOTE/STAT/MANUAL/DECAY), old → new, delta (colored ±). Filters: asset search, reason, league type. Paginated.

## Components inventory

`LeagueTypeSelector`, `AssetSearch`, `AssetChip`, `TradeScale`, `VerdictBanner`, `RankingsTable`, `ValueChart` (Recharts line), `KtcCard`, `LogTable`, `ReasonChip`.

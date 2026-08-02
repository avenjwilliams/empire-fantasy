# 06 — Roadmap

Living list of deferred features and next steps. Add new items here; move finished items to the Done section with a date. Before starting an item, write a short spec section for it (in the relevant existing doc, or here if it doesn't fit) so implementation has the same doc-first grounding as v1.

## Deferred from v1

- **Pick time-decay job** — as the rookie draft approaches, drift pick values toward round/tier consensus; roll `season` forward post-draft. Log `reason='decay'`. (Sketch in `docs/03-scoring-adjustments.md` → Picks.)
- **Exact rookie pick slots** — current-year picks as 1.01, 1.02… instead of Early/Mid/Late tiers.
- **Injury-aware adjustments** — use Sleeper status changes as a value signal instead of relying purely on crowd votes.
- **User accounts** — replace anonymous sessions; per-user vote history.
- **League import from Sleeper** — pull a real league's rosters so users can evaluate trades with their actual teams.
- **Light/dark theme toggle.**
- **Top-asset ceiling pinning** — rank 1 seeds at 999.9 against a 1000.0 clamp, so the #1 asset has ~0.1 of upside (one vote) and the crowd can only move it down. Options to weigh later: lower the curve amplitude to reserve real headroom, or make the clamp ceiling soft.
- **Multi-asset trade suggestions** — when no single asset can close the gap, suggest 2-asset packages that would even the trade. Build on the existing single-asset simulation infrastructure.
- **Real boom/bust computation** — derive the ratings from `weekly_stats` against a positional baseline instead of random placeholders, and decide at that point whether they should vary by league type.

## Next steps

### 1. ~~KTC as first-visit popup~~ ✅

Done — see Done section.

### 2. ~~Trade calculator math transparency~~ ✅

Done — see Done section.

### 3. ~~Bug: rankings header renders below first row~~ ✅

Done — see Done section.

## Done

- 2026-07-29 — **Precision rebase (1–1000 native scale)**: 999.9 amplitude in rankToValue, clampRound bounds [1.0, 1000.0], precision invariant tests (<15% whole numbers). Script `npm run rankings:rebase` recovers seed ranks from CSVs, computes precise base, preserves accumulated drift, logs as reason='manual'. Rookie picks excluded. Clamp at 1000.0 leaves 0.1 headroom for #1 asset (top-asset ceiling pinning deferred).
- 2026-07-29 — **Value scale 1–100 → 1–1000**: widened player values from 1.0–100.0 to 1.0–1000.0 (one decimal). Scale invariance preserved in trade calculator (verdict/scale unchanged). Asymmetry: vote/stat deltas stay absolute (10× damped), age nudges and seed values ×10, INACTIVE_DECAY_RATE unchanged (multiplicative). Migration 004_value_scale_1000.sql rebuilds asset_values with new CHECK bound, scales adjustment_log and value_history. ELO_SCALE → 120, clampRound bounds → [1.0, 1000.0], PICK_VALUES ×10, AGE_NUDGE ×10, MIN_VALUE_FOR_EXPECTATION/INACTIVE_MIN_VALUE → 50. Tests updated; all 92 pass.
- 2026-07-26 — KTC first-visit popup: modal overlay on first visit (localStorage `ef_ktc_seen`), dismissible; KTC tab still available for voluntary votes.
- 2026-07-26 — Trade calculator math transparency: expandable "show the math" panel with per-asset breakdown (value → trueValue → weight → weighted) and formula explanation.
- 2026-07-26 — Rankings header sticky fix: `.table-scroll` now has `overflow-y: auto` + `max-height`, `th` sticky `top: 0` within the scroll container.
- 2026-07-26 — Fix seed rankings: replaced Sleeper ADP fallback with expert consensus sources (ESPN Clay dynasty 1QB, SI.com redraft PPR). seedService now loads independent dynasty and redraft base CSVs, derives SF variants mechanically. Cross-checked against KeepTradeCut SF rankings.
- 2026-07-26 — v1: all 7 phases (foundation, seed, read APIs/UI, calculator, KTC, stats, polish) + Fly.io deployment. Original plan: `docs/archive/implementation-plan.md`.

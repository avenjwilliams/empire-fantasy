# 06 — Roadmap

Living list of deferred features and next steps. Add new items here; move finished items to the Done section with a date. Before starting an item, write a short spec section for it (in the relevant existing doc, or here if it doesn't fit) so implementation has the same doc-first grounding as v1.

## Deferred from v1

- **Pick time-decay job** — as the rookie draft approaches, drift pick values toward round/tier consensus; roll `season` forward post-draft. Log `reason='decay'`. (Sketch in `docs/03-scoring-adjustments.md` → Picks.)
- **Exact rookie pick slots** — current-year picks as 1.01, 1.02… instead of Early/Mid/Late tiers.
- **Injury-aware adjustments** — use Sleeper status changes as a value signal instead of relying purely on crowd votes.
- **User accounts** — replace anonymous sessions; per-user vote history.
- **League import from Sleeper** — pull a real league's rosters so users can evaluate trades with their actual teams.
- **Light/dark theme toggle.**

## Next steps

### 1. ~~KTC as first-visit popup~~ ✅

Done — see Done section.

### 2. ~~Trade calculator math transparency~~ ✅

Done — see Done section.

### 3. ~~Bug: rankings header renders below first row~~ ✅

Done — see Done section.

## Done

- 2026-07-26 — KTC first-visit popup: modal overlay on first visit (localStorage `ef_ktc_seen`), dismissible; KTC tab still available for voluntary votes.
- 2026-07-26 — Trade calculator math transparency: expandable "show the math" panel with per-asset breakdown (value → trueValue → weight → weighted) and formula explanation.
- 2026-07-26 — Rankings header sticky fix: `.table-scroll` now has `overflow-y: auto` + `max-height`, `th` sticky `top: 0` within the scroll container.
- 2026-07-26 — Fix seed rankings: replaced Sleeper ADP fallback with expert consensus sources (ESPN Clay dynasty 1QB, SI.com redraft PPR). seedService now loads independent dynasty and redraft base CSVs, derives SF variants mechanically. Cross-checked against KeepTradeCut SF rankings.
- 2026-07-26 — v1: all 7 phases (foundation, seed, read APIs/UI, calculator, KTC, stats, polish) + Fly.io deployment. Original plan: `docs/archive/implementation-plan.md`.

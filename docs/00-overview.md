# 00 — Overview

## What Empire Fantasy is

A web app for fantasy football players with three core surfaces:

1. **Trade Calculator** — evaluate a two-team trade under any league type; verdict on a scale favoring Team 1 or Team 2.
2. **Rankings Browser** — overall rankings, positional rankings, and 1–100 scores for all players (and dynasty picks), per league type.
3. **KEEP / TRADE / CUT** — on first visit (and repeatable), the app shows a user three comparable players in a random league type; their choices nudge the shared rankings.

Rankings are **living**: seeded from expert consensus, then continuously adjusted by (a) crowd KEEP/TRADE/CUT votes and (b) weekly NFL performance once the season starts. No single event moves a player much; sustained signal does. Full history and an audit log are kept.

## League type matrix (24 combinations)

Three independent axes plus format:

| Axis | Options | Code segment |
|---|---|---|
| Format | Dynasty, Redraft | `DYN`, `RED` |
| QB setting | 1QB, Superflex | `1QB`, `SF` |
| Reception scoring | Full PPR, Half PPR, Zero PPR | `PPR`, `HALF`, `ZERO` |
| TE Premium (+0.5 PPR for TEs) | On, Off | `TEP`, `STD` |

Code format: `{FORMAT}_{QB}_{REC}_{TEP}` → e.g. `DYN_SF_PPR_TEP`, `RED_1QB_HALF_STD`. 2×2×3×2 = **24 league types**, each with its own complete ranking set (every player has a distinct 1–1000 value in each).

Note: TEP is meaningful even with `ZERO` reception scoring (TEs still get +0.5/reception) — keep all 24 combos.

## Assets

- **Players**: QB, RB, WR, TE only. Required metadata: name, position, NFL team, age, plus Sleeper ID, status (active/injured/FA).
- **Rookie draft picks** (Dynasty league types only): years current+1 through current+3, rounds 1–4, tiers Early/Mid/Late (current-year picks may use exact slot later; v1 uses tiers). Example asset: `2027 Early 1st`. Picks have values like players and appear in the calculator's asset search when a Dynasty league type is selected. Pick values are vote-adjustable but not stat-adjustable.

## Value system (summary — details in 03)

- Every asset × league type has a **value**: 1.0–1000.0, one decimal.
- Values change only through logged adjustments: `seed`, `vote`, `stat`, `manual` (CSV import), `decay` (optional pick time-decay).
- `value_history` snapshots enable "value over time" charts.

## Users

Multi-user, no accounts. Anonymous session cookie (UUID) identifies a browser for rate-limiting votes and avoiding repeat prompts. All users read and write the same shared ranking state.

## Glossary

- **Superflex (SF)**: lineup slot that can hold a QB, effectively 2 startable QBs → QB values rise sharply.
- **TE Premium (TEP)**: TEs get +0.5 points per reception → TE values rise.
- **Dynasty**: rosters carry over year to year; age and long-term outlook matter; rookie picks exist.
- **Redraft**: one season only; current-season production is everything.
- **KTC prompt**: the KEEP/TRADE/CUT three-player question.

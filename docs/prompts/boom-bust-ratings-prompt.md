# Prompt: boom/bust ratings on the player profile

**Paste into opencode: everything from `## TASK` down to the END PROMPT marker, plus the dispatch line quoted in ROUTING. Do not paste the ROUTING section itself — it's for you, not the agent.**

---

## TASK

Add a **boom rating** and a **bust rating** to every player, stored in the database and displayed on the player profile page. For now the numbers are randomly generated placeholders — the point of this task is to build the schema, the API surface, and the UI so that real computed ratings can be dropped in later without touching anything but the generator.

**Read the whole brief before editing.** The most important constraints are what this feature is *not* — see "Boom/bust is not a value" below.

---

### Boom/bust is not a value

This is the single most likely mistake in this task, so it comes first.

Boom and bust ratings are **not** player values. They are a separate, independent dataset that happens to live on the same players. Concretely:

- They are **percentages, 0–100**, not the 1.0–1000.0 value scale.
- They do **not** go through `clampRound` and are **not** rounded to the 1-decimal value convention. Use integer percentages.
- They do **not** write to `adjustment_log`. CLAUDE.md hard rule 2 ("every value change writes a row to `adjustment_log`") applies to `asset_values` only. Writing boom/bust rows into `adjustment_log` would corrupt the log's meaning — its `reason` CHECK constraint doesn't even have a valid value for this. **Do not add one.**
- They do **not** vary by league type. One boom and one bust number per player, full stop.
- They do **not** feed into vote math, stat ingestion, the trade calculator, or anything in `shared/src/value.ts`. `shared/src/value.ts` should not be modified by this task at all.
- They apply to **players only**. Picks have no boom/bust. The profile page for a pick must render without a boom/bust section and without errors.

If any part of the implementation starts to look like it belongs in the value pipeline, stop — it doesn't.

---

### Schema (`server/src/db/migrations/005_boom_bust.sql`)

New migration file. Do not edit 001–004; they are applied.

Add two nullable columns to `players`:

```sql
ALTER TABLE players ADD COLUMN boom_pct INTEGER CHECK (boom_pct IS NULL OR boom_pct BETWEEN 0 AND 100);
ALTER TABLE players ADD COLUMN bust_pct INTEGER CHECK (bust_pct IS NULL OR bust_pct BETWEEN 0 AND 100);
```

Nullable on purpose: a newly ingested player has no rating until the generator runs, and the UI must handle that state (see UI section). Do not backfill inside the migration — generation is the script's job, and keeping the migration pure data-definition means it stays safe to run against production.

Note that SQLite's `ALTER TABLE ADD COLUMN` supports `CHECK` in this form, so no table rebuild is needed here. Do not use the rebuild-and-rename pattern from migration 004 — it's unnecessary and it risks the live `/data/empire-fantasy.db`.

---

### Generator (`scripts/generate-boom-bust.ts`)

New script, wired to a new npm script `boom-bust:generate` in the root `package.json`.

Behavior:

- For every row in `players`, generate `boom_pct` and `bust_pct` as **independent** random integers.
- Range each to **5–65** rather than the full 0–100. Values near 0 or 100 are not plausible for either metric and will make the UI look broken during development. This range is a placeholder detail, not a domain claim — say so in a comment.
- **Idempotent by default**: only fill rows where the column is currently `NULL`. Re-running must not reshuffle existing numbers. A `--force` flag regenerates everything.
- Seed the RNG deterministically from the player's `sleeper_id` so the same player gets the same placeholder across a reseed. A simple string hash into a PRNG is fine — do not pull in a dependency for this.
- Wrap all writes in a single transaction.
- Log a one-line summary: how many players were filled, how many skipped.
- Follow the existing script conventions in `scripts/seed.ts` — `initDb` / `closeDb`, `PROJECT_ROOT` resolution via `fileURLToPath`.

Do **not** call this from `scripts/seed.ts` automatically. It is a separate manual step for now, documented in the runbook.

---

### API (`server/src/routes/assets.ts`)

In the asset detail handler `GET /:id`, extend the existing asset query to select `p.boom_pct` and `p.bust_pct`, guarded the same way the other player-only fields are:

```sql
CASE WHEN a.kind = 'player' THEN p.boom_pct ELSE NULL END as boom_pct,
CASE WHEN a.kind = 'player' THEN p.bust_pct ELSE NULL END as bust_pct,
```

They ride along in the existing response object — no new endpoint, no second round-trip. Picks get `null` for both, which is exactly the behavior the UI needs.

Do not add these to the `/search` typeahead response. The calculator has no use for them and the payload is on a hot path.

Everything else in this file is unchanged. In particular, do not touch the values, history, or logs queries.

---

### Types (`shared/src/types.ts`)

Add to the `Player` interface:

```ts
/** Share of weeks that qualify as a boom outcome, 0–100. Null until generated.
 *  Independent of bust_pct — the two are not shares of the same whole. */
boomPct: number | null;
/** Share of weeks that qualify as a bust outcome, 0–100. Null until generated.
 *  Independent of boomPct. */
bustPct: number | null;
```

Match whatever casing convention the rest of the file already uses — if `Player` uses snake_case to mirror the DB rows, use `boom_pct` / `bust_pct` instead and keep it consistent. Do not introduce a second convention.

---

### UI (`client/src/pages/PlayerDetail.tsx`, `client/src/theme.css`)

Add a **"Boom / Bust"** section on the player profile, positioned **directly below the `detail-header` and above the "Value Across All League Types" grid**. It's a player trait, so it belongs with the identity block, not buried under the log.

**Read this next part carefully — the two numbers are independent.**

`boomPct` and `bustPct` are generated independently and **can sum to more than 100**. They are not two slices of one pie. Therefore:

- Do **not** render them as segments of a single 100%-wide bar with an implied "steady" remainder. That visual asserts `boom + bust + steady = 100`, which is false here and will render as an overflowing or clipped bar the moment the two exceed 100.
- Instead render **two aligned full-width tracks**, stacked, each on its own 0–100 scale:

```
BOOM  ███████████░░░░░░░░░░░░░░░░░░░░░░░░  38%
BUST  ██████░░░░░░░░░░░░░░░░░░░░░░░░░░░░░  21%
```

Both tracks are the same width and share the same 0–100 baseline, so the bars stay directly comparable to each other while each remains an honest reading of its own number.

- Beside or above the tracks, show the two numbers as large stat callouts, styled like the existing accent value in `detail-header` (`font-mono`, bold, large). Label them `BOOM` and `BUST`.
- Boom uses a green from the existing palette; bust uses the existing red. Pull both from the CSS variables already defined in `theme.css` — check what `.delta--pos` / `.delta--neg` and the `.pos-badge--*` classes use and reuse those tokens. **No new colors.**
- Retro terminal theme only, per `docs/05-ui-spec.md`. Square corners, monospace, no gradients, no rounded cards, no animation on load.
- New CSS classes go in `theme.css` alongside the existing `.value-card` / `.detail-header` block, following the same BEM-ish naming already in use (e.g. `.boom-bust`, `.boom-bust__track`, `.boom-bust__fill`).

**Required states:**

- **Player with ratings** → the section as described.
- **Player with `null` ratings** (generator hasn't run for them) → render the section with a muted `—` in place of each number and empty tracks. Do not hide the section; the user needs to see that the rating is absent rather than assume it's zero.
- **Pick** (`data.kind === 'pick'`) → omit the section entirely. Picks have no boom/bust and an empty section would be noise.

Add a responsive rule in the existing `@media` block near line 1170 so the tracks and callouts stack rather than squash on mobile, consistent with how `.detail-header` and `.value-card` already adapt.

---

### Docs

- `docs/01-architecture.md` — the two new `players` columns and the extended `GET /api/assets/:id` response shape.
- `docs/02-data-pipeline.md` — the `boom-bust:generate` script: what it does, that it's idempotent, that it's a separate manual step not part of `npm run seed`, and the `--force` flag.
- `docs/05-ui-spec.md` — the Boom / Bust section, its placement on the profile, the two-track visual, and all three states.
- `docs/06-roadmap.md` — add to Deferred: **"Real boom/bust computation"** — derive the ratings from `weekly_stats` against a positional baseline instead of random placeholders, and decide at that point whether they should vary by league type.
- `README.md` — one line in the season-operations runbook for `npm run boom-bust:generate`.

State plainly in `docs/01` and `docs/02` that the current numbers are **random placeholders**, so nobody reads a seeded value as signal.

---

### Verification

- `npm test` green. No existing test should need modification — if one breaks, something outside this feature's scope was changed.
- Run the migration and confirm `PRAGMA table_info(players)` shows both columns.
- Run `npm run boom-bust:generate`, then run it again — confirm the second run reports 0 filled and no number changed.
- Run with `--force` and confirm numbers change.
- Open a player profile: section renders, both tracks fill proportionally, numbers match what's in the DB.
- Manually `UPDATE players SET boom_pct = NULL, bust_pct = NULL WHERE id = <one player>` and confirm that profile shows the `—` state rather than crashing or showing 0%.
- Open a **pick** profile in a `DYN_*` league type and confirm no boom/bust section and no console errors.
- Construct a case where boom + bust > 100 (`UPDATE players SET boom_pct = 70, bust_pct = 60 WHERE id = <one>`) and confirm both tracks render correctly without overflow or clipping. This is the regression case for the independence constraint.
- Check the profile at mobile width.

---

### Out of scope

Do not modify `shared/src/value.ts`, any file under `server/src/services/`, the vote or stat pipelines, `adjustment_log`, the trade calculator, the rankings CSVs in `data/rankings/`, or the export/import scripts. Do not add boom/bust to the rankings table, the calculator, or the KTC page. Do not compute anything from `weekly_stats` — that's the deferred follow-up. No new dependencies.

<!-- ==================== END PROMPT — stop pasting here ==================== -->

---

## ROUTING (for Aven — do not paste)

Four domains, and one file only `build` can touch:

| Work | File(s) | Agent |
|---|---|---|
| `Player.boomPct` / `bustPct` | `shared/src/types.ts` | **build** only |
| `docs/01`, `docs/06`, `README.md` | — | **build** or **documentation** |
| Migration 005, generator script, `package.json` script entry, `routes/assets.ts`, `docs/02` | `server/src/db/migrations/*`, `scripts/*`, `server/src/routes/assets.ts` | **rankings** |
| Profile section, CSS, responsive rule, `docs/05` | `client/**` | **ui** |

**Send it to `build`.** `shared/src/types.ts` is in no domain agent's allow-list, and the root `package.json` isn't either. Append this dispatch line:

> Do the shared/src/types.ts additions and the package.json script entry yourself first, plus docs/01, docs/06 and README.md. Then dispatch the migration, generator script, assets route change and docs/02 to rankings. Then the profile section, CSS and docs/05 to ui. Do not edit their files directly.

Order matters — the response shape and the `Player` type must land before `ui` renders against them.

**Expect a fight from `rankings` over `adjustment_log`.** Its brief says *"Every value change (seed, vote, stat update, manual import) writes a row to `adjustment_log` — no exceptions."* That agent owns the strictest rule in the codebase and this task hands it a write to `players` that deliberately bypasses it. It will likely either (a) add an `adjustment_log` write, or (b) stop and refuse the task as a rule violation. The "Boom/bust is not a value" section is written to preempt this, but if it balks, tell it: the rule governs `asset_values` only, and `adjustment_log.reason` has a CHECK constraint with no valid value for this — logging would require a migration that widens the constraint, which is explicitly out of scope.

**Watch for the value-scale reflex.** `rankings` works in 1.0–1000.0 with one decimal all day. Reject any diff that runs boom/bust through `clampRound`, stores them as `REAL`, or `.toFixed(1)`s them in the UI. These are integer percentages.

**Watch for the segmented-bar shortcut in `ui`.** A single stacked bar with an implied "steady" remainder is the obvious, prettier implementation and it's what most reference designs do — but it's wrong for independent values. The brief spells out two tracks and the verification list has a `70 / 60` case specifically to catch it. If the diff has one track with two fills, reject it.

**Note on `--force` and production.** The generator with `--force` overwrites every rating. Once these numbers are real rather than random that becomes destructive. Worth a guard before you ever run this against `/data/empire-fantasy.db`; for now the random data makes it harmless.

**If you'd rather revisit the independence decision:** constraining `boom + bust <= 100` would let you use the nicer single segmented bar with a "steady" middle segment, and it's the more defensible model of a share-of-weeks breakdown. It's a one-line change in the generator plus a table CHECK. Easier to decide now than after real data exists.

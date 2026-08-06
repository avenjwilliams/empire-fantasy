# Prompt: boom/bust columns + sortable rankings table

**Paste into opencode: everything from `## TASK` down to the END PROMPT marker, plus the dispatch line quoted in ROUTING. Do not paste the ROUTING section itself — it's for you, not the agent.**

---

## TASK

Surface the existing `boom_pct` / `bust_pct` player ratings as two columns in the Rankings table, and make the table's numeric columns sortable.

**Read the whole brief before editing.** The rank-vs-sort distinction below is the part that's easy to get subtly wrong, and it's specified precisely for that reason.

### What exists today

Migration `005_boom_bust.sql` added nullable `boom_pct` and `bust_pct` INTEGER columns (0–100) to `players`. `scripts/generate-boom-bust.ts` fills them with deterministic random placeholders. `GET /api/assets/:id` already returns them and `PlayerDetail.tsx` renders them in a `.boom-bust` section.

`GET /api/rankings` does **not** return them yet, and `Rankings.tsx` has no sorting of any kind — it renders whatever order the API returned, which is always `value DESC`.

These remain **random placeholder numbers**. Nothing in this task computes or interprets them; it only displays and orders by them.

---

### The trap: rank is not row position

`overallRank` and `positionalLabel` are computed server-side in `routes/rankings.ts` by walking the `value DESC` result set. They are **identity**, not row numbers — "Ja'Marr Chase is WR1" is a fact about his value, true regardless of how the user has sorted the table in front of them.

So when the user sorts by Boom:

- The **rows reorder**.
- The `#` and `Pos` rank columns **keep their original values** and travel with their rows. The top row after sorting by Boom might read `#47 / WR12`. That is correct and intended.
- Nothing recomputes rank client-side. Do not renumber, do not use the array index, do not add a second "sorted position" column.

An implementation that renumbers ranks on sort is wrong, and it's the obvious thing to write. Test 3 below exists to catch it.

---

### API (`server/src/routes/rankings.ts`)

Add to the existing SELECT, guarded exactly like the other player-only fields:

```sql
CASE WHEN a.kind = 'player' THEN p.boom_pct ELSE NULL END as boom_pct,
CASE WHEN a.kind = 'player' THEN p.bust_pct ELSE NULL END as bust_pct,
```

That is the **entire** server change. Specifically:

- Do **not** add sort query parameters. The endpoint already returns the full unpaginated result set for a league type, so sorting belongs on the client — a server round-trip per header click would be slower, would fight the existing `empire-refresh` event listener, and would gain nothing.
- Do **not** change the `ORDER BY av.value DESC`. It's what makes `overallRank` meaningful.
- Do **not** change the rank-computation loop, the position filter, or the picks-in-Dynasty guard.
- Do **not** add these fields to `/api/assets/search`.

---

### Client sorting (`client/src/pages/Rankings.tsx`)

Add `boom_pct: number | null` and `bust_pct: number | null` to the local `RankingRow` interface.

**Sortable columns:** Value, Boom, Bust, Age.
**Not sortable:** `#`, `Pos` (rank), Name, Pos (badge), Team. The rank columns aren't sortable because sorting by rank *is* sorting by value — offering both would be two controls for one behavior.

**Sort state and behavior:**

- Default state is **unsorted**, meaning the API's natural `value DESC` order is preserved as-is. This must be byte-identical to today's rendering — a user who never clicks a header sees no change whatsoever.
- Clicking a sortable header sorts descending on first click, ascending on second, and returns to the default unsorted state on the third. The third click matters: without it there's no way back to the canonical view.
- Only one column sorts at a time. Clicking a new header replaces the previous sort.
- Sort state resets to default when the position tab or league type changes. It does **not** reset on search input — filtering and sorting compose.
- Sorting happens **after** the search filter, in a `useMemo` keyed on rows, search, and sort state. Do not sort inside the fetch handler or mutate `rows` in place — `Array.prototype.sort` mutates, so copy first (`[...filtered].sort(...)`).

**Null handling — get this right:**

`boom_pct` and `bust_pct` are null for every pick, and null for any player the generator hasn't covered. `age` is already null for picks.

- Nulls sort to the **bottom in both directions**. Not treated as `0`, not treated as `-Infinity`, not scattered. In descending order nulls are last; in ascending order nulls are still last. This is the standard "missing data doesn't win either end" behavior and it keeps the PICKS tab from filling the top of an ascending Boom sort with rows that have no data at all.
- Ties break by `overallRank` ascending, so the order within equal values is stable and meaningful rather than dependent on the sort implementation.

**Header affordance:**

- Sortable headers get a pointer cursor and a small monospace indicator for the active direction — `▼` for descending, `▲` for ascending, nothing when inactive. No icon library; these are characters.
- Headers are `<button>` elements inside the `<th>`, or the `<th>` carries `role="button"` and `tabIndex={0}` with Enter/Space handling. Keyboard access is not optional here.
- Set `aria-sort="descending" | "ascending" | "none"` on each sortable `<th>`.
- The header row is `position: sticky` with `z-index: 10` (`theme.css` line ~158). Whatever markup goes inside the `<th>` must not break that — verify the header still sticks while scrolling a long list.

---

### Column rendering (`client/src/pages/Rankings.tsx`, `client/src/theme.css`)

Two new columns, inserted **between Age and Value**, headed `BOOM` and `BUST`:

- Plain right-aligned integer percentages with a `%` suffix, monospace, matching the density of the existing `.col-value` treatment.
- Boom uses `var(--positive)`, bust uses `var(--negative)` — the same tokens `.delta--pos` / `.delta--neg` already use at line ~409. **No new colors.**
- Null renders as a muted `—`, consistent with how Team and Age already render null in this table.
- New classes `.col-boom` and `.col-bust` in `theme.css`, defined alongside the existing `.col-rank` / `.col-value` block. Give them a `min-width` sized for `100%` (4 characters) so the columns don't jitter as values change width.
- Do **not** render mini bars or any graphic in these cells. At 300+ rows they add width and noise; the profile page is where the visual treatment lives.

**Mobile:** hide both columns below the 768px breakpoint via `display: none` on `.col-boom` and `.col-bust` in the existing `@media` block (near line 1225, where `.data-table th { position: static; }` already lives). Apply it to both `th` and `td`. The table is already seven columns and horizontally scrolling on a phone; rank, name and value are what matter at that width. There's no existing hidden-column precedent in this file, so you're establishing the pattern — keep it simple and put both rules together with a comment.

Sorting stays functional on mobile for the columns that remain visible.

---

### Verification

- `npm test` green. No existing test should need modification.
- Load Rankings with no interaction and confirm the order and every rendered value are identical to before this change.
- Sort by Boom descending: rows reorder, and the `#` / `Pos` columns show non-sequential values that stayed with their rows. If `#` reads 1, 2, 3, 4 down the page after sorting by Boom, the implementation is wrong.
- Third click on the same header returns to the exact default order.
- Sort by Boom ascending in a `DYN_*` league type on the PICKS tab, and on ALL: no pick or null-rating player appears above a player that has a rating.
- Type in the search box while a sort is active — both stay applied.
- Switch position tab, confirm sort resets; type in search, confirm it does not.
- Tab to a sortable header and press Enter; confirm it sorts.
- Scroll a long list and confirm the sticky header still sticks.
- Check at mobile width: boom/bust columns gone, remaining columns still sortable.
- `UPDATE players SET boom_pct = NULL WHERE id = <one player>`, reload, and confirm that row shows `—` and sorts to the bottom in both directions.

---

### Docs

- `docs/01-architecture.md` — the two added fields on the `GET /api/rankings` response.
- `docs/05-ui-spec.md` — the two new columns, which columns are sortable, the three-state click cycle, the null-sorts-last rule, the mobile hiding, and an explicit note that **rank columns do not renumber on sort**.
- `docs/06-roadmap.md` — add to Deferred: **"Server-side sorting and pagination for Rankings"**, for when the result set outgrows a single client-side payload.

---

### Out of scope

Do not modify `shared/src/value.ts`, anything under `server/src/services/`, the vote or stat pipelines, `adjustment_log`, the trade calculator, the KTC page, `PlayerDetail.tsx`, the `.boom-bust` CSS block, `scripts/generate-boom-bust.ts`, or migration 005. Do not add sorting to any other table in the app. Do not add pagination, column resizing, column hiding controls, or multi-column sort. No new dependencies.

<!-- ==================== END PROMPT — stop pasting here ==================== -->

---

## ROUTING (for Aven — do not paste)

Two domains, and — unlike the last two tasks — **nothing in `shared/src/types.ts`**. `RankingRow` is a local interface inside `Rankings.tsx`, so no build-only file is involved.

| Work | File(s) | Agent |
|---|---|---|
| Two SELECT fields | `server/src/routes/rankings.ts` | **rankings** |
| Columns, sort state, CSS, docs/05 | `client/src/pages/Rankings.tsx`, `client/src/theme.css` | **ui** |
| `docs/01`, `docs/06` | — | **build** or **documentation** |

**Send it to `build`.** Not because build has to edit anything substantive, but because `rankings` and `ui` can't reach each other — both have `task: {"*": deny, documentation: allow}`, so neither can dispatch to the other, and the route change has to land before `ui` has data to render. Append:

> Do docs/01 and docs/06 yourself. Dispatch the two SELECT fields in server/src/routes/rankings.ts to rankings first. Then dispatch the columns, sorting, CSS and docs/05 to ui. Do not edit their files directly.

**Alternative if you want tighter control:** this splits cleanly into two prompts you run yourself — the API section straight to `rankings`, then everything else straight to `ui`. The server change is four lines; you'd skip build's coordination overhead entirely and lose nothing but the docs/01 update. Worth considering, since roughly 90% of this task is `ui`'s and build adds a hop.

**The failure to watch for is rank renumbering.** Sorting a table and having the `#` column read 1, 2, 3 is what every table does, so the model will likely write it. It's wrong here — rank is derived from value and is a property of the row, not the viewport. The brief calls it out twice and the verification list checks it explicitly. If the diff computes rank from an array index anywhere in `Rankings.tsx`, reject it.

**Second most likely failure: server-side sort.** Adding `?sort=boom&dir=desc` to the endpoint is a reasonable instinct and would be right if the table were paginated. It isn't — the route returns every asset for the league type. Server sorting would also refetch on every header click and interact badly with the `empire-refresh` listener. If the diff touches the `ORDER BY` or adds query params, reject it.

**Third: null-as-zero.** A plain `(a, b) => b.boom_pct - a.boom_pct` gives `NaN` against nulls and produces implementation-defined garbage ordering. Nulls need an explicit branch before the numeric compare.

**On `ui`'s model.** This is the most logic-heavy task `ui` has been given — tri-state sort cycle, null ordering, stable tie-breaking, and the reset rules are four independent things to get right, and it's running `deepseek-v4-flash-free`. Same concern that led you to bump `trade-calculator`. Worth watching the diff closely, or temporarily pointing `ui` at `nemotron-3-ultra-free` for this one.

**One boundary question to expect.** `rankings`' brief frames it as owner of the "correctness-critical, stateful core" — vote math, stat adjustments, `adjustment_log`. Adding two display-only SELECT fields may read as beneath or outside its remit, or it may try to do the client work too since it owns the *concept* of rankings. `routes/rankings.ts` is in its allow-list and `client/**` is not; if it strays into the table, stop it.

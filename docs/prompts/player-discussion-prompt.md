# Prompt: per-player discussion threads

**Two prompts in one file — run them in order, as two separate opencode sessions.** Part 1 goes to `build` (schema, shared, API). Part 2 goes to `ui` (client). Each has its own END PROMPT marker. Paste from `## TASK` down to that part's marker, plus the dispatch line quoted in ROUTING.

**Depends on `team-theme-prompt.md` having shipped** — the author name is derived from the team the user picked for their theme. Do not run this first; there is no team to read.

---

## Design decisions already made (do not relitigate)

| Question | Decision |
|---|---|
| Author name | `Anonymous {Nickname} Fan`, e.g. `Anonymous Cowboys Fan`, from the theme team |
| Where the team comes from | client sends it with the POST; **snapshotted onto the comment row** |
| Thread scope | one global thread per asset — not per league type |
| Threading | flat, newest first |
| Abuse controls | per-session daily cap + length cap, and delete-your-own |
| Not included | admin delete, word blocklist, edit, votes/likes, notifications |

---

# PART 1 — schema, shared types, API

## TASK

Add server-side storage and a REST API for flat, anonymous, per-asset discussion threads. No client work in this part.

**Read the whole brief before editing.** Two things here look like existing patterns and are not: the `adjustment_log` rule does not apply (see "This is not a value change"), and the retired-player cleanup will silently orphan your rows unless you extend it (see "The cleanup trap").

---

### This is not a value change

CLAUDE.md hard rule 2 — every value change writes a row to `adjustment_log` — applies to `asset_values` only. Comments are not values.

- Do **not** write to `adjustment_log`. Its `reason` CHECK constraint has no valid value for this and **you must not add one**.
- Do **not** touch `shared/src/value.ts`, `voteService.ts`, `statService.ts`, or `seedService.ts` at all.
- Comments have no effect on any player's value, rank, or trade evaluation, now or later. Nothing in this feature reads `asset_values`.

If part of the implementation starts to look like it belongs in the value pipeline, it doesn't.

---

### Team codes and nicknames move to `shared` (`shared/src/constants.ts`)

The server must validate the submitted team code rather than trusting an arbitrary string into a display name. The 32-team list currently lives in `client/src/teamThemes.ts`, which the server cannot import.

Add to `shared/src/constants.ts`:

```ts
export interface NflTeam {
  code: string;      // 'DAL' — matches the players.team convention
  city: string;      // 'Dallas'
  nickname: string;  // 'Cowboys' — this is what appears in the author name
}

export const NFL_TEAMS: readonly NflTeam[] = [ /* all 32 */ ];
export const NFL_TEAM_CODES: readonly string[] = NFL_TEAMS.map(t => t.code);
export function teamNickname(code: string | null): string | null;
```

**Codes only — no colors.** The palettes stay in `client/src/teamThemes.ts`; only identity moves. Part 2 refactors `teamThemes.ts` to import from here so the code list exists once.

Build the array as a static literal of all 32 franchises. **Do not derive it from the database** — `players.team` currently holds only 29 distinct codes (`CLE`, `LAC` and `TEN` have no rostered players), so a DB-derived list would reject three legitimate teams. Match the existing convention: `GB`, `KC`, `LV`, `SF`, `TB`, `NE`, `NO`, `JAX`, `WAS`, `LAR`, plus `LAC`, `CLE`, `TEN`.

---

### Schema (`server/src/db/migrations/006_comments.sql`)

New migration. Do not edit 001–005; they are applied, and 005 is live in production.

```sql
CREATE TABLE comments (
  id INTEGER PRIMARY KEY,
  asset_id INTEGER NOT NULL REFERENCES assets(id),
  session_id TEXT NOT NULL REFERENCES sessions(id),
  team_code TEXT,                    -- NULL = user picked Classic / no team
  body TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  deleted_at TEXT
);
CREATE INDEX idx_comments_asset ON comments(asset_id, created_at DESC);
CREATE INDEX idx_comments_session ON comments(session_id, created_at);
```

Notes on the shape, each deliberate:

- `team_code` is **snapshotted at write time**, not joined from the session. A user who switches their theme from Dallas to Philadelphia keeps `Anonymous Cowboys Fan` on everything they already posted. Deriving the name at read time would rewrite both halves of a past argument, which is the wrong behavior and is the reason this column exists at all.
- `team_code` is nullable and renders as `Anonymous Fan`. Do not default it to a team.
- **Do not** add a `CHECK` constraint listing the 32 codes. Validation belongs in the service against `NFL_TEAM_CODES`, so a relocation is a one-line shared change rather than a migration.
- No `league_type_id`. One thread per asset, by decision.
- No `parent_id`. Flat, by decision.
- `deleted_at` is a soft delete — the row survives, the API filters it out.
- `asset_id`, not `player_id`. Picks are assets and get threads too; no special-casing.
- The second index is for the per-session daily-count query, which would otherwise scan.

---

### The cleanup trap (`server/src/index.ts`)

`cleanupRetiredPlayers()` hard-deletes rows from `players` and `assets`, and it does so under `db.pragma('foreign_keys = OFF')`. It will therefore delete an asset out from under its comments **without erroring**, leaving rows whose `asset_id` points at nothing.

Add `comments` to the delete block alongside `adjustment_log`, `asset_values`, and `value_history`, keyed on the same `assetIds` list. Keep it inside the existing `try`, before the `assets` delete. A hard delete is correct here — the asset is gone, so the thread has no page to live on.

This is easy to skip because nothing fails when you do.

---

### Service (`server/src/services/commentService.ts`, new file)

Business logic here, not in the route — follow the thin-route convention. Mirror `voteService.ts`'s error shape: return `{ error: string; code: number }` rather than throwing, and let the route map it to a status.

```ts
export const MAX_COMMENTS_PER_DAY = 20;
export const MAX_COMMENT_LENGTH = 1000;
```

Both exported and referenced by name — no magic numbers at call sites. `MAX_COMMENTS_PER_DAY` matches `MAX_VOTES_PER_DAY` in `voteService.ts`; leave a comment noting they're independent caps that happen to coincide, so nobody "unifies" them into one constant.

`listComments(db, assetId, { limit, offset })`:
- `WHERE asset_id = ? AND deleted_at IS NULL`, `ORDER BY created_at DESC, id DESC`. The `id` tiebreaker matters — `datetime('now')` has second resolution, so two comments in the same second would otherwise return in unstable order and paginate wrong.
- Returns rows plus a total count for the same filter.
- `limit` defaults to 50, clamps to 100.

`createComment(db, { assetId, sessionId, teamCode, body })`, validating in this order and returning the first failure:
1. Asset exists → `404`.
2. `body.trim()` is non-empty → `400`.
3. `body.trim().length <= MAX_COMMENT_LENGTH` → `400`. Measure the **trimmed** length, and store the trimmed value.
4. `teamCode` is `null` or a member of `NFL_TEAM_CODES` → `400`. Do not silently coerce an unknown code to `null`; a bad code is a client bug and should surface.
5. Count this session's non-deleted comments since `datetime('now','-1 day')` < `MAX_COMMENTS_PER_DAY` → `429`.

**The cap counts non-deleted rows only**, which means a user can delete and repost indefinitely. Accept that — it's a spam ceiling, not a security control, and counting deleted rows would let someone lock themselves out by cleaning up after themselves. Comment the decision in the code so it doesn't get "fixed."

Store `body` **exactly as submitted after trimming**. No HTML sanitization, no markdown parsing, no entity escaping at the storage layer. Escaping is the renderer's job and Part 2 does it by using React text nodes; escaping here as well would double-encode and show users `&amp;` in their own text.

`deleteComment(db, { commentId, sessionId })`:
- Sets `deleted_at = datetime('now')` **only where `session_id` matches** the caller. This is the entire authorization model — one `WHERE` clause. Get it right.
- Already-deleted or not-found or wrong-session all return the same `404`. Do not return `403` for wrong-session: that confirms the comment exists and is someone else's, which is a small information leak for no benefit.

---

### Routes (`server/src/routes/comments.ts`, new file; mounted in `server/src/index.ts`)

```
GET    /api/comments/:assetId          ?limit=&offset=
POST   /api/comments/:assetId          { body, teamCode }
DELETE /api/comments/:commentId
```

Mount as `app.use('/api/comments', commentsRouter)` alongside the existing routers. `sessionMiddleware` is already global, so `req.sessionId` is populated — do not add a second session lookup.

Response shape for `GET`:

```json
{
  "total": 47,
  "comments": [
    {
      "id": 12,
      "authorName": "Anonymous Cowboys Fan",
      "teamCode": "DAL",
      "body": "...",
      "created_at": "2026-08-06 14:22:01",
      "isMine": true
    }
  ]
}
```

- `authorName` is composed **server-side** from `team_code` — `Anonymous ${nickname} Fan`, or `Anonymous Fan` when `team_code` is null. The client must never build this string; one place, one format.
- `isMine` is `session_id === req.sessionId`. It drives the delete button and is the only reason the client needs to know anything about sessions. **Never return `session_id` itself** — it's the auth token in a cookie, and echoing it into a public JSON list of everyone's comments would hand every visitor's session to every other visitor. This is the one genuine security issue in the task.
- Do not return `deleted_at`; deleted rows aren't in the response at all.

`POST` returns the created comment in the same shape, `201`. `DELETE` returns `204`.

Do **not** add comments to the `GET /api/assets/:id` payload. That endpoint already returns values, history, and the full adjustment log; the discussion paginates independently and belongs on its own request.

---

### Tests (`server/src/services/commentService.test.ts`, new file)

`seedService.test.ts` is the pattern to follow for an in-memory DB. Tests never hit the network.

1. Round-trip: create, then list, and the body and `authorName` come back right.
2. `authorName` for a valid code, and `Anonymous Fan` for `null`.
3. Rejects an unknown team code with `400` — assert it does not coerce to null.
4. Rejects empty and whitespace-only bodies.
5. Rejects `MAX_COMMENT_LENGTH + 1` characters; accepts exactly `MAX_COMMENT_LENGTH`.
6. Trailing whitespace is trimmed before the length check — a body of `'a'.repeat(MAX) + '   '` is accepted.
7. The 21st comment from one session in a day returns `429`; a 21st from a *different* session succeeds.
8. Deleting one and posting again succeeds while at the cap (documents the intended hole).
9. Delete from a different session returns `404` and leaves `deleted_at` null.
10. Deleted comments are absent from `list` and excluded from `total`.
11. Ordering is newest-first and stable when two comments share a `created_at` second — insert two in one transaction and assert the higher `id` sorts first.
12. `list` never returns a `session_id` key. Assert on the object's key set, so it can't leak back in later.

---

### Docs

`docs/01-architecture.md` — add the `comments` table to the schema section and the three routes to the API section, including the `authorName` composition rule and the snapshot rationale for `team_code`.

---

### Verification

- `npm test` green — 92 existing plus the new file.
- `npm run dev`, then against a real asset id: POST a comment with `teamCode: "DAL"` and confirm `Anonymous Cowboys Fan`; POST with `null` and confirm `Anonymous Fan`; POST with `"XXX"` and confirm `400`; DELETE from a second cookie jar and confirm `404`.
- `grep -n "session_id" server/src/routes/comments.ts` — it should appear only in the `isMine` comparison, never in a response object.
- Restart the server and confirm 006 applies cleanly and idempotently.

### Out of scope for Part 1

No client files. No `parent_id`, no edit endpoint, no votes/likes, no admin delete, no word blocklist, no comment counts on `/api/rankings` or `/api/assets/:id`. Do not touch `shared/src/value.ts`, `docs/03`, or `docs/04`.

<!-- ==================== END PROMPT (PART 1) — stop pasting here ==================== -->

---

# PART 2 — client UI

**Run only after Part 1 is merged and its API verified by hand.**

## TASK

Add a discussion section to the player detail page, backed by the `/api/comments` endpoints that now exist.

---

### What exists

`client/src/pages/PlayerDetail.tsx` renders an asset's values, boom/bust rings, a `ValueChart`, and its adjustment log. Add the discussion **below the existing content**, as a section on the same page — not a new route, not a tab.

`client/src/teamThemes.ts` holds the 32-team palette table. Part 1 moved codes, cities and nicknames into `shared/src/constants.ts` as `NFL_TEAMS`. **Refactor `teamThemes.ts` to import `NFL_TEAMS` and keep only the colors keyed by code**, so the roster of teams exists in exactly one place. The `NONE` / Classic entry stays client-side — it isn't an NFL team.

`useTeamTheme()` from `client/src/context/TeamThemeContext.tsx` gives the current team. Its three states matter here: absent (never asked), `'NONE'` (Classic), or a code. **Send `null` as `teamCode` for both absent and `'NONE'`** — the server has no `'NONE'` team and will reject it with a `400`.

---

### Component (`client/src/components/Discussion.tsx`, new file)

Takes `assetId`. Owns its own fetching — do not thread comments through `PlayerDetail`'s existing `AssetDetail` fetch, which is a single call for a payload that doesn't include them.

**Composer:**
- Textarea, submit button, live character counter showing `n / 1000`.
- The counter turns `--negative` past the limit and the submit button disables. Import the limit from `@empire-fantasy/shared` — do not retype `1000`.
- Submit is also disabled while the body is empty-after-trim and while a request is in flight.
- Above the textarea, show the name the comment will post under — `Posting as Anonymous Cowboys Fan` — so the identity isn't a surprise. Compose it client-side for this preview only; the stored name still comes from the server.
- On success, prepend the returned comment to the list optimistically and clear the textarea. Do not refetch the whole list.
- `429` renders as "Daily comment limit reached. Come back tomorrow." — match `KtcPopup`'s existing capped-state copy. Other errors render inline; the typed body must survive a failed submit.

**List:**
- Newest first. Each row: author name, relative timestamp, body, and a delete control when `isMine`.
- Author name is styled with `--severity-mid` or `--ink`, **not `--accent`**. Every commenter would otherwise render in the *reader's* team color, which reads as if they all support your team.
- Optionally tint each author name with that commenter's own team color, looked up from `teamThemes.ts` by `teamCode`. If you do, run it through the same contrast check the theme uses against the current `--bg` and fall back to `--ink` on failure — a dark team color on a dark background is unreadable regardless of whose it is. Skip this entirely rather than shipping it unchecked.
- Empty state: "No discussion yet." in `--ink-muted`.
- Pagination: 50 per page, "Load more" button appending the next `offset` while `list.length < total`. No infinite scroll.

**Rendering the body — the security-relevant part:**
- Render as a **React text node**: `<p className="comment__body">{c.body}</p>`.
- **Never `dangerouslySetInnerHTML`.** No markdown library, no link auto-detection, no `<br>` substitution via HTML.
- Preserve line breaks with CSS — `white-space: pre-wrap` on `.comment__body` — not by splitting and injecting elements.
- Add `overflow-wrap: anywhere` so a 1000-character string with no spaces can't blow out the page width.

**Delete:** confirm inline (the control becomes "Sure?"), then `DELETE`, then remove from local state. No `window.confirm`.

---

### Styling (`client/src/theme.css`)

Reuse existing tokens and the established class-naming style. No new colors, no new fonts, no icon library — the delete control is a `✕` character, matching `.ktc-popup__close`.

Add `.discussion`, `.comment`, `.comment__author`, `.comment__meta`, `.comment__body`, `.comment-composer`, `.comment-composer__count`. Put them in one block with the other page-level sections.

The textarea must inherit `--font-mono`; browser default textareas ignore the body font and will stick out badly.

**Mobile (<768px):** the composer goes full width and the author line wraps above the timestamp rather than sharing a row.

---

### Docs

Add a Discussion section to `docs/05-ui-spec.md`: placement on the player page, composer behavior and limits, the identity preview, the `'NONE'` → `null` mapping, and the plain-text rendering rule with the reason.

---

### Verification

- `npm run dev`. Open a player, post a comment, confirm it appears immediately with the right author name.
- Switch your theme team, then reload the page. **The old comment must still show the old team** — that's the snapshot working. A new comment shows the new team.
- Set the theme to Classic and post: `Anonymous Fan`.
- Paste 1001 characters and confirm the counter goes red and submit disables.
- Post `<script>alert(1)</script>` and confirm it renders as literal visible text and no dialog appears. Then post a 1000-character string with no spaces and confirm the layout doesn't widen.
- Post a multi-line comment and confirm the line breaks survive.
- Delete your own comment; confirm it disappears and stays gone after reload. Open the same player in a private window and confirm no delete control appears on it.
- Open a rookie pick's page and confirm the discussion renders there too.
- Check the section at 375px.

### Out of scope for Part 2

No server or `shared` changes beyond the `NFL_TEAMS` import in `teamThemes.ts`. No comment counts elsewhere in the app. No replies, edit, votes, sorting controls, or `@`-mentions.

<!-- ==================== END PROMPT (PART 2) — stop pasting here ==================== -->

---

## ROUTING (for Aven — do not paste)

**Part 1 → `build`.** It has to be `build`: `shared/src/constants.ts` is in no domain agent's allow-list, and `rankings` can only edit `voteService` / `statService` / `seedService`, not a new `commentService.ts` or `routes/comments.ts`. `build` has no `edit` restrictions, so it can also write the migration and `index.ts`. Append:

> Do not dispatch any part of this to rankings. Nothing here touches value math, and rankings' allow-list doesn't cover commentService.ts, routes/comments.ts, or server/src/index.ts anyway.

Worth saying explicitly — `build`'s system prompt tells it to route anything involving migrations or services toward `rankings`, and this is the case where that instinct is wrong.

**Part 2 → `ui`.** Everything is under `client/**` plus `docs/05-ui-spec.md`, both allowed. Append:

> Part 1 has already moved the 32-team list into shared/src/constants.ts as NFL_TEAMS. Refactor teamThemes.ts to import it rather than keeping a second copy, and do not edit anything under shared/ or server/.

**`documentation` hop** after Part 1 for `docs/01-architecture.md` (it's outside `build`'s habit, though not its permissions — cleaner to hand it over), and after Part 2:

> Move per-player discussion threads to the Done section of docs/06-roadmap.md dated today. Add deferred items for: comment counts surfaced on the rankings table, one level of replies, and an admin delete endpoint gated on an env-var token — all three were considered and cut from v1.

**Sequencing:** Part 1, `npm test`, hand-verify the API with curl, `@git commit and push`, then Part 2. Do not run them in one session — Part 2's whole job is consuming an API whose shape you should have confirmed by hand first.

**Deploy:** Part 1 adds migration 006, which runs at startup against the live `/data/empire-fantasy.db`. `fly deploy` applies it automatically. Back up first:

```
fly ssh console -a empire-fantasy -C "cp /data/empire-fantasy.db /data/backup-$(date +%F).db"
```

006 is additive — a `CREATE TABLE` and two indexes, no rebuild-and-rename like 004 — so the risk is low, but it's still a schema change against live user data and the backup is cheap.

**The one thing to check yourself:** open `server/src/routes/comments.ts` and confirm `session_id` never reaches a response object. Test 12 covers the service, but the route composes the payload and a leak there would expose every visitor's session cookie to every other visitor. It's thirty seconds of reading and it's the only genuinely dangerous line in the feature.

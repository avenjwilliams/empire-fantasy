# 01 — Architecture

## Stack

- **Client**: React 18 + Vite + TypeScript, React Router, plain CSS (custom retro theme — see 05). Recharts for value-history charts.
- **Server**: Node 20, Express, TypeScript, `better-sqlite3` (synchronous, perfect for this workload), `zod` for request validation.
- **Shared**: `shared/` package with types and pure value-math functions used by both sides.
- **Testing**: Vitest.

## Project structure

```
empire-fantasy/
├── CLAUDE.md
├── docs/
├── package.json            # npm workspaces: client, server, shared
├── shared/
│   ├── types.ts            # Player, Asset, LeagueType, TradeInput, TradeResult...
│   ├── leagueTypes.ts      # the 24-combo matrix, code builders/parsers
│   └── value.ts            # clamp/round, trade curve, penalty math (pure, tested)
├── client/
│   └── src/
│       ├── pages/          # Calculator.tsx, Rankings.tsx, KeepTradeCut.tsx, PlayerDetail.tsx
│       ├── components/     # AssetSearch, LeagueTypeSelector, TradeScale, RankingsTable, ValueChart
│       └── theme.css
├── server/
│   └── src/
│       ├── index.ts
│       ├── db/
│       │   ├── db.ts
│       │   └── migrations/001_init.sql ...
│       ├── routes/         # players, rankings, trade, ktc, admin
│       └── services/       # rankingService, voteService, statService, tradeService, seedService
├── data/
│   ├── rankings/           # 24 CSVs, one per league type code (human-editable)
│   └── raw/                # cached source pulls (sleeper players.json, scraped rankings)
└── scripts/
    ├── seed.ts             # initial full seed
    ├── ingest-week.ts      # weekly stat pull + adjustments
    ├── export-rankings.ts
    └── import-rankings.ts
```

## Database schema (SQLite)

```sql
CREATE TABLE players (
  id INTEGER PRIMARY KEY,
  sleeper_id TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  position TEXT NOT NULL CHECK (position IN ('QB','RB','WR','TE')),
  team TEXT,                      -- NFL abbreviation, NULL if free agent
  age REAL,
  status TEXT DEFAULT 'active',   -- active | injured | inactive
  boom_pct INTEGER CHECK (boom_pct IS NULL OR boom_pct BETWEEN 0 AND 100),
  bust_pct INTEGER CHECK (bust_pct IS NULL OR bust_pct BETWEEN 0 AND 100),
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT
);

CREATE TABLE picks (
  id INTEGER PRIMARY KEY,
  season INTEGER NOT NULL,        -- e.g. 2027
  round INTEGER NOT NULL CHECK (round BETWEEN 1 AND 4),
  tier TEXT NOT NULL CHECK (tier IN ('EARLY','MID','LATE')),
  UNIQUE(season, round, tier)
);

-- Unified asset reference: exactly one of player_id / pick_id is set.
CREATE TABLE assets (
  id INTEGER PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('player','pick')),
  player_id INTEGER REFERENCES players(id),
  pick_id INTEGER REFERENCES picks(id)
);

CREATE TABLE league_types (
  id INTEGER PRIMARY KEY,
  code TEXT UNIQUE NOT NULL,      -- DYN_SF_PPR_TEP
  format TEXT NOT NULL,           -- DYN | RED
  qb TEXT NOT NULL,               -- 1QB | SF
  rec TEXT NOT NULL,              -- PPR | HALF | ZERO
  tep INTEGER NOT NULL            -- 1 | 0
);

CREATE TABLE asset_values (       -- current value
  asset_id INTEGER NOT NULL REFERENCES assets(id),
  league_type_id INTEGER NOT NULL REFERENCES league_types(id),
  value REAL NOT NULL CHECK (value BETWEEN 1.0 AND 1000.0),
  updated_at TEXT NOT NULL,
  PRIMARY KEY (asset_id, league_type_id)
);

CREATE TABLE adjustment_log (
  id INTEGER PRIMARY KEY,
  asset_id INTEGER NOT NULL REFERENCES assets(id),
  league_type_id INTEGER NOT NULL REFERENCES league_types(id),
  old_value REAL NOT NULL,
  new_value REAL NOT NULL,
  delta REAL NOT NULL,
  reason TEXT NOT NULL CHECK (reason IN ('seed','vote','stat','manual','decay')),
  detail TEXT,                    -- JSON: vote id, week/opponent/points, csv row, etc.
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE value_history (      -- daily snapshot per asset/league type (cron or on-change day bucket)
  asset_id INTEGER NOT NULL,
  league_type_id INTEGER NOT NULL,
  date TEXT NOT NULL,             -- YYYY-MM-DD
  value REAL NOT NULL,
  PRIMARY KEY (asset_id, league_type_id, date)
);

CREATE TABLE sessions (
  id TEXT PRIMARY KEY,            -- UUID cookie
  created_at TEXT DEFAULT (datetime('now')),
  last_seen_at TEXT
);

CREATE TABLE ktc_prompts (
  id INTEGER PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id),
  league_type_id INTEGER NOT NULL,
  asset_a INTEGER NOT NULL, asset_b INTEGER NOT NULL, asset_c INTEGER NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  answered_at TEXT,
  skipped_at TEXT                 -- nullable, set by POST /api/ktc/skip
);

CREATE TABLE ktc_votes (
  id INTEGER PRIMARY KEY,
  prompt_id INTEGER NOT NULL REFERENCES ktc_prompts(id),
  keep_asset INTEGER NOT NULL,
  trade_asset INTEGER NOT NULL,
  cut_asset INTEGER NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE weekly_stats (
  player_id INTEGER NOT NULL REFERENCES players(id),
  season INTEGER NOT NULL,
  week INTEGER NOT NULL,
  raw JSON NOT NULL,              -- Sleeper stat object
  PRIMARY KEY (player_id, season, week)
);

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

Indexes: `adjustment_log(asset_id, league_type_id)`, `adjustment_log(created_at)`, `value_history(asset_id, league_type_id)`.

## API routes

```
GET  /api/league-types
GET  /api/rankings?leagueType=DYN_SF_PPR_TEP&position=RB   # sorted by value DESC, with overall + positional rank + boom_pct/bust_pct (players only, null for picks)
GET  /api/assets/search?q=jeff&leagueType=...              # calculator search (includes picks if DYN)
GET  /api/assets/:id?leagueType=...                        # detail + history + recent logs + boom_pct/bust_pct + overallRank/positionalRank/positionalLabel (rank fields null without leagueType)
POST /api/trade/evaluate        { leagueType, team1: [assetIds], team2: [assetIds] }
GET  /api/ktc/prompt[?leagueType=CODE]                     # creates/returns prompt for session (sets session cookie)
POST /api/ktc/vote              { promptId, keep, trade, cut }
POST /api/ktc/skip              { promptId }               # mark prompt skipped, next GET /prompt yields fresh trio
GET  /api/log?assetId=&leagueType=&limit=                  # adjustment log browser
GET  /api/comments/:assetId?limit=&offset=                 # discussion thread (newest first, 50/page default)
POST /api/comments/:assetId          { body, teamCode }   # teamCode null for Classic
DELETE /api/comments/:commentId      # soft delete, session-scoped
```

Trade evaluation is **stateless** (no DB write) — it reads current values and computes.

### POST /api/trade/evaluate

**Request:**
```json
{
  "leagueType": "DYN_SF_PPR_TEP",
  "team1": [1, 2, 3],
  "team2": [4, 5]
}
```

**Response (extends `TradeResult` from `shared/types.ts`):**
```json
{
  "leagueType": "DYN_SF_PPR_TEP",
  "team1": { "assets": [...], "sideValue": 760.7, "rawSum": 737.0, "adjustment": 23.7 },
  "team2": { "assets": [...], "sideValue": 755.0, "rawSum": 755.0, "adjustment": 0 },
  "scale": 1,
  "verdict": "Fair trade",
  "differencePct": 0.8,
  "adviceGap": null,
  "valueAdjustment": 23.7,
  "valueAdjustmentSide": 1,
  "suggestions": [
    {
      "id": 42,
      "name": "Player Name",
      "position": "WR",
      "team": "LAR",
      "value": 540.3,
      "side": 2,
      "resultingLean": 0.012,
      "resultingVerdict": "Slight edge"
    }
  ],
  "boomBust": {
    "team1": { "boom": 40, "bust": 25, "ratedCount": 1, "unratedCount": 0 },
    "team2": { "boom": 57, "bust": 17, "ratedCount": 2, "unratedCount": 0 }
  }
}
```

- `boomBust` is always present with both sides. Each side has:
  - `boom`: value-weighted mean boom % (integer 0–100) or `null` if no rated assets
  - `bust`: value-weighted mean bust % (integer 0–100) or `null` if no rated assets
  - `ratedCount`: number of assets contributing to the average
  - `unratedCount`: number of assets excluded (picks, ungenerated players)
- **Descriptive only** — never an input to scale, verdict, lean, or suggestions.
- Current values are random placeholders until real computation lands (see roadmap).

**Changes from previous version:**
- **Empty side validation relaxed**: only rejects when **both** sides are empty (400: "At least one team needs an asset"). One empty side is now allowed — dropping in one player and immediately seeing what it takes to match him is the most natural first interaction.
- **`suggestions` field added** (always present, empty array when verdict is "Fair trade" or no candidate improves the trade). Each suggestion is a concrete asset that, when added to the losing side, reduces `|lean|`. See [04-trade-calculator.md](./04-trade-calculator.md#selection-algorithm-simulate-dont-filter) for the selection algorithm.

**Validation (unchanged except empty-side):**
- Unknown league type → 400
- Max 15 assets per side → 400
- Duplicate asset on both sides → 400
- Picks in Redraft league types → 400

## Comments API

Flat, anonymous, per-asset discussion threads. One thread per asset (no league_type_id, no parent_id). Comments are completely orthogonal to values — they never touch `asset_values` or `adjustment_log` (CLAUDE.md hard rule 2 applies to asset_values only).

### Schema notes
- `team_code` is **snapshotted at write time** and nullable. A user who switches their theme from Dallas to Philadelphia keeps `Anonymous Cowboys Fan` on everything they already posted. Deriving the name at read time would rewrite both halves of a past argument.
- `team_code` is NULL for Classic/no team; renders as `Anonymous Fan`. No default to a team.
- No CHECK constraint on `team_code` — validation is in the service layer against `NFL_TEAM_CODES` (from shared), so a relocation is a one-line shared change rather than a migration.
- `deleted_at` is a soft delete — the row survives, the API filters it out.
- `asset_id`, not `player_id`. Picks are assets and get threads too; no special-casing.
- The session index is for the per-session daily-count query (would otherwise scan).

### Author name composition (server-side, single source of truth)
`authorName` is composed server-side from `team_code`:
- `team_code` present → `Anonymous ${nickname} Fan` (e.g. `Anonymous Cowboys Fan`)
- `team_code` null → `Anonymous Fan`

The client must **never** build this string; one place, one format.

### Security: session_id is the auth token
`isMine` is `session_id === req.sessionId`. It drives the delete button and is the only reason the client needs to know anything about sessions.

**Never return `session_id` itself** — it's the auth token in a cookie, and echoing it into a public JSON list of everyone's comments would hand every visitor's session to every other visitor. This is the one genuine security issue in the feature.

### The cleanup trap
`cleanupRetiredPlayers()` hard-deletes assets under `PRAGMA foreign_keys = OFF`. It would orphan comment rows if it didn't also delete them. The migration-006 cleanup block deletes comments alongside `adjustment_log`, `asset_values`, and `value_history` keyed on the same `assetIds` list.

## Sessions & rate limiting

- Middleware sets `ef_session` UUID cookie if absent; upserts `sessions` row.
- Vote limits: max 1 unanswered prompt per session at a time; max 20 votes/session/day; a session never sees the same asset trio twice.

### GET /api/assets/:id

**Response:**
```json
{
  "asset_id": 123,
  "kind": "player",
  "name": "Justin Jefferson",
  "position": "WR",
  "team": "MIN",
  "age": 27,
  "status": "active",
  "boom_pct": 38,
  "bust_pct": 21,
  "overallRank": 12,
  "positionalRank": 2,
  "positionalLabel": "WR2",
  "values": [
    { "leagueType": "DYN_SF_PPR_TEP", "format": "DYN", "qb": "SF", "rec": "PPR", "tep": "TEP", "value": 994.0 },
    ...
  ],
  "history": [
    { "date": "2026-01-15", "value": 990.0, "leagueType": "DYN_SF_PPR_TEP" },
    ...
  ],
  "logs": [
    { "id": 456, "old_value": 985.0, "new_value": 990.0, "delta": 5.0, "reason": "stat", "detail": "{\"week\":1,\"points\":28.4}", "created_at": "2026-09-10T14:22:00", "leagueType": "DYN_SF_PPR_TEP" },
    ...
  ]
}
```

- `boom_pct` / `bust_pct` are **integer percentages 0–100**, independent of each other and of the 1.0–1000.0 value scale.
- For picks (`kind === 'pick'`), both are `null`.
- For players not yet processed by the generator, both are `null` (not 0).
- **Current values are random placeholders** — `npm run boom-bust:generate` fills them with deterministic seeded random integers 5–65. Real computation is deferred (see roadmap).
- `overallRank`, `positionalRank`, and `positionalLabel` are populated only when a valid `leagueType` query param is supplied and the asset has a value row for that league type. They are `null` when: the `leagueType` param is missing or unknown, the asset is a pick in a redraft league type, or the asset has no `asset_values` row for that league type. `overallRank` and `positionalRank` are integers; `positionalLabel` is a string such as `"RB2"` or `"PICK3"`.

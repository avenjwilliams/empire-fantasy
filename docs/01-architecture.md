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
  value REAL NOT NULL CHECK (value BETWEEN 1.0 AND 100.0),
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
```

Indexes: `adjustment_log(asset_id, league_type_id)`, `adjustment_log(created_at)`, `value_history(asset_id, league_type_id)`.

## API routes

```
GET  /api/league-types
GET  /api/rankings?leagueType=DYN_SF_PPR_TEP&position=RB   # sorted, with overall + positional rank
GET  /api/assets/search?q=jeff&leagueType=...              # calculator search (includes picks if DYN)
GET  /api/assets/:id?leagueType=...                        # detail + history + recent log entries
POST /api/trade/evaluate        { leagueType, team1: [assetIds], team2: [assetIds] }
GET  /api/ktc/prompt[?leagueType=CODE]                     # creates/returns prompt for session (sets session cookie)
POST /api/ktc/vote              { promptId, keep, trade, cut }
POST /api/ktc/skip              { promptId }               # mark prompt skipped, next GET /prompt yields fresh trio
GET  /api/log?assetId=&leagueType=&limit=                  # adjustment log browser
```

Trade evaluation is **stateless** (no DB write) — it reads current values and computes.

## Sessions & rate limiting

- Middleware sets `ef_session` UUID cookie if absent; upserts `sessions` row.
- Vote limits: max 1 unanswered prompt per session at a time; max 20 votes/session/day; a session never sees the same asset trio twice.

-- Migration 007: Replace boom/bust ratings with a single volatility rating on players
-- volatility_pct is an integer 0-100, NOT related to the 1.0-1000.0 value scale.
-- It is NOT written to adjustment_log (CLAUDE.md hard rule 2 applies to asset_values only).
-- It does NOT vary by league type. One volatility number per player, full stop.
-- boom_pct and bust_pct (migration 005) are removed; any existing data is dropped.
-- Table rebuild is required because SQLite cannot ALTER DROP COLUMN.
-- The rebuild preserves players(id) exactly — assets.player_id and weekly_stats.player_id
-- both reference players(id), so id values must survive. PRAGMA foreign_key_check proves it.

PRAGMA foreign_keys=off;
BEGIN TRANSACTION;

CREATE TABLE players_new (
  id INTEGER PRIMARY KEY,
  sleeper_id TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  position TEXT NOT NULL CHECK (position IN ('QB','RB','WR','TE')),
  team TEXT,
  age REAL,
  status TEXT DEFAULT 'active',
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT,
  volatility_pct INTEGER CHECK (volatility_pct IS NULL OR volatility_pct BETWEEN 0 AND 100)
);

INSERT INTO players_new (id, sleeper_id, name, position, team, age, status, created_at, updated_at, volatility_pct)
SELECT id, sleeper_id, name, position, team, age, status, created_at, updated_at, NULL
FROM players;

DROP TABLE players;
ALTER TABLE players_new RENAME TO players;

-- Verify foreign key integrity (assets.player_id, weekly_stats.player_id → players.id)
PRAGMA foreign_key_check;

COMMIT;
PRAGMA foreign_keys=on;

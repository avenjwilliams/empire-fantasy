CREATE TABLE IF NOT EXISTS players (
  id INTEGER PRIMARY KEY,
  sleeper_id TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  position TEXT NOT NULL CHECK (position IN ('QB','RB','WR','TE')),
  team TEXT,
  age REAL,
  status TEXT DEFAULT 'active',
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT
);

CREATE TABLE IF NOT EXISTS picks (
  id INTEGER PRIMARY KEY,
  season INTEGER NOT NULL,
  round INTEGER NOT NULL CHECK (round BETWEEN 1 AND 4),
  tier TEXT NOT NULL CHECK (tier IN ('EARLY','MID','LATE')),
  UNIQUE(season, round, tier)
);

CREATE TABLE IF NOT EXISTS assets (
  id INTEGER PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('player','pick')),
  player_id INTEGER REFERENCES players(id),
  pick_id INTEGER REFERENCES picks(id)
);

CREATE TABLE IF NOT EXISTS league_types (
  id INTEGER PRIMARY KEY,
  code TEXT UNIQUE NOT NULL,
  format TEXT NOT NULL,
  qb TEXT NOT NULL,
  rec TEXT NOT NULL,
  tep INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS asset_values (
  asset_id INTEGER NOT NULL REFERENCES assets(id),
  league_type_id INTEGER NOT NULL REFERENCES league_types(id),
  value REAL NOT NULL CHECK (value BETWEEN 1.0 AND 100.0),
  updated_at TEXT NOT NULL,
  PRIMARY KEY (asset_id, league_type_id)
);

CREATE TABLE IF NOT EXISTS adjustment_log (
  id INTEGER PRIMARY KEY,
  asset_id INTEGER NOT NULL REFERENCES assets(id),
  league_type_id INTEGER NOT NULL REFERENCES league_types(id),
  old_value REAL NOT NULL,
  new_value REAL NOT NULL,
  delta REAL NOT NULL,
  reason TEXT NOT NULL CHECK (reason IN ('seed','vote','stat','manual','decay')),
  detail TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS value_history (
  asset_id INTEGER NOT NULL,
  league_type_id INTEGER NOT NULL,
  date TEXT NOT NULL,
  value REAL NOT NULL,
  PRIMARY KEY (asset_id, league_type_id, date)
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  created_at TEXT DEFAULT (datetime('now')),
  last_seen_at TEXT
);

CREATE TABLE IF NOT EXISTS ktc_prompts (
  id INTEGER PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id),
  league_type_id INTEGER NOT NULL,
  asset_a INTEGER NOT NULL,
  asset_b INTEGER NOT NULL,
  asset_c INTEGER NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  answered_at TEXT
);

CREATE TABLE IF NOT EXISTS ktc_votes (
  id INTEGER PRIMARY KEY,
  prompt_id INTEGER NOT NULL REFERENCES ktc_prompts(id),
  keep_asset INTEGER NOT NULL,
  trade_asset INTEGER NOT NULL,
  cut_asset INTEGER NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS weekly_stats (
  player_id INTEGER NOT NULL REFERENCES players(id),
  season INTEGER NOT NULL,
  week INTEGER NOT NULL,
  raw JSON NOT NULL,
  PRIMARY KEY (player_id, season, week)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_adjustment_log_asset ON adjustment_log(asset_id, league_type_id);
CREATE INDEX IF NOT EXISTS idx_adjustment_log_created ON adjustment_log(created_at);
CREATE INDEX IF NOT EXISTS idx_value_history_asset ON value_history(asset_id, league_type_id);

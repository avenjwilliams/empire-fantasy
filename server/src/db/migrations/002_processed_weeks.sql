CREATE TABLE IF NOT EXISTS processed_weeks (
  season INTEGER NOT NULL,
  week INTEGER NOT NULL,
  processed_at TEXT DEFAULT (datetime('now')),
  PRIMARY KEY (season, week)
);

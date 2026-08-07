-- Migration 006: Add anonymous discussion threads for assets
-- Comments are not value changes (CLAUDE.md hard rule 2 applies to asset_values only).
-- No CHECK constraint on team_code — validation is in the service layer against NFL_TEAM_CODES.
-- team_code is nullable and snapshotted at write time; a user who changes their team keeps
-- their old author name on existing comments. No league_type_id (one thread per asset).
-- No parent_id (flat threads). deleted_at is a soft delete.

CREATE TABLE IF NOT EXISTS comments (
  id INTEGER PRIMARY KEY,
  asset_id INTEGER NOT NULL REFERENCES assets(id),
  session_id TEXT NOT NULL REFERENCES sessions(id),
  team_code TEXT,
  body TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  deleted_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_comments_asset ON comments(asset_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_comments_session ON comments(session_id, created_at);
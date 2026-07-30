-- Migration 004: Value scale 1.0–100.0 → 1.0–1000.0
-- This migration updates all value columns from the old 1-100 scale to the new 1-1000 scale.
-- Run against a copy of production DB first, verify MAX(value) ≈ 1000 and row counts preserved.

PRAGMA foreign_keys=off;
BEGIN TRANSACTION;

-- Rebuild asset_values with new CHECK constraint (SQLite cannot ALTER CHECK)
CREATE TABLE asset_values_new (
  asset_id INTEGER NOT NULL REFERENCES assets(id),
  league_type_id INTEGER NOT NULL REFERENCES league_types(id),
  value REAL NOT NULL CHECK (value BETWEEN 1.0 AND 1000.0),
  updated_at TEXT NOT NULL,
  PRIMARY KEY (asset_id, league_type_id)
);

INSERT INTO asset_values_new (asset_id, league_type_id, value, updated_at)
SELECT asset_id, league_type_id, MIN(1000.0, ROUND(value * 10, 1)), updated_at
FROM asset_values;

DROP TABLE asset_values;
ALTER TABLE asset_values_new RENAME TO asset_values;

-- Recreate indexes on asset_values (from 001_init.sql)
CREATE INDEX IF NOT EXISTS idx_asset_values_asset ON asset_values(asset_id, league_type_id);

-- Scale adjustment_log: old_value, new_value, delta
-- delta is also scaled so historical rows remain internally consistent (old + delta = new)
UPDATE adjustment_log
SET old_value = ROUND(old_value * 10, 1),
    new_value = ROUND(new_value * 10, 1),
    delta = ROUND(delta * 10, 1);

-- Scale value_history: value
UPDATE value_history
SET value = ROUND(value * 10, 1);

-- Verify foreign key integrity
PRAGMA foreign_key_check;

COMMIT;
PRAGMA foreign_keys=on;
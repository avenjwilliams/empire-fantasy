-- Migration 005: Add boom/bust ratings to players
-- Boom and bust are independent integer percentages (0-100), not related to the 1.0-1000.0 value scale.
-- They are NOT written to adjustment_log (CLAUDE.md hard rule 2 applies to asset_values only).
-- They do NOT vary by league type. One boom and one bust number per player, full stop.

ALTER TABLE players ADD COLUMN boom_pct INTEGER CHECK (boom_pct IS NULL OR boom_pct BETWEEN 0 AND 100);
ALTER TABLE players ADD COLUMN bust_pct INTEGER CHECK (bust_pct IS NULL OR bust_pct BETWEEN 0 AND 100);
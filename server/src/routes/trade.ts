import { Router } from 'express';
import { getDb } from '../db/db.js';
import { evaluateTrade, TRADE_CONSTANTS } from '@empire-fantasy/shared';

const router = Router();

router.post('/evaluate', (req, res) => {
  const db = getDb();
  const { leagueType, team1, team2 } = req.body;

  // --- Validation ---
  if (!leagueType || typeof leagueType !== 'string') {
    res.status(400).json({ error: 'leagueType is required' });
    return;
  }

  const lt = db.prepare('SELECT id, format FROM league_types WHERE code = ?').get(leagueType) as
    { id: number; format: string } | undefined;
  if (!lt) {
    res.status(400).json({ error: `Unknown league type: ${leagueType}` });
    return;
  }

  if (!Array.isArray(team1) || !Array.isArray(team2)) {
    res.status(400).json({ error: 'team1 and team2 must be arrays of asset IDs' });
    return;
  }

  if (team1.length === 0 || team2.length === 0) {
    res.status(400).json({ error: 'Both teams need at least one asset' });
    return;
  }

  if (team1.length > TRADE_CONSTANTS.MAX_ASSETS_PER_SIDE || team2.length > TRADE_CONSTANTS.MAX_ASSETS_PER_SIDE) {
    res.status(400).json({ error: `Max ${TRADE_CONSTANTS.MAX_ASSETS_PER_SIDE} assets per side` });
    return;
  }

  // Duplicate check: same asset on both sides
  const t1Set = new Set(team1);
  for (const id of team2) {
    if (t1Set.has(id)) {
      res.status(400).json({ error: `Asset ${id} appears on both sides` });
      return;
    }
  }

  const allIds = [...team1, ...team2];

  // Picks in RED check
  if (lt.format === 'RED') {
    const pickCount = db.prepare(`
      SELECT COUNT(*) as c FROM assets WHERE id IN (${allIds.map(() => '?').join(',')}) AND kind = 'pick'
    `).get(...allIds) as { c: number };
    if (pickCount.c > 0) {
      res.status(400).json({ error: 'Picks cannot be traded in Redraft league types' });
      return;
    }
  }

  // Fetch asset details with values
  const fetchAssets = (ids: number[]) => {
    if (ids.length === 0) return [];
    const placeholders = ids.map(() => '?').join(',');
    return db.prepare(`
      SELECT
        a.id,
        CASE
          WHEN a.kind = 'player' THEN p.name
          WHEN a.kind = 'pick' THEN (pk.season || ' ' || pk.tier || ' ' ||
            CASE pk.round WHEN 1 THEN '1st' WHEN 2 THEN '2nd' WHEN 3 THEN '3rd' WHEN 4 THEN '4th' END)
        END as name,
        av.value
      FROM assets a
      LEFT JOIN players p ON a.player_id = p.id
      LEFT JOIN picks pk ON a.pick_id = pk.id
      JOIN asset_values av ON av.asset_id = a.id AND av.league_type_id = ?
      WHERE a.id IN (${placeholders})
    `).all(lt.id, ...ids) as { id: number; name: string; value: number }[];
  };

  const t1Assets = fetchAssets(team1);
  const t2Assets = fetchAssets(team2);

  // Verify all IDs were found
  if (t1Assets.length !== team1.length || t2Assets.length !== team2.length) {
    res.status(400).json({ error: 'One or more asset IDs not found or missing values for this league type' });
    return;
  }

  const result = evaluateTrade({
    leagueType,
    team1: t1Assets,
    team2: t2Assets,
  });

  res.json(result);
});

export default router;

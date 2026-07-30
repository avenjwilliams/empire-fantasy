import { Router } from 'express';
import { getDb } from '../db/db.js';
import { evaluateTrade, computeTradeSuggestions, TRADE_CONSTANTS } from '@empire-fantasy/shared';
import type { TradeSuggestion } from '@empire-fantasy/shared';

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

  // Relaxed: reject only when BOTH sides are empty
  if (team1.length === 0 && team2.length === 0) {
    res.status(400).json({ error: 'At least one team needs an asset' });
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
        a.kind,
        CASE
          WHEN a.kind = 'player' THEN p.name
          WHEN a.kind = 'pick' THEN (pk.season || ' ' || pk.tier || ' ' ||
            CASE pk.round WHEN 1 THEN '1st' WHEN 2 THEN '2nd' WHEN 3 THEN '3rd' WHEN 4 THEN '4th' END)
        END as name,
        CASE WHEN a.kind = 'player' THEN p.position ELSE 'PICK' END as position,
        p.team,
        av.value
      FROM assets a
      LEFT JOIN players p ON a.player_id = p.id
      LEFT JOIN picks pk ON a.pick_id = pk.id
      JOIN asset_values av ON av.asset_id = a.id AND av.league_type_id = ?
      WHERE a.id IN (${placeholders})
    `).all(lt.id, ...ids) as { id: number; kind: string; name: string; position: string; team: string | null; value: number }[];
  };

  const t1Assets = fetchAssets(team1);
  const t2Assets = fetchAssets(team2);

  // Verify all IDs were found
  if (t1Assets.length !== team1.length || t2Assets.length !== team2.length) {
    res.status(400).json({ error: 'One or more asset IDs not found or missing values for this league type' });
    return;
  }

  const initialResult = evaluateTrade({
    leagueType,
    team1: t1Assets,
    team2: t2Assets,
  });

  // --- Compute suggestions ---
  // Fetch all candidate assets that have values for this league type
  const candidateAssets = db.prepare(`
    SELECT
      a.id,
      a.kind,
      CASE
        WHEN a.kind = 'player' THEN p.name
        WHEN a.kind = 'pick' THEN (pk.season || ' ' || pk.tier || ' ' ||
          CASE pk.round WHEN 1 THEN '1st' WHEN 2 THEN '2nd' WHEN 3 THEN '3rd' WHEN 4 THEN '4th' END)
      END as name,
      CASE WHEN a.kind = 'player' THEN p.position ELSE 'PICK' END as position,
      p.team,
      av.value
    FROM assets a
    LEFT JOIN players p ON a.player_id = p.id
    LEFT JOIN picks pk ON a.pick_id = pk.id
    JOIN asset_values av ON av.asset_id = a.id AND av.league_type_id = ?
    WHERE a.id NOT IN (${allIds.map(() => '?').join(',') || '0'})
  `).all(lt.id, ...allIds) as { id: number; kind: string; name: string; position: string; team: string | null; value: number }[];

  // Compute suggestions using the simulation approach
  const suggestions = computeTradeSuggestions({
    leagueType,
    team1: t1Assets,
    team2: t2Assets,
    candidates: candidateAssets,
    initialResult: {
      diff: initialResult.team1.sideValue - initialResult.team2.sideValue,
      total: initialResult.team1.sideValue + initialResult.team2.sideValue,
      lean: (initialResult.team1.sideValue - initialResult.team2.sideValue) / Math.max(initialResult.team1.sideValue + initialResult.team2.sideValue, 1),
      verdict: initialResult.verdict,
      team1Length: t1Assets.length,
      team2Length: t2Assets.length,
    },
  });

  const resultWithSuggestions = {
    ...initialResult,
    suggestions,
  };

  res.json(resultWithSuggestions);
});

export default router;

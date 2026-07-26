import { Router } from 'express';
import { getDb } from '../db/db.js';

const router = Router();

router.get('/', (req, res) => {
  const db = getDb();
  const { leagueType, position } = req.query;

  if (!leagueType || typeof leagueType !== 'string') {
    res.status(400).json({ error: 'leagueType query parameter is required' });
    return;
  }

  const lt = db.prepare('SELECT id, format FROM league_types WHERE code = ?').get(leagueType) as
    { id: number; format: string } | undefined;

  if (!lt) {
    res.status(400).json({ error: `Unknown league type: ${leagueType}` });
    return;
  }

  const isDynasty = lt.format === 'DYN';

  let posFilter = '';
  const params: any[] = [lt.id];

  if (position && typeof position === 'string' && position !== 'ALL') {
    if (position === 'PICKS') {
      posFilter = "AND a.kind = 'pick'";
    } else {
      posFilter = "AND a.kind = 'player' AND p.position = ?";
      params.push(position);
    }
  }

  const rows = db.prepare(`
    SELECT
      a.id as asset_id,
      a.kind,
      CASE
        WHEN a.kind = 'player' THEN p.name
        WHEN a.kind = 'pick' THEN (pk.season || ' ' || pk.tier || ' ' ||
          CASE pk.round WHEN 1 THEN '1st' WHEN 2 THEN '2nd' WHEN 3 THEN '3rd' WHEN 4 THEN '4th' END)
      END as name,
      CASE
        WHEN a.kind = 'player' THEN p.position
        WHEN a.kind = 'pick' THEN 'PICK'
      END as position,
      CASE
        WHEN a.kind = 'player' THEN p.team
        ELSE NULL
      END as team,
      CASE
        WHEN a.kind = 'player' THEN p.age
        ELSE NULL
      END as age,
      av.value
    FROM asset_values av
    JOIN assets a ON a.id = av.asset_id
    LEFT JOIN players p ON a.player_id = p.id
    LEFT JOIN picks pk ON a.pick_id = pk.id
    WHERE av.league_type_id = ?
      AND (a.kind = 'player' OR (a.kind = 'pick' AND ${isDynasty ? '1' : '0'} = 1))
      ${posFilter}
    ORDER BY av.value DESC
  `).all(...params) as any[];

  // Compute overall rank and positional rank
  let overallRank = 0;
  const posRankCounters: Record<string, number> = {};

  const result = rows.map(row => {
    overallRank++;
    const pos = row.position as string;
    posRankCounters[pos] = (posRankCounters[pos] || 0) + 1;

    return {
      ...row,
      overallRank,
      positionalRank: posRankCounters[pos],
      positionalLabel: pos === 'PICK' ? `PICK${posRankCounters[pos]}` : `${pos}${posRankCounters[pos]}`,
    };
  });

  res.json(result);
});

export default router;

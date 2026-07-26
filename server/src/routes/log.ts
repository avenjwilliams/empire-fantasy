import { Router } from 'express';
import { getDb } from '../db/db.js';

const router = Router();

router.get('/', (req, res) => {
  const db = getDb();
  const { assetId, leagueType, reason, limit: limitStr, offset: offsetStr } = req.query;

  const conditions: string[] = [];
  const params: any[] = [];

  if (assetId && typeof assetId === 'string') {
    const id = parseInt(assetId, 10);
    if (!isNaN(id)) {
      conditions.push('al.asset_id = ?');
      params.push(id);
    }
  }

  if (leagueType && typeof leagueType === 'string') {
    const lt = db.prepare('SELECT id FROM league_types WHERE code = ?').get(leagueType) as
      { id: number } | undefined;
    if (lt) {
      conditions.push('al.league_type_id = ?');
      params.push(lt.id);
    }
  }

  if (reason && typeof reason === 'string') {
    conditions.push('al.reason = ?');
    params.push(reason);
  }

  const where = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : '';
  const limit = Math.min(parseInt(limitStr as string, 10) || 50, 200);
  const offset = parseInt(offsetStr as string, 10) || 0;

  const rows = db.prepare(`
    SELECT
      al.id, al.asset_id, al.old_value, al.new_value, al.delta,
      al.reason, al.detail, al.created_at,
      lt.code as leagueType,
      CASE
        WHEN a.kind = 'player' THEN p.name
        WHEN a.kind = 'pick' THEN (pk.season || ' ' || pk.tier || ' ' ||
          CASE pk.round WHEN 1 THEN '1st' WHEN 2 THEN '2nd' WHEN 3 THEN '3rd' WHEN 4 THEN '4th' END)
      END as assetName,
      CASE
        WHEN a.kind = 'player' THEN p.position
        WHEN a.kind = 'pick' THEN 'PICK'
      END as position
    FROM adjustment_log al
    JOIN league_types lt ON lt.id = al.league_type_id
    JOIN assets a ON a.id = al.asset_id
    LEFT JOIN players p ON a.player_id = p.id
    LEFT JOIN picks pk ON a.pick_id = pk.id
    ${where}
    ORDER BY al.created_at DESC, al.id DESC
    LIMIT ? OFFSET ?
  `).all(...params, limit, offset);

  const total = db.prepare(`
    SELECT COUNT(*) as count FROM adjustment_log al ${where}
  `).get(...params) as { count: number };

  res.json({ rows, total: total.count, limit, offset });
});

export default router;

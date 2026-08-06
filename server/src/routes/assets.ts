import { Router } from 'express';
import { getDb } from '../db/db.js';

const router = Router();

// Asset search for calculator typeahead
router.get('/search', (req, res) => {
  const db = getDb();
  const { q, leagueType } = req.query;

  if (!q || typeof q !== 'string' || !leagueType || typeof leagueType !== 'string') {
    res.status(400).json({ error: 'q and leagueType query parameters required' });
    return;
  }

  const lt = db.prepare('SELECT id, format FROM league_types WHERE code = ?').get(leagueType) as
    { id: number; format: string } | undefined;

  if (!lt) {
    res.status(400).json({ error: `Unknown league type: ${leagueType}` });
    return;
  }

  const isDynasty = lt.format === 'DYN';
  const searchTerm = `%${q.toLowerCase()}%`;

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
      AND (a.kind = 'player' OR (a.kind = 'pick' AND ? = 1))
      AND (
        (a.kind = 'player' AND LOWER(p.name) LIKE ?)
        OR
        (a.kind = 'pick' AND (
          CAST(pk.season AS TEXT) || ' ' || pk.tier || ' ' ||
          CASE pk.round WHEN 1 THEN '1st' WHEN 2 THEN '2nd' WHEN 3 THEN '3rd' WHEN 4 THEN '4th' END
        ) LIKE ?)
      )
    ORDER BY av.value DESC
    LIMIT 20
  `).all(lt.id, isDynasty ? 1 : 0, searchTerm, searchTerm);

  res.json(rows);
});

// Asset detail
router.get('/:id', (req, res) => {
  const db = getDb();
  const assetId = parseInt(req.params.id, 10);
  const { leagueType } = req.query;

  if (isNaN(assetId)) {
    res.status(400).json({ error: 'Invalid asset id' });
    return;
  }

  // Get asset basic info
  const asset = db.prepare(`
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
      CASE
        WHEN a.kind = 'player' THEN p.status
        ELSE NULL
      END as status,
      CASE WHEN a.kind = 'player' THEN p.boom_pct ELSE NULL END as boom_pct,
      CASE WHEN a.kind = 'player' THEN p.bust_pct ELSE NULL END as bust_pct
    FROM assets a
    LEFT JOIN players p ON a.player_id = p.id
    LEFT JOIN picks pk ON a.pick_id = pk.id
    WHERE a.id = ?
  `).get(assetId) as any;

  if (!asset) {
    res.status(404).json({ error: 'Asset not found' });
    return;
  }

  // Get values across all 24 league types
  const values = db.prepare(`
    SELECT
      lt.code as leagueType,
      lt.format, lt.qb, lt.rec,
      CASE lt.tep WHEN 1 THEN 'TEP' ELSE 'STD' END as tep,
      av.value
    FROM asset_values av
    JOIN league_types lt ON lt.id = av.league_type_id
    WHERE av.asset_id = ?
    ORDER BY lt.code
  `).all(assetId);

  // Get value history (for chart)
  let historyFilter = '';
  const historyParams: any[] = [assetId];
  if (leagueType && typeof leagueType === 'string') {
    const lt = db.prepare('SELECT id FROM league_types WHERE code = ?').get(leagueType) as
      { id: number } | undefined;
    if (lt) {
      historyFilter = 'AND vh.league_type_id = ?';
      historyParams.push(lt.id);
    }
  }

  const history = db.prepare(`
    SELECT vh.date, vh.value, lt.code as leagueType
    FROM value_history vh
    JOIN league_types lt ON lt.id = vh.league_type_id
    WHERE vh.asset_id = ? ${historyFilter}
    ORDER BY vh.date DESC
    LIMIT 365
  `).all(...historyParams);

  // Get recent log entries
  const logs = db.prepare(`
    SELECT
      al.id, al.old_value, al.new_value, al.delta, al.reason, al.detail, al.created_at,
      lt.code as leagueType
    FROM adjustment_log al
    JOIN league_types lt ON lt.id = al.league_type_id
    WHERE al.asset_id = ?
    ORDER BY al.created_at DESC
    LIMIT 50
  `).all(assetId);

  // Ranks relative to the league type, using the same eligibility rule and
  // ordering as GET /api/rankings (but with an a.id ASC deterministic tie-break).
  // Returns null for all three when the rank is undefined for this request.
  let overallRank: number | null = null;
  let positionalRank: number | null = null;
  let positionalLabel: string | null = null;

  if (leagueType && typeof leagueType === 'string') {
    const lt = db.prepare('SELECT id, format FROM league_types WHERE code = ?').get(leagueType) as
      { id: number; format: string } | undefined;

    if (lt) {
      const isDynasty = lt.format === 'DYN';
      const isPick = asset.kind === 'pick';

      // Picks are only ranked in dynasty league types.
      if ((!isPick || isDynasty)) {
        // The asset must have a value in this league type to have a rank.
        const valueRow = db.prepare(`
          SELECT av.value
          FROM asset_values av
          WHERE av.asset_id = ? AND av.league_type_id = ?
        `).get(assetId, lt.id) as { value: number } | undefined;

        if (valueRow) {
          const value = valueRow.value;
          const eligibility = "(a.kind = 'player' OR (a.kind = 'pick' AND ? = 1))";

          // Standard competition ranking with a.id ASC tie-break: rank = 1 + the
          // number of eligible assets before this one in (value DESC, id ASC) order.
          const overall = db.prepare(`
            SELECT COUNT(*) as c
            FROM asset_values av
            JOIN assets a ON a.id = av.asset_id
            WHERE av.league_type_id = ?
              AND ${eligibility}
              AND (av.value > ? OR (av.value = ? AND a.id < ?))
          `).get(lt.id, isDynasty ? 1 : 0, value, value, assetId) as { c: number };
          overallRank = overall.c + 1;

          // Positional bucket: 'PICK' is its own position; players use p.position.
          let positionCount: number;
          if (isPick) {
            const pos = db.prepare(`
              SELECT COUNT(*) as c
              FROM asset_values av
              JOIN assets a ON a.id = av.asset_id
              WHERE av.league_type_id = ?
                AND ${eligibility}
                AND a.kind = 'pick'
                AND (av.value > ? OR (av.value = ? AND a.id < ?))
            `).get(lt.id, isDynasty ? 1 : 0, value, value, assetId) as { c: number };
            positionCount = pos.c;
          } else {
            const pos = db.prepare(`
              SELECT COUNT(*) as c
              FROM asset_values av
              JOIN assets a ON a.id = av.asset_id
              JOIN players p ON a.player_id = p.id
              WHERE av.league_type_id = ?
                AND ${eligibility}
                AND a.kind = 'player' AND p.position = ?
                AND (av.value > ? OR (av.value = ? AND a.id < ?))
            `).get(lt.id, isDynasty ? 1 : 0, asset.position, value, value, assetId) as { c: number };
            positionCount = pos.c;
          }
          positionalRank = positionCount + 1;
          positionalLabel = isPick
            ? `PICK${positionalRank}`
            : `${asset.position}${positionalRank}`;
        }
      }
    }
  }

  res.json({ ...asset, values, history, logs, overallRank, positionalRank, positionalLabel });
});

export default router;

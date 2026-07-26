import { Router } from 'express';
import { getDb } from '../db/db.js';

const router = Router();

router.get('/', (_req, res) => {
  const db = getDb();
  const rows = db.prepare(`
    SELECT id, code, format, qb, rec,
      CASE tep WHEN 1 THEN 'TEP' ELSE 'STD' END as tep
    FROM league_types ORDER BY code
  `).all();
  res.json(rows);
});

export default router;

import { Router } from 'express';
import { getDb } from '../db/db.js';
import { generatePrompt, applyVote } from '../services/voteService.js';

const router = Router();

router.get('/prompt', (req, res) => {
  const db = getDb();
  const result = generatePrompt(db, req.sessionId);

  if ('error' in result) {
    res.status(result.code).json({ error: result.error });
    return;
  }

  res.json(result);
});

router.post('/vote', (req, res) => {
  const db = getDb();
  const { promptId, keep, trade, cut } = req.body;

  if (!promptId || !keep || !trade || !cut) {
    res.status(400).json({ error: 'promptId, keep, trade, and cut are required' });
    return;
  }

  const result = applyVote(db, req.sessionId, promptId, keep, trade, cut);

  if (!result.success) {
    res.status(result.code || 400).json({ error: result.error });
    return;
  }

  res.json({ success: true });
});

export default router;

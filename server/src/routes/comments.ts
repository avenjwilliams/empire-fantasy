import { Router, type Request, type Response } from 'express';
import { getDb } from '../db/db.js';
import {
  listComments,
  createComment,
  deleteComment,
  MAX_COMMENT_LENGTH,
  MAX_COMMENTS_PER_DAY,
} from '../services/commentService.js';

const router = Router();

// GET /api/comments/:assetId
router.get('/:assetId', (req: Request, res: Response) => {
  const db = getDb();
  const assetId = parseInt(req.params.assetId, 10);
  const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : undefined;
  const offset = req.query.offset ? parseInt(req.query.offset as string, 10) : undefined;

  if (isNaN(assetId)) {
    res.status(400).json({ error: 'Invalid asset id' });
    return;
  }

  const result = listComments(db, assetId, { limit, offset, sessionId: req.sessionId });
  res.json(result);
});

// POST /api/comments/:assetId
router.post('/:assetId', (req: Request, res: Response) => {
  const db = getDb();
  const assetId = parseInt(req.params.assetId, 10);
  const { body, teamCode } = req.body;

  if (isNaN(assetId)) {
    res.status(400).json({ error: 'Invalid asset id' });
    return;
  }

  const result = createComment(db, {
    assetId,
    sessionId: req.sessionId,
    teamCode,
    body: body ?? '',
  });

  if ('error' in result) {
    res.status(result.code).json({ error: result.error });
    return;
  }

  res.status(201).json(result);
});

// DELETE /api/comments/:commentId
router.delete('/:commentId', (req: Request, res: Response) => {
  const db = getDb();
  const commentId = parseInt(req.params.commentId, 10);

  if (isNaN(commentId)) {
    res.status(400).json({ error: 'Invalid comment id' });
    return;
  }

  const result = deleteComment(db, { commentId, sessionId: req.sessionId });

  if ('error' in result) {
    res.status(result.code).json({ error: result.error });
    return;
  }

  res.status(204).send();
});

export default router;
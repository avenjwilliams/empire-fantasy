import type { Request, Response, NextFunction } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { getDb } from '../db/db.js';

const COOKIE_NAME = 'ef_session';
const COOKIE_MAX_AGE = 365 * 24 * 60 * 60 * 1000; // 1 year

declare global {
  namespace Express {
    interface Request {
      sessionId: string;
    }
  }
}

export function sessionMiddleware(req: Request, res: Response, next: NextFunction): void {
  const db = getDb();
  let sessionId = req.cookies?.[COOKIE_NAME];

  if (!sessionId) {
    sessionId = uuidv4();
    res.cookie(COOKIE_NAME, sessionId, {
      httpOnly: true,
      maxAge: COOKIE_MAX_AGE,
      sameSite: 'lax',
    });
    db.prepare(
      'INSERT INTO sessions (id) VALUES (?)'
    ).run(sessionId);
  } else {
    // Upsert: create if missing, update last_seen_at
    db.prepare(
      `INSERT INTO sessions (id, last_seen_at) VALUES (?, datetime('now'))
       ON CONFLICT(id) DO UPDATE SET last_seen_at = datetime('now')`
    ).run(sessionId);
  }

  req.sessionId = sessionId;
  next();
}

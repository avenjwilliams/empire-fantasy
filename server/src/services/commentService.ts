import type Database from 'better-sqlite3';
import { NFL_TEAMS, NFL_TEAM_CODES, teamNickname } from '@empire-fantasy/shared';

/** Matches MAX_VOTES_PER_DAY in voteService.ts — independent caps that happen to coincide. */
export const MAX_COMMENTS_PER_DAY = 20;
export const MAX_COMMENT_LENGTH = 1000;

export interface CommentRow {
  id: number;
  asset_id: number;
  session_id: string;
  team_code: string | null;
  body: string;
  created_at: string;
  deleted_at: string | null;
}

export interface CommentPublic {
  id: number;
  asset_id: number;
  team_code: string | null;
  body: string;
  created_at: string;
  deleted_at: string | null;
  authorName: string;
  isMine: boolean;
}

export interface ListCommentsResult {
  comments: CommentPublic[];
  total: number;
}

function composeAuthorName(teamCode: string | null): string {
  const nick = teamNickname(teamCode);
  return nick ? `Anonymous ${nick} Fan` : 'Anonymous Fan';
}

function validateTeamCode(code: string | null | undefined): string | null {
  if (code === null || code === undefined) return null;
  if (NFL_TEAM_CODES.includes(code)) return code;
  throw new Error('INVALID_TEAM_CODE');
}

export function listComments(
  db: Database.Database,
  assetId: number,
  options: { limit?: number; offset?: number; sessionId?: string } = {}
): ListCommentsResult {
  const limit = Math.min(Math.max(options.limit ?? 50, 1), 100);
  const offset = Math.max(options.offset ?? 0, 0);

  const total = db
    .prepare('SELECT COUNT(*) as c FROM comments WHERE asset_id = ? AND deleted_at IS NULL')
    .get(assetId) as { c: number };

  const rows = db
    .prepare(
      `SELECT id, asset_id, session_id, team_code, body, created_at, deleted_at
       FROM comments
       WHERE asset_id = ? AND deleted_at IS NULL
       ORDER BY created_at DESC, id DESC
       LIMIT ? OFFSET ?`
    )
    .all(assetId, limit, offset) as CommentRow[];

  const comments = rows.map(r => {
    // Never return session_id — it's the auth token in a cookie
    const { session_id, ...rest } = r;
    return {
      ...rest,
      authorName: composeAuthorName(r.team_code),
      isMine: options.sessionId ? r.session_id === options.sessionId : false,
    };
  });

  return { comments, total: total.c };
}

export function createComment(
  db: Database.Database,
  input: { assetId: number; sessionId: string; teamCode: string | null; body: string }
): CommentPublic | { error: string; code: number } {
  // Validate asset exists
  const asset = db.prepare('SELECT id FROM assets WHERE id = ?').get(input.assetId);
  if (!asset) return { error: 'Asset not found', code: 404 };

  // Validate body
  const trimmed = input.body.trim();
  if (!trimmed) return { error: 'Body cannot be empty', code: 400 };
  if (trimmed.length > MAX_COMMENT_LENGTH) return { error: 'Body too long', code: 400 };

  // Validate team code
  let teamCode: string | null;
  try {
    teamCode = validateTeamCode(input.teamCode);
  } catch {
    return { error: 'Invalid team code', code: 400 };
  }

  // Daily cap: count non-deleted comments from this session in the last 24h
  const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 19).replace('T', ' ');
  const count = db
    .prepare(
      `SELECT COUNT(*) as c
       FROM comments
       WHERE session_id = ? AND deleted_at IS NULL AND created_at > ?`
    )
    .get(input.sessionId, dayAgo) as { c: number };

  if (count.c >= MAX_COMMENTS_PER_DAY) {
    return { error: 'Daily comment limit reached', code: 429 };
  }

  const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
  const result = db
    .prepare(
      `INSERT INTO comments (asset_id, session_id, team_code, body, created_at)
       VALUES (?, ?, ?, ?, ?)`
    )
    .run(input.assetId, input.sessionId, teamCode, trimmed, now);

  const commentId = Number(result.lastInsertRowid);
  const created = db
    .prepare(
      `SELECT id, asset_id, session_id, team_code, body, created_at, deleted_at
       FROM comments WHERE id = ?`
    )
    .get(commentId) as CommentRow;

  // Never return session_id — it's the auth token in a cookie
  const { session_id, ...rest } = created;
  return {
    ...rest,
    authorName: composeAuthorName(teamCode),
    isMine: true,
  };
}

export function deleteComment(
  db: Database.Database,
  input: { commentId: number; sessionId: string }
): { success: true } | { error: string; code: number } {
  const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
  const result = db
    .prepare(
      `UPDATE comments SET deleted_at = ? WHERE id = ? AND session_id = ? AND deleted_at IS NULL`
    )
    .run(now, input.commentId, input.sessionId);

  if (result.changes === 0) {
    return { error: 'Comment not found', code: 404 };
  }

  return { success: true };
}
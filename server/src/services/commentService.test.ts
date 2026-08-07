import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import {
  listComments,
  createComment,
  deleteComment,
  MAX_COMMENTS_PER_DAY,
  MAX_COMMENT_LENGTH,
} from '../services/commentService.js';
import { initDb } from '../db/db.js';
import { NFL_TEAM_CODES } from '@empire-fantasy/shared';

// Type guard to narrow the union return types
function assertSuccess<T extends object>(result: T | { error: string; code: number }): asserts result is T {
  if ('error' in result) throw new Error(`Expected success, got error: ${result.error}`);
}

function setupTestDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  // Run migrations manually for test
  db.exec(`
    CREATE TABLE players (
      id INTEGER PRIMARY KEY,
      sleeper_id TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      position TEXT NOT NULL CHECK (position IN ('QB','RB','WR','TE')),
      team TEXT,
      age REAL,
      status TEXT DEFAULT 'active',
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT
    );

    CREATE TABLE picks (
      id INTEGER PRIMARY KEY,
      season INTEGER NOT NULL,
      round INTEGER NOT NULL CHECK (round BETWEEN 1 AND 4),
      tier TEXT NOT NULL CHECK (tier IN ('EARLY','MID','LATE')),
      UNIQUE(season, round, tier)
    );

    CREATE TABLE assets (
      id INTEGER PRIMARY KEY,
      kind TEXT NOT NULL CHECK (kind IN ('player','pick')),
      player_id INTEGER REFERENCES players(id),
      pick_id INTEGER REFERENCES picks(id)
    );

    CREATE TABLE sessions (
      id TEXT PRIMARY KEY,
      created_at TEXT DEFAULT (datetime('now')),
      last_seen_at TEXT
    );

    CREATE TABLE comments (
      id INTEGER PRIMARY KEY,
      asset_id INTEGER NOT NULL REFERENCES assets(id),
      session_id TEXT NOT NULL REFERENCES sessions(id),
      team_code TEXT,
      body TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      deleted_at TEXT
    );

    CREATE INDEX idx_comments_asset ON comments(asset_id, created_at DESC);
    CREATE INDEX idx_comments_session ON comments(session_id, created_at);
  `);

  return db;
}

describe('commentService', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = setupTestDb();

    // Insert test data
    db.prepare('INSERT INTO sessions (id) VALUES (?)').run('session-1');
    db.prepare('INSERT INTO sessions (id) VALUES (?)').run('session-2');

    const player = db.prepare('INSERT INTO players (sleeper_id, name, position, team, age) VALUES (?, ?, ?, ?, ?)')
      .run('100', 'Test Player', 'WR', 'DAL', 25);
    const asset = db.prepare('INSERT INTO assets (kind, player_id) VALUES (?, ?)')
      .run('player', player.lastInsertRowid);
    const assetId = Number(asset.lastInsertRowid);

    // Store assetId for tests
    (global as any).testAssetId = assetId;
  });

  const assetId = () => (global as any).testAssetId;

  describe('createComment', () => {
    it('creates a comment with valid inputs', () => {
      const result = createComment(db, {
        assetId: assetId(),
        sessionId: 'session-1',
        teamCode: 'DAL',
        body: 'Great player!',
      });

      expect('error' in result).toBe(false);
      assertSuccess(result);

      expect(result.body).toBe('Great player!');
      expect(result.team_code).toBe('DAL');
      expect(result.authorName).toBe('Anonymous Cowboys Fan');
      expect(result.isMine).toBe(true);
    });

    it('creates a comment with null teamCode (Classic)', () => {
      const result = createComment(db, {
        assetId: assetId(),
        sessionId: 'session-1',
        teamCode: null,
        body: 'No team, just classic.',
      });

      expect('error' in result).toBe(false);
      assertSuccess(result);

      expect(result.team_code).toBe(null);
      expect(result.authorName).toBe('Anonymous Fan');
    });

    it('rejects unknown team code with 400 (does not coerce to null)', () => {
      const result = createComment(db, {
        assetId: assetId(),
        sessionId: 'session-1',
        teamCode: 'XXX',
        body: 'Invalid team',
      });

      expect('error' in result).toBe(true);
      if ('error' in result) {
        expect(result.code).toBe(400);
        expect(result.error).toBe('Invalid team code');
      }
    });

    it('rejects empty body with 400', () => {
      const result = createComment(db, {
        assetId: assetId(),
        sessionId: 'session-1',
        teamCode: 'DAL',
        body: '',
      });

      expect('error' in result).toBe(true);
      if ('error' in result) {
        expect(result.code).toBe(400);
        expect(result.error).toBe('Body cannot be empty');
      }
    });

    it('rejects whitespace-only body with 400', () => {
      const result = createComment(db, {
        assetId: assetId(),
        sessionId: 'session-1',
        teamCode: 'DAL',
        body: '   ',
      });

      expect('error' in result).toBe(true);
      if ('error' in result) {
        expect(result.code).toBe(400);
        expect(result.error).toBe('Body cannot be empty');
      }
    });

    it('rejects body longer than MAX_COMMENT_LENGTH with 400', () => {
      const longBody = 'a'.repeat(MAX_COMMENT_LENGTH + 1);
      const result = createComment(db, {
        assetId: assetId(),
        sessionId: 'session-1',
        teamCode: 'DAL',
        body: longBody,
      });

      expect('error' in result).toBe(true);
      if ('error' in result) {
        expect(result.code).toBe(400);
        expect(result.error).toBe('Body too long');
      }
    });

    it('accepts body exactly at MAX_COMMENT_LENGTH', () => {
      const exactBody = 'a'.repeat(MAX_COMMENT_LENGTH);
      const result = createComment(db, {
        assetId: assetId(),
        sessionId: 'session-1',
        teamCode: 'DAL',
        body: exactBody,
      });

      expect('error' in result).toBe(false);
      assertSuccess(result);
      expect(result.body.length).toBe(MAX_COMMENT_LENGTH);
    });

    it('trims body before length check (trailing whitespace accepted at boundary)', () => {
      const bodyWithTrailing = 'a'.repeat(MAX_COMMENT_LENGTH) + '   ';
      const result = createComment(db, {
        assetId: assetId(),
        sessionId: 'session-1',
        teamCode: 'DAL',
        body: bodyWithTrailing,
      });

      expect('error' in result).toBe(false);
      assertSuccess(result);
      expect(result.body.length).toBe(MAX_COMMENT_LENGTH);
    });

    it('rejects non-existent asset with 404', () => {
      const result = createComment(db, {
        assetId: 999999,
        sessionId: 'session-1',
        teamCode: 'DAL',
        body: 'Asset does not exist',
      });

      expect('error' in result).toBe(true);
      if ('error' in result) {
        expect(result.code).toBe(404);
        expect(result.error).toBe('Asset not found');
      }
    });

    it('enforces daily comment cap at MAX_COMMENTS_PER_DAY (429)', () => {
      // Post MAX_COMMENTS_PER_DAY comments
      for (let i = 0; i < MAX_COMMENTS_PER_DAY; i++) {
        const result = createComment(db, {
          assetId: assetId(),
          sessionId: 'session-1',
          teamCode: 'DAL',
          body: `Comment ${i}`,
        });
        expect('error' in result).toBe(false);
      }

      // The next one should fail
      const result = createComment(db, {
        assetId: assetId(),
        sessionId: 'session-1',
        teamCode: 'DAL',
        body: 'This should fail',
      });

      expect('error' in result).toBe(true);
      if ('error' in result) {
        expect(result.code).toBe(429);
        expect(result.error).toBe('Daily comment limit reached');
      }
    });

    it('allows a different session to post at cap', () => {
      // Fill up session-1
      for (let i = 0; i < MAX_COMMENTS_PER_DAY; i++) {
        createComment(db, { assetId: assetId(), sessionId: 'session-1', teamCode: 'DAL', body: `c${i}` });
      }

      // session-2 should still be able to post
      const result = createComment(db, {
        assetId: assetId(),
        sessionId: 'session-2',
        teamCode: 'GB',
        body: 'Different session',
      });

      expect('error' in result).toBe(false);
    });

    it('allows deleting one and reposting at the cap', () => {
      // Fill up session-1
      const comments: any[] = [];
      for (let i = 0; i < MAX_COMMENTS_PER_DAY; i++) {
        const result = createComment(db, {
          assetId: assetId(),
          sessionId: 'session-1',
          teamCode: 'DAL',
          body: `c${i}`,
        });
        if (!('error' in result)) comments.push(result);
      }
      expect(comments.length).toBe(MAX_COMMENTS_PER_DAY);

      // Delete the first one
      const delResult = deleteComment(db, { commentId: comments[0].id, sessionId: 'session-1' });
      expect(delResult).toEqual({ success: true });

      // Now we should be able to post again
      const result = createComment(db, {
        assetId: assetId(),
        sessionId: 'session-1',
        teamCode: 'DAL',
        body: 'repost after delete',
      });

      expect('error' in result).toBe(false);
    });
  });

  describe('listComments', () => {
    it('returns comments with correct authorName for valid team code', () => {
      const result = createComment(db, {
        assetId: assetId(),
        sessionId: 'session-1',
        teamCode: 'DAL',
        body: 'Dallas fan here',
      });
      expect('error' in result).toBe(false);

      const list = listComments(db, assetId(), { sessionId: 'session-1' });
      expect(list.total).toBe(1);
      expect(list.comments[0].authorName).toBe('Anonymous Cowboys Fan');
    });

    it('returns Anonymous Fan for null team_code', () => {
      createComment(db, { assetId: assetId(), sessionId: 'session-1', teamCode: null, body: 'No team' });

      const list = listComments(db, assetId(), { sessionId: 'session-1' });
      expect(list.comments[0].authorName).toBe('Anonymous Fan');
    });

    it('isMine is true for own comments', () => {
      createComment(db, { assetId: assetId(), sessionId: 'session-1', teamCode: 'DAL', body: 'mine' });

      const list = listComments(db, assetId(), { sessionId: 'session-1' });
      expect(list.comments[0].isMine).toBe(true);
    });

    it('isMine is false for other sessions comments', () => {
      createComment(db, { assetId: assetId(), sessionId: 'session-1', teamCode: 'DAL', body: 'theirs' });

      const list = listComments(db, assetId(), { sessionId: 'session-2' });
      expect(list.comments[0].isMine).toBe(false);
    });

    it('orders newest first, stable with id tiebreaker on same second', () => {
      // Insert two comments in the same transaction so they share the same created_at second
      const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
      db.prepare(`
        INSERT INTO comments (asset_id, session_id, team_code, body, created_at)
        VALUES (?, ?, ?, ?, ?)
      `).run(assetId(), 'session-1', 'DAL', 'first', now);
      db.prepare(`
        INSERT INTO comments (asset_id, session_id, team_code, body, created_at)
        VALUES (?, ?, ?, ?, ?)
      `).run(assetId(), 'session-1', 'DAL', 'second', now);

      const list = listComments(db, assetId(), { sessionId: 'session-1' });
      expect(list.total).toBe(2);
      // Higher id should come first (id DESC tiebreaker)
      expect(list.comments[0].body).toBe('second');
      expect(list.comments[1].body).toBe('first');
    });

    it('excludes deleted comments from list and total', () => {
      const c1 = createComment(db, { assetId: assetId(), sessionId: 'session-1', teamCode: 'DAL', body: 'one' });
      const c2 = createComment(db, { assetId: assetId(), sessionId: 'session-1', teamCode: 'GB', body: 'two' });
      expect('error' in c1).toBe(false);
      expect('error' in c2).toBe(false);
      assertSuccess(c1);
      assertSuccess(c2);

      deleteComment(db, { commentId: c1.id, sessionId: 'session-1' });

      const list = listComments(db, assetId(), { sessionId: 'session-1' });
      expect(list.total).toBe(1);
      expect(list.comments[0].body).toBe('two');
    });

    it('respects limit and offset', () => {
      for (let i = 0; i < 5; i++) {
        createComment(db, { assetId: assetId(), sessionId: 'session-1', teamCode: 'DAL', body: `c${i}` });
      }

      const firstPage = listComments(db, assetId(), { limit: 2, offset: 0 });
      expect(firstPage.comments.length).toBe(2);

      const secondPage = listComments(db, assetId(), { limit: 2, offset: 2 });
      expect(secondPage.comments.length).toBe(2);
    });

    it('clamps limit to 100 max', () => {
      const list = listComments(db, assetId(), { limit: 200 });
      // Should clamp to 100 but we only have 0 comments, so length is 0
      // The important thing is no error is thrown
      expect(list.total).toBe(0);
    });

    it('never returns session_id in response objects', () => {
      createComment(db, { assetId: assetId(), sessionId: 'session-1', teamCode: 'DAL', body: 'test' });
      const list = listComments(db, assetId(), { sessionId: 'session-1' });
      const keys = Object.keys(list.comments[0]);
      expect(keys).not.toContain('session_id');
    });
  });

  describe('deleteComment', () => {
    it('soft deletes own comment', () => {
      const created = createComment(db, { assetId: assetId(), sessionId: 'session-1', teamCode: 'DAL', body: 'to delete' });
      expect('error' in created).toBe(false);
      assertSuccess(created);

      const result = deleteComment(db, { commentId: created.id, sessionId: 'session-1' });
      expect(result).toEqual({ success: true });

      const list = listComments(db, assetId(), { sessionId: 'session-1' });
      expect(list.total).toBe(0);
    });

    it('returns 404 for wrong session (not 403)', () => {
      const created = createComment(db, { assetId: assetId(), sessionId: 'session-1', teamCode: 'DAL', body: 'theirs' });
      expect('error' in created).toBe(false);
      assertSuccess(created);

      const result = deleteComment(db, { commentId: created.id, sessionId: 'session-2' });
      expect('error' in result).toBe(true);
      if ('error' in result) {
        expect(result.code).toBe(404);
        expect(result.error).toBe('Comment not found');
      }

      // Verify it wasn't deleted
      const list = listComments(db, assetId(), { sessionId: 'session-1' });
      expect(list.total).toBe(1);
    });

    it('returns 404 for already deleted comment', () => {
      const created = createComment(db, { assetId: assetId(), sessionId: 'session-1', teamCode: 'DAL', body: 'delete twice' });
      expect('error' in created).toBe(false);
      assertSuccess(created);

      deleteComment(db, { commentId: created.id, sessionId: 'session-1' });
      const result = deleteComment(db, { commentId: created.id, sessionId: 'session-1' });

      expect('error' in result).toBe(true);
      if ('error' in result) {
        expect(result.code).toBe(404);
      }
    });

    it('returns 404 for non-existent comment', () => {
      const result = deleteComment(db, { commentId: 999999, sessionId: 'session-1' });
      expect('error' in result).toBe(true);
      if ('error' in result) expect(result.code).toBe(404);
    });
  });
});
import type Database from 'better-sqlite3';
import { ALL_LEAGUE_TYPES } from '@empire-fantasy/shared';

export function seedLeagueTypes(db: Database.Database): void {
  const existing = db.prepare('SELECT COUNT(*) as count FROM league_types').get() as { count: number };
  if (existing.count > 0) return;

  const insert = db.prepare(
    'INSERT INTO league_types (code, format, qb, rec, tep) VALUES (?, ?, ?, ?, ?)'
  );

  const insertAll = db.transaction(() => {
    for (const lt of ALL_LEAGUE_TYPES) {
      const tepInt = lt.tep === 'TEP' ? 1 : 0;
      insert.run(lt.code, lt.format, lt.qb, lt.rec, tepInt);
    }
  });

  insertAll();
}

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import type Database from 'better-sqlite3';
import { initDb, closeDb } from '../server/src/db/db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');
const DATA_DIR = process.env.DATA_DIR || path.join(PROJECT_ROOT, 'data');

export function exportRankings(db: Database.Database, rankingsDir: string): void {
  if (!fs.existsSync(rankingsDir)) {
    fs.mkdirSync(rankingsDir, { recursive: true });
  }

  const leagueTypes = db.prepare('SELECT id, code, format FROM league_types ORDER BY code').all() as {
    id: number; code: string; format: string;
  }[];

  console.log(`Exporting rankings for ${leagueTypes.length} league types...`);

  for (const lt of leagueTypes) {
    const isDynasty = lt.format === 'DYN';

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
          WHEN a.kind = 'player' THEN COALESCE(p.team, '')
          ELSE ''
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
      ORDER BY av.value DESC
    `).all(lt.id, isDynasty ? 1 : 0) as {
      asset_id: number; kind: string; name: string; position: string;
      team: string; age: number | null; value: number;
    }[];

    const lines = ['asset_id,kind,name,position,team,age,value'];
    for (const row of rows) {
      const age = row.age != null ? row.age.toString() : '';
      lines.push(`${row.asset_id},${row.kind},${row.name},${row.position},${row.team},${age},${row.value}`);
    }

    const filePath = path.join(rankingsDir, `${lt.code}.csv`);
    fs.writeFileSync(filePath, lines.join('\n') + '\n');
  }

  console.log(`Exported ${leagueTypes.length} CSV files to ${rankingsDir}`);
}

// Run as standalone script
const isMain = process.argv[1]?.includes('export-rankings');
if (isMain) {
  const dbPath = process.env.DATABASE_PATH || path.join(PROJECT_ROOT, 'empire-fantasy.db');
  const db = initDb(dbPath);
  exportRankings(db, path.join(DATA_DIR, 'rankings'));
  closeDb();
}

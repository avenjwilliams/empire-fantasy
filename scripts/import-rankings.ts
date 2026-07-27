import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { clampRound } from '@empire-fantasy/shared';
import { initDb, closeDb } from '../server/src/db/db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');
const DATA_DIR = process.env.DATA_DIR || path.join(PROJECT_ROOT, 'data');
const RANKINGS_DIR = path.join(DATA_DIR, 'rankings');

function main(): void {
  const dbPath = process.env.DATABASE_PATH || path.join(PROJECT_ROOT, 'empire-fantasy.db');
  const db = initDb(dbPath);
  const now = new Date().toISOString().slice(0, 19).replace('T', ' ');

  const leagueTypes = db.prepare('SELECT id, code FROM league_types').all() as {
    id: number; code: string;
  }[];
  const ltByCode = new Map(leagueTypes.map(lt => [lt.code, lt.id]));

  const getCurrentValue = db.prepare(
    'SELECT value FROM asset_values WHERE asset_id = ? AND league_type_id = ?'
  );
  const upsertValue = db.prepare(`
    INSERT INTO asset_values (asset_id, league_type_id, value, updated_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(asset_id, league_type_id) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
  `);
  const insertLog = db.prepare(`
    INSERT INTO adjustment_log (asset_id, league_type_id, old_value, new_value, delta, reason, detail)
    VALUES (?, ?, ?, ?, ?, 'manual', ?)
  `);

  let totalChanges = 0;
  let totalSkipped = 0;
  const errors: string[] = [];

  const files = fs.readdirSync(RANKINGS_DIR).filter(f => f.endsWith('.csv'));
  console.log(`Importing ${files.length} CSV files from ${RANKINGS_DIR}...`);

  const importAll = db.transaction(() => {
    for (const file of files) {
      const code = file.replace('.csv', '');
      const ltId = ltByCode.get(code);
      if (!ltId) {
        errors.push(`Unknown league type: ${code}`);
        continue;
      }

      const content = fs.readFileSync(path.join(RANKINGS_DIR, file), 'utf-8');
      const lines = content.trim().split('\n');
      let fileChanges = 0;

      for (let i = 1; i < lines.length; i++) {
        const parts = lines[i].split(',');
        if (parts.length < 7) continue;

        const assetId = parseInt(parts[0], 10);
        const newValue = parseFloat(parts[6]);

        if (isNaN(assetId) || isNaN(newValue)) {
          errors.push(`${file}:${i + 1} - invalid data`);
          continue;
        }

        if (newValue < 1.0 || newValue > 100.0) {
          errors.push(`${file}:${i + 1} - value ${newValue} outside [1.0, 100.0]`);
          continue;
        }

        const rounded = clampRound(newValue);
        const current = getCurrentValue.get(assetId, ltId) as { value: number } | undefined;
        const oldValue = current?.value ?? rounded;

        if (Math.abs(oldValue - rounded) < 0.05) {
          totalSkipped++;
          continue;
        }

        const delta = Math.round((rounded - oldValue) * 10) / 10;
        upsertValue.run(assetId, ltId, rounded, now);
        insertLog.run(assetId, ltId, oldValue, rounded, delta, JSON.stringify({ file }));
        fileChanges++;
      }

      if (fileChanges > 0) {
        console.log(`  ${code}: ${fileChanges} changes`);
        totalChanges += fileChanges;
      }
    }
  });

  importAll();

  console.log(`\nImport complete:`);
  console.log(`  Changes applied: ${totalChanges}`);
  console.log(`  Unchanged (skipped): ${totalSkipped}`);
  if (errors.length > 0) {
    console.log(`  Errors: ${errors.length}`);
    errors.slice(0, 10).forEach(e => console.log(`    ${e}`));
  }

  closeDb();
}

main();

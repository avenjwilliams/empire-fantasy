import path from 'path';
import { fileURLToPath } from 'url';
import { initDb, closeDb } from '../server/src/db/db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');

const dbPath = path.join(PROJECT_ROOT, 'empire-fantasy.db');
const db = initDb(dbPath);

try {
  const today = new Date().toISOString().slice(0, 10);

  console.log(`=== Empire Fantasy — Value History Snapshot ===`);
  console.log(`Date: ${today}`);

  const result = db.prepare(`
    INSERT OR REPLACE INTO value_history (asset_id, league_type_id, date, value)
    SELECT asset_id, league_type_id, ?, value
    FROM asset_values
  `).run(today);

  console.log(`Snapshot complete: ${result.changes} rows written to value_history`);
} finally {
  closeDb();
}

import path from 'path';
import { fileURLToPath } from 'url';
import { initDb, closeDb } from '../server/src/db/db.js';
import { seedLeagueTypes } from '../server/src/db/seedLeagueTypes.js';
import { seed } from '../server/src/services/seedService.js';
import { exportRankings } from './export-rankings.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');

const fixturesMode = process.argv.includes('--fixtures') || process.env.EF_FIXTURES === '1';

const dbPath = path.join(PROJECT_ROOT, 'empire-fantasy.db');
const db = initDb(dbPath);

// Ensure league types are seeded first
seedLeagueTypes(db);

await seed(db, {
  fixturesMode,
  dataDir: path.join(PROJECT_ROOT, 'data'),
});

// Export rankings after seed
console.log('\nExporting rankings to CSV...');
exportRankings(db, path.join(PROJECT_ROOT, 'data/rankings'));

closeDb();

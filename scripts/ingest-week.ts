import path from 'path';
import { fileURLToPath } from 'url';
import { initDb, closeDb } from '../server/src/db/db.js';
import { seedLeagueTypes } from '../server/src/db/seedLeagueTypes.js';
import { ingestWeek } from '../server/src/services/statService.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');

const fixturesMode = process.argv.includes('--fixtures') || process.env.EF_FIXTURES === '1';
const force = process.argv.includes('--force');

// Parse --season and --week
function parseArg(name: string): number | undefined {
  const idx = process.argv.indexOf(`--${name}`);
  if (idx === -1 || idx + 1 >= process.argv.length) return undefined;
  const val = parseInt(process.argv[idx + 1], 10);
  return isNaN(val) ? undefined : val;
}

const season = parseArg('season');
const week = parseArg('week');

if (season === undefined || week === undefined) {
  console.error('Usage: npm run stats:week -- --season 2026 --week 1 [--fixtures] [--force]');
  process.exit(1);
}

const dbPath = path.join(PROJECT_ROOT, 'empire-fantasy.db');
const db = initDb(dbPath);
seedLeagueTypes(db);

try {
  ingestWeek(db, {
    fixturesMode,
    dataDir: path.join(PROJECT_ROOT, 'data'),
    season,
    week,
    force,
  });
} finally {
  closeDb();
}

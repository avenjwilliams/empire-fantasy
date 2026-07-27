import express from 'express';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { initDb } from './db/db.js';
import { seedLeagueTypes } from './db/seedLeagueTypes.js';
import { sessionMiddleware } from './middleware/session.js';
import leagueTypesRouter from './routes/leagueTypes.js';
import rankingsRouter from './routes/rankings.js';
import assetsRouter from './routes/assets.js';
import logRouter from './routes/log.js';
import tradeRouter from './routes/trade.js';
import ktcRouter from './routes/ktc.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3001;
const isProduction = process.env.NODE_ENV === 'production';

const app = express();

// Initialize database and seed league types
const db = initDb();
seedLeagueTypes(db);

// Middleware
app.use(cors({ origin: 'http://localhost:5173', credentials: true }));
app.use(express.json());
app.use(cookieParser());
app.use(sessionMiddleware);

// API routes
app.get('/api/health', (_req, res) => {
  const count = db.prepare('SELECT COUNT(*) as count FROM league_types').get() as { count: number };
  res.json({ status: 'ok', leagueTypes: count.count });
});
app.use('/api/league-types', leagueTypesRouter);
app.use('/api/rankings', rankingsRouter);
app.use('/api/assets', assetsRouter);
app.use('/api/log', logRouter);
app.use('/api/trade', tradeRouter);
app.use('/api/ktc', ktcRouter);

// In production, serve the built React client
if (isProduction) {
  const clientDist = path.resolve(__dirname, '../../client/dist');
  app.use(express.static(clientDist));
  app.get('*', (_req, res) => {
    res.sendFile(path.join(clientDist, 'index.html'));
  });
}

// Start listening FIRST so Fly proxy can connect, then auto-seed if needed
app.listen(PORT, '0.0.0.0', async () => {
  console.log(`Empire Fantasy server running on port ${PORT}`);

  const assetCount = (db.prepare('SELECT COUNT(*) as c FROM assets').get() as any).c;
  if (assetCount === 0) {
    console.log('Empty database detected — running auto-seed...');
    const { seed } = await import('./services/seedService.js');
    const dataDir = process.env.DATA_DIR || path.resolve(__dirname, '../../data');
    await seed(db, { fixturesMode: false, dataDir });
    console.log('Auto-seed complete.');
  } else {
    // One-time cleanup: remove retired players (no team + veteran)
    await cleanupRetiredPlayers(db);
  }
});

async function cleanupRetiredPlayers(db: ReturnType<typeof initDb>) {
  const CLEANUP_KEY = 'retired_cleanup_v1';
  const alreadyDone = db.prepare("SELECT 1 FROM adjustment_log WHERE detail = ? LIMIT 1").get(CLEANUP_KEY);
  if (alreadyDone) return;

  console.log('Checking for retired players to remove...');
  const res = await fetch('https://api.sleeper.app/v1/players/nfl');
  if (!res.ok) { console.log('  Sleeper API unavailable, skipping cleanup.'); return; }
  const raw: Record<string, any> = await res.json();

  const positions = ['QB', 'RB', 'WR', 'TE'];
  const sleeperData = new Map<string, { years_exp: number; age: number | null; team: string | null }>();
  for (const [id, p] of Object.entries(raw)) {
    if (!positions.includes(p.position)) continue;
    sleeperData.set(id, { years_exp: p.years_exp ?? 0, age: p.age ?? null, team: p.team });
  }

  const players = db.prepare('SELECT id, sleeper_id, name, position, team FROM players').all() as {
    id: number; sleeper_id: string; name: string; position: string; team: string | null;
  }[];

  const toRemove: number[] = [];
  for (const p of players) {
    const d = sleeperData.get(p.sleeper_id);
    if (!d || p.team) continue;
    const yearsExp = d.years_exp;
    const age = d.age ?? 0;
    if (yearsExp >= 12) toRemove.push(p.id);
    else if (yearsExp >= 10 && age >= 33) toRemove.push(p.id);
    else if (yearsExp >= 8 && age >= 35) toRemove.push(p.id);
  }

  if (toRemove.length === 0) {
    db.prepare("INSERT INTO adjustment_log (asset_id, league_type_id, old_value, new_value, delta, reason, detail) VALUES (0, 0, 0, 0, 0, 'manual', ?)").run(CLEANUP_KEY);
    console.log('  No retired players found.');
    return;
  }

  const placeholders = toRemove.map(() => '?').join(',');
  const assetIds = db.prepare(`SELECT id FROM assets WHERE player_id IN (${placeholders})`).all(...toRemove).map((r: any) => r.id);
  const assetPH = assetIds.map(() => '?').join(',');

  // Disable FK checks for cleanup to avoid cascading constraint issues
  db.pragma('foreign_keys = OFF');
  try {
    db.transaction(() => {
      if (assetIds.length > 0) {
        db.prepare(`DELETE FROM adjustment_log WHERE asset_id IN (${assetPH})`).run(...assetIds);
        db.prepare(`DELETE FROM asset_values WHERE asset_id IN (${assetPH})`).run(...assetIds);
        db.prepare(`DELETE FROM value_history WHERE asset_id IN (${assetPH})`).run(...assetIds);
      }
      if (toRemove.length > 0) {
        db.prepare(`DELETE FROM weekly_stats WHERE player_id IN (${placeholders})`).run(...toRemove);
        db.prepare(`DELETE FROM assets WHERE player_id IN (${placeholders})`).run(...toRemove);
        db.prepare(`DELETE FROM players WHERE id IN (${placeholders})`).run(...toRemove);
      }
      db.prepare("INSERT INTO adjustment_log (asset_id, league_type_id, old_value, new_value, delta, reason, detail) VALUES (0, 0, 0, 0, 0, 'manual', ?)").run(CLEANUP_KEY);
    })();
  } finally {
    db.pragma('foreign_keys = ON');
  }

  const remaining = (db.prepare('SELECT COUNT(*) as c FROM players').get() as any).c;
  console.log(`  Removed ${toRemove.length} retired players. ${remaining} players remaining.`);
}

export default app;

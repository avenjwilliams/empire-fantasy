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
  }
});

export default app;

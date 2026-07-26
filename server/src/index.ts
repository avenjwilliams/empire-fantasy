import express from 'express';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import { initDb } from './db/db.js';
import { seedLeagueTypes } from './db/seedLeagueTypes.js';
import { sessionMiddleware } from './middleware/session.js';
import leagueTypesRouter from './routes/leagueTypes.js';
import rankingsRouter from './routes/rankings.js';
import assetsRouter from './routes/assets.js';
import logRouter from './routes/log.js';
import tradeRouter from './routes/trade.js';

const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3001;

const app = express();

// Initialize database and seed league types
const db = initDb();
seedLeagueTypes(db);

// Middleware
app.use(cors({ origin: 'http://localhost:5173', credentials: true }));
app.use(express.json());
app.use(cookieParser());
app.use(sessionMiddleware);

// Routes
app.get('/api/health', (_req, res) => {
  const count = db.prepare('SELECT COUNT(*) as count FROM league_types').get() as { count: number };
  res.json({ status: 'ok', leagueTypes: count.count });
});
app.use('/api/league-types', leagueTypesRouter);
app.use('/api/rankings', rankingsRouter);
app.use('/api/assets', assetsRouter);
app.use('/api/log', logRouter);
app.use('/api/trade', tradeRouter);

app.listen(PORT, () => {
  console.log(`Empire Fantasy server running on port ${PORT}`);
});

export default app;

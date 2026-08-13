import path from 'path';
import { fileURLToPath } from 'url';
import { initDb, closeDb } from '../server/src/db/db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');

/**
 * Simple deterministic PRNG seeded from a string.
 * Returns a pseudo-random integer in [0, max).
 */
function seededRandom(seed: string, max: number): number {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    const char = seed.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  // Use a simple LCG for the actual random generation
  const a = 1664525;
  const c = 1013904223;
  const m = 2 ** 32;
  let state = (hash >>> 0) + 1; // ensure non-zero
  state = (a * state + c) % m;
  return Math.floor((state / m) * max);
}

function generateVolatility(seed: string): number {
  // Range 5-95 (inclusive) = 91 values, so max = 91, then +5
  // These are PLACEHOLDER random numbers — not real volatility computations.
  // Real computation will derive from weekly_stats against positional baselines.
  return seededRandom(seed + '|volatility', 91) + 5;
}

async function main() {
  const force = process.argv.includes('--force');
  const dbPath = process.env.DATABASE_PATH || path.join(PROJECT_ROOT, 'empire-fantasy.db');
  const db = initDb(dbPath);

  try {
    // Get all players with their sleeper_id
    const players = db.prepare('SELECT id, sleeper_id, volatility_pct FROM players').all() as
      { id: number; sleeper_id: string; volatility_pct: number | null }[];

    let filled = 0;
    let skipped = 0;

    // Wrap in a single transaction
    const tx = db.transaction(() => {
      for (const player of players) {
        const needsGeneration = force || player.volatility_pct === null;

        if (!needsGeneration) {
          skipped++;
          continue;
        }

        const volatility = generateVolatility(player.sleeper_id);

        db.prepare('UPDATE players SET volatility_pct = ? WHERE id = ?')
          .run(volatility, player.id);

        filled++;
      }
    });

    tx();

    console.log(`Volatility generation complete: ${filled} players filled, ${skipped} skipped (already had values).`);
  } finally {
    closeDb();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
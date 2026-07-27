#!/usr/bin/env tsx
/**
 * Remove retired/out-of-NFL players from the database.
 *
 * Criteria:
 *   1. No team AND years_exp >= 12 → definitely retired
 *   2. No team AND years_exp >= 10 AND age >= 33 → likely retired
 *   3. No team AND years_exp >= 8 AND age >= 35 → definitely retired
 *
 * Also removes their asset_values, adjustment_log, value_history,
 * and weekly_stats rows. Deletes the asset row last (FK constraint).
 *
 * Usage: npx tsx scripts/cleanup-retired.ts [--dry-run]
 */
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import Database from 'better-sqlite3';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');

const dryRun = process.argv.includes('--dry-run');

const raw = JSON.parse(
  fs.readFileSync(path.join(PROJECT_ROOT, 'data/raw/sleeper-players.json'), 'utf-8'),
);

interface PlayerData {
  years_exp: number;
  team: string | null;
  age: number | null;
  active: boolean;
}

const sleeperData = new Map<string, PlayerData>();
for (const [id, p] of Object.entries(raw) as [string, any][]) {
  sleeperData.set(id, {
    years_exp: p.years_exp ?? 0,
    team: p.team,
    age: p.age ?? null,
    active: p.active,
  });
}

function isRetired(p: { team: string | null; sleeper_id: string }): boolean {
  const d = sleeperData.get(p.sleeper_id);
  if (!d || p.team) return false; // has a team → keep
  // No team: apply heuristics
  if (d.years_exp >= 12) return true;                              // Rule 1
  if (d.years_exp >= 10 && d.age !== null && d.age >= 33) return true; // Rule 2
  if (d.years_exp >= 8 && d.age !== null && d.age >= 35) return true;  // Rule 3
  return false;
}

const dbPath = path.join(PROJECT_ROOT, 'empire-fantasy.db');
if (!fs.existsSync(dbPath)) {
  console.error('No local DB found at', dbPath);
  process.exit(1);
}
const db = new Database(dbPath);

const allPlayers = db
  .prepare('SELECT id, sleeper_id, name, position, team FROM players')
  .all() as { id: number; sleeper_id: string; name: string; position: string; team: string | null }[];

const toRemove: typeof allPlayers = [];
const keep: typeof allPlayers = [];

for (const p of allPlayers) {
  if (isRetired(p)) {
    toRemove.push(p);
  } else {
    keep.push(p);
  }
}

console.log(`Players to remove: ${toRemove.length}`);
console.log(`Players to keep:   ${keep.length}`);

if (toRemove.length === 0) {
  console.log('Nothing to clean up.');
  db.close();
  process.exit(0);
}

console.log('\nRemovals:');
toRemove.forEach(p => {
  const d = sleeperData.get(p.sleeper_id);
  console.log(`  ${p.name} (${p.position}) years_exp=${d?.years_exp} age=${d?.age}`);
});

if (dryRun) {
  console.log('\n--dry-run: no changes made.');
  db.close();
  process.exit(0);
}

const playerIds = toRemove.map(p => p.id);
const placeholders = playerIds.map(() => '?').join(',');

const assetIds = db
  .prepare(`SELECT id FROM assets WHERE player_id IN (${placeholders})`)
  .all(...playerIds)
  .map((r: any) => r.id) as number[];

console.log(`\nDeleting ${assetIds.length} assets and related data...`);

const assetPlaceholders = assetIds.map(() => '?').join(',');

const cleanup = db.transaction(() => {
  // Disable FK checks for cleanup to avoid cascading constraint issues
  db.pragma('foreign_keys = OFF');
  try {
    if (assetIds.length > 0) {
      db.prepare(`DELETE FROM adjustment_log WHERE asset_id IN (${assetPlaceholders})`).run(...assetIds);
      db.prepare(`DELETE FROM asset_values WHERE asset_id IN (${assetPlaceholders})`).run(...assetIds);
      db.prepare(`DELETE FROM value_history WHERE asset_id IN (${assetPlaceholders})`).run(...assetIds);
    }
    db.prepare(`DELETE FROM weekly_stats WHERE player_id IN (${placeholders})`).run(...playerIds);
    db.prepare(`DELETE FROM assets WHERE player_id IN (${placeholders})`).run(...playerIds);
    db.prepare(`DELETE FROM players WHERE id IN (${placeholders})`).run(...playerIds);
  } finally {
    db.pragma('foreign_keys = ON');
  }
});

cleanup();

const afterCount = (db.prepare('SELECT COUNT(*) as c FROM players').get() as any).c;
const afterAssets = (db.prepare("SELECT COUNT(*) as c FROM assets WHERE kind = 'player'").get() as any).c;
console.log(`\nDone. Players: ${afterCount}, Player assets: ${afterAssets}`);

db.close();

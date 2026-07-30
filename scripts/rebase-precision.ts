import type Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  clampRound,
  RANK_DECAY_K,
  SCORING_MULTIPLIERS,
  PICK_VALUES,
  PICK_YEAR_DECAY,
  PICK_SF_FIRST_ROUND_MULTIPLIER,
  PICK_YEARS,
} from '@empire-fantasy/shared';
import type { Position, Format, QBSetting, PickTier } from '@empire-fantasy/shared';
import { initDb, closeDb } from '../server/src/db/db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');
const DATA_DIR = process.env.DATA_DIR || path.join(PROJECT_ROOT, 'data');

interface SleeperPlayer {
  player_id: string;
  full_name: string;
  position: string;
  team: string | null;
  age: number | null;
  status: string;
  search_rank: number;
  years_exp: number;
}

interface SeedRankingRow {
  rank: number;
  name: string;
  position: string;
  team: string;
}

interface SeedConfig {
  fixturesMode: boolean;
  dataDir: string;
}

const VALID_POSITIONS: Position[] = ['QB', 'RB', 'WR', 'TE'];
const CSV_SETS = ['DYN_1QB', 'RED_1QB', 'DYN_SF', 'RED_SF'];

const NAME_SUFFIXES = /\b(jr|sr|ii|iii|iv|v)\b/g;

function normalizeName(name: string): string {
  return name.toLowerCase().replace(/[^a-z ]/g, '').replace(NAME_SUFFIXES, '').replace(/\s+/g, ' ').trim();
}

/** rankToValue with 999.9 amplitude */
function rankToValue(rank: number, totalPlayers: number): number {
  const N = totalPlayers;
  const raw = 999.9 * Math.exp(-RANK_DECAY_K * (rank - 1) / N);
  return clampRound(raw);
}

/** Old rankToValue with 100 amplitude (×10 for migration) */
function oldRankToValue100(rank: number, totalPlayers: number): number {
  const N = totalPlayers;
  const raw = 100 * Math.exp(-RANK_DECAY_K * (rank - 1) / N);
  return clampRound(raw);
}

function parseSleeperPlayers(raw: Record<string, any>): SleeperPlayer[] {
  const players: SleeperPlayer[] = [];
  for (const [, p] of Object.entries(raw) as [string, any][]) {
    if (!VALID_POSITIONS.includes(p.position)) continue;
    if (!p.full_name) continue;
    const hasTeam = p.team != null;
    const isNotable = (p.search_rank ?? 9999) < 500;
    if (!hasTeam && !isNotable) continue;
    const statusLower = (p.status || 'active').toLowerCase();
    if (statusLower !== 'active') continue;
    if (!hasTeam) {
      const yearsExp = p.years_exp ?? 0;
      const age = p.age ?? 0;
      if (yearsExp >= 12) continue;
      if (yearsExp >= 10 && age >= 33) continue;
      if (yearsExp >= 8 && age >= 35) continue;
    }
    players.push({
      player_id: p.player_id,
      full_name: p.full_name,
      position: p.position,
      team: p.team || null,
      age: p.age || null,
      status: p.status || 'Active',
      search_rank: p.search_rank ?? 9999,
      years_exp: p.years_exp ?? 0,
    });
  }
  players.sort((a, b) => a.search_rank - b.search_rank);
  return players;
}

function loadSleeperPlayers(config: SeedConfig): SleeperPlayer[] {
  let raw: Record<string, any>;
  if (config.fixturesMode) {
    const filePath = path.join(config.dataDir, 'fixtures/sleeper-players.sample.json');
    raw = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } else {
    const cachePath = path.join(config.dataDir, 'raw/sleeper-players.json');
    raw = JSON.parse(fs.readFileSync(cachePath, 'utf-8'));
  }
  return parseSleeperPlayers(raw);
}

function loadCsvNameSet(config: SeedConfig): Set<string> {
  const names = new Set<string>();
  for (const setCode of CSV_SETS) {
    const rows = loadSeedRankings(config, setCode);
    for (const row of rows) names.add(normalizeName(row.name));
  }
  return names;
}

function loadSeedRankings(config: SeedConfig, setCode: string): SeedRankingRow[] {
  const manualPath = path.join(config.dataDir, `seed-rankings/${setCode}.csv`);
  const fixturePath = path.join(config.dataDir, 'fixtures/seed-rankings.sample.csv');
  const csvPath = config.fixturesMode ? fixturePath : (fs.existsSync(manualPath) ? manualPath : fixturePath);
  const content = fs.readFileSync(csvPath, 'utf-8');
  const lines = content.trim().split('\n');
  const rows: SeedRankingRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const parts = lines[i].split(',');
    if (parts.length < 4) continue;
    rows.push({
      rank: parseInt(parts[0], 10),
      name: parts[1].trim(),
      position: parts[2].trim(),
      team: parts[3].trim(),
    });
  }
  return rows;
}

function matchPlayer(
  name: string,
  position: string,
  playersByName: Map<string, { id: number; position: string }[]>
): number | null {
  const normalized = normalizeName(name);
  const candidates = playersByName.get(normalized);
  if (candidates) {
    const posMatch = candidates.find(c => c.position === position);
    return posMatch?.id ?? candidates[0]?.id ?? null;
  }
  return null;
}

/** Recover seed ranks exactly as seedService does */
function recoverSeedRanks(db: Database.Database, config: SeedConfig): Map<number, { rank: number; position: Position; baseSet: string }> {
  const csvNameSet = loadCsvNameSet(config);
  const sleeperPlayers = loadSleeperPlayers(config).filter(p => csvNameSet.has(normalizeName(p.full_name)));

  const allPlayers = db.prepare('SELECT id, name, position FROM players').all() as { id: number; name: string; position: string }[];
  const playersByName = new Map<string, { id: number; position: string }[]>();
  for (const p of allPlayers) {
    const key = normalizeName(p.name);
    const arr = playersByName.get(key) || [];
    arr.push({ id: p.id, position: p.position });
    playersByName.set(key, arr);
  }

  const seedRanks = new Map<number, { rank: number; position: Position; baseSet: string }>();

  for (const setCode of CSV_SETS) {
    const seedRankings = loadSeedRankings(config, setCode);
    for (const row of seedRankings) {
      const playerId = matchPlayer(row.name, row.position, playersByName);
      if (!playerId) continue;
      const asset = db.prepare('SELECT id FROM assets WHERE player_id = ?').get(playerId) as { id: number } | undefined;
      if (!asset) continue;
      if (!seedRanks.has(asset.id)) {
        seedRanks.set(asset.id, { rank: row.rank, position: row.position as Position, baseSet: setCode });
      }
    }
  }
  return seedRanks;
}

/** Compute precise base value using 999.9 amplitude, matching seedService expansion logic */
function computePreciseBase(
  rank: number,
  totalPlayers: number,
  position: Position,
  baseSet: string,
  targetLeagueType: { code: string; format: string; qb: string; rec: string; tep: number },
): number {
  // Step 1: Compute base value from rank with 999.9 amplitude
  const baseValue = rankToValue(rank, totalPlayers);

  // Step 2: Apply scoring multipliers (exactly matching seedService)
  let value = baseValue;

  // Reception scoring adjustment
  if (targetLeagueType.rec === 'HALF') {
    const mult = SCORING_MULTIPLIERS.HALF[position as keyof typeof SCORING_MULTIPLIERS.HALF];
    value *= mult;
  } else if (targetLeagueType.rec === 'ZERO') {
    const mult = SCORING_MULTIPLIERS.ZERO[position as keyof typeof SCORING_MULTIPLIERS.ZERO];
    value *= mult;
  }

  // TEP adjustment
  if (targetLeagueType.tep === 1 && position === 'TE') {
    value *= SCORING_MULTIPLIERS.TEP.TE;
  }

  return clampRound(value);
}

/** Compute old quantized base (what migration 004 produced) */
function computeQuantizedBase(
  rank: number,
  totalPlayers: number,
  position: Position,
  baseSet: string,
  targetLeagueType: { code: string; format: string; qb: string; rec: string; tep: number },
): number {
  // Old: 100 * exp(...) → clampRound → ×10 (migration)
  const oldBase = oldRankToValue100(rank, totalPlayers);

  let value = oldBase;

  if (targetLeagueType.rec === 'HALF') {
    const mult = SCORING_MULTIPLIERS.HALF[position as keyof typeof SCORING_MULTIPLIERS.HALF];
    value *= mult;
  } else if (targetLeagueType.rec === 'ZERO') {
    const mult = SCORING_MULTIPLIERS.ZERO[position as keyof typeof SCORING_MULTIPLIERS.ZERO];
    value *= mult;
  }

  if (targetLeagueType.tep === 1 && position === 'TE') {
    value *= SCORING_MULTIPLIERS.TEP.TE;
  }

  return clampRound(value * 10); // This is what migration 004 produced
}

interface LeagueTypeRow {
  id: number;
  code: string;
  format: string;
  qb: string;
  rec: string;
  tep: number;
}

async function main(): Promise<void> {
  const dryRun = process.argv.includes('--dry-run');
  console.log(`=== Precision Rebase ${dryRun ? '(DRY RUN)' : ''} ===`);

  const dbPath = process.env.DATABASE_PATH || path.join(PROJECT_ROOT, 'empire-fantasy.db');
  const db = initDb(dbPath);

  try {
    const config: SeedConfig = { fixturesMode: false, dataDir: DATA_DIR };
    const now = new Date().toISOString().slice(0, 19).replace('T', ' ');

    // Load league types
    const leagueTypes = db.prepare('SELECT * FROM league_types').all() as LeagueTypeRow[];
    const ltByCode = new Map(leagueTypes.map(lt => [lt.code, lt]));

    // Recover seed ranks for all assets
    console.log('\n[1/5] Recovering seed ranks from CSV sources...');
    const seedRanks = recoverSeedRanks(db, config);
    console.log(`  Recovered ranks for ${seedRanks.size} assets`);

    // Get current values from DB
    console.log('\n[2/5] Reading current asset values...');
    const currentValues = db.prepare(`
      SELECT av.asset_id, av.league_type_id, av.value, lt.code as leagueTypeCode
      FROM asset_values av
      JOIN league_types lt ON lt.id = av.league_type_id
    `).all() as { asset_id: number; league_type_id: number; value: number; leagueTypeCode: string }[];

    const currentByAsset = new Map<number, Map<number, { value: number; code: string }>>();
    for (const row of currentValues) {
      const m = currentByAsset.get(row.asset_id) || new Map();
      m.set(row.league_type_id, { value: row.value, code: row.leagueTypeCode });
      currentByAsset.set(row.asset_id, m);
    }

    // Process each asset with a recovered rank
    console.log('\n[3/5] Computing rebase deltas...');
    let touched = 0;
    let unchanged = 0;
    let noRank = 0;
    const deltas: { assetId: number; code: string; old: number; new: number; drift: number }[] = [];

    for (const [assetId, rankInfo] of seedRanks) {
      const currentMap = currentByAsset.get(assetId);
      if (!currentMap) {
        noRank++;
        continue;
      }

      const { rank, position, baseSet } = rankInfo;
      const totalPlayers = 358; // Fixed N as used in seedService

      for (const [ltId, { value: currentValue, code }] of currentMap) {
        const lt = ltByCode.get(code);
        if (!lt) continue;

        // Only process the league types that match this asset's base set
        const baseKey = `${lt.format}_${lt.qb}`;
        if (baseKey !== baseSet) continue;

        // Compute precise base with 999.9 amplitude
        const preciseBase = computePreciseBase(rank, 358, rankInfo.position, baseSet, lt);

        // Compute quantized base (what migration 004 produced)
        const quantizedBase = computeQuantizedBase(rank, 358, rankInfo.position, baseSet, lt);

        // Drift = current - quantizedBase (preserves all accumulated changes)
        const drift = currentValue - quantizedBase;

        // New value = preciseBase + drift
        const newValue = clampRound(preciseBase + drift);

        if (newValue !== currentValue) {
          deltas.push({ assetId, code, old: currentValue, new: newValue, drift });
          touched++;
        } else {
          unchanged++;
        }
      }
    }

    console.log(`  Assets touched: ${touched}`);
    console.log(`  Assets unchanged: ${unchanged}`);
    console.log(`  Assets without rank: ${noRank}`);

    // Summary stats
    const wholeCount = deltas.filter(d => Number.isInteger(d.new * 10)).length;
    const wholePct = touched > 0 ? Math.round(wholeCount / touched * 100) : 0;
    console.log(`  Values ending in .0: ${wholeCount}/${touched} (${wholePct}%)`);

    if (deltas.length > 0) {
      const maxDelta = deltas.reduce((max, d) => Math.max(max, Math.abs(d.new - d.old)), 0);
      console.log(`  Max absolute delta: ${maxDelta.toFixed(1)}`);
    }

    if (dryRun) {
      console.log('\n[DRY RUN] No changes written.');
      return;
    }

    // Write changes
    console.log('\n[4/5] Writing changes to DB...');
    const updateValue = db.prepare('UPDATE asset_values SET value = ?, updated_at = ? WHERE asset_id = ? AND league_type_id = ?');
    const insertLog = db.prepare(`
      INSERT INTO adjustment_log (asset_id, league_type_id, old_value, new_value, delta, reason, detail)
      VALUES (?, ?, ?, ?, ?, 'manual', ?)
    `);
    const insertHistory = db.prepare(`
      INSERT OR REPLACE INTO value_history (asset_id, league_type_id, date, value)
      VALUES (?, ?, ?, ?)
    `);
    const today = new Date().toISOString().slice(0, 10);

    const writeTxn = db.transaction(() => {
      for (const d of deltas) {
        updateValue.run(d.new, now, d.assetId, ltByCode.get(d.code)!.id);
        const delta = Math.round((d.new - d.old) * 10) / 10;
        const detail = JSON.stringify({
          rebase: true,
          baseBefore: (d.old - d.drift).toFixed(1),
          baseAfter: (d.new - d.drift).toFixed(1),
          driftPreserved: d.drift.toFixed(1),
        });
        insertLog.run(d.assetId, ltByCode.get(d.code)!.id, d.old, d.new, delta, detail);
        insertHistory.run(d.assetId, ltByCode.get(d.code)!.id, today, d.new);
      }
    });
    writeTxn();
    console.log(`  Wrote ${deltas.length} adjustments to DB.`);

    // Export CSVs
    console.log('\n[5/5] Exporting updated rankings CSVs...');
    const exportCmd = 'npm run rankings:export';
    console.log(`  Run: ${exportCmd} (outside this script)`);
    console.log('\n✅ Precision rebase complete!');
  } finally {
    closeDb();
  }
}

main().catch(e => {
  console.error('❌ Rebase failed:', e);
  process.exit(1);
});
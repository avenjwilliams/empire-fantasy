import type Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
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
const MAX_PLAYERS = 800;
const SLEEPER_PLAYERS_URL = 'https://api.sleeper.app/v1/players/nfl';

// ------ Rank → Value Curve ------

/**
 * Convert rank (1-based) to value (1.0-100.0).
 * Uses exponential decay: value = 100 * exp(-k * (rank-1) / N)
 * Tuned so rank 1 ≈ 100, rank ~50 ≈ 65, rank ~200 ≈ 15.
 */
export function rankToValue(rank: number, totalPlayers: number): number {
  const N = totalPlayers;
  const raw = 100 * Math.exp(-RANK_DECAY_K * (rank - 1) / N);
  return clampRound(raw);
}

// ------ Player Loading ------

async function fetchSleeperPlayersFromAPI(): Promise<Record<string, any>> {
  console.log('  Fetching players from Sleeper API...');
  const res = await fetch(SLEEPER_PLAYERS_URL);
  if (!res.ok) throw new Error(`Sleeper API returned ${res.status}`);
  return res.json();
}

function parseSleeperPlayers(raw: Record<string, any>): SleeperPlayer[] {
  const players: SleeperPlayer[] = [];

  for (const [, p] of Object.entries(raw) as [string, any][]) {
    if (!VALID_POSITIONS.includes(p.position)) continue;
    if (!p.full_name) continue;

    // Filter: must have a team or be notable (low search_rank)
    const hasTeam = p.team != null;
    const isNotable = (p.search_rank ?? 9999) < 500;
    if (!hasTeam && !isNotable) continue;

    // Filter: remove players where Sleeper status is not "Active" (Inactive, IR, etc.)
    if (!hasTeam && p.status && p.status.toLowerCase() !== 'active') continue;

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
  return players.slice(0, MAX_PLAYERS);
}

async function loadSleeperPlayers(config: SeedConfig): Promise<SleeperPlayer[]> {
  let raw: Record<string, any>;

  if (config.fixturesMode) {
    const filePath = path.join(config.dataDir, 'fixtures/sleeper-players.sample.json');
    raw = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } else {
    // Try local cache first, then fetch from API
    const cachePath = path.join(config.dataDir, 'raw/sleeper-players.json');
    if (fs.existsSync(cachePath)) {
      raw = JSON.parse(fs.readFileSync(cachePath, 'utf-8'));
    } else {
      raw = await fetchSleeperPlayersFromAPI();
      // Cache for next time (create dir if needed)
      const dir = path.dirname(cachePath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(cachePath, JSON.stringify(raw));
    }
  }

  return parseSleeperPlayers(raw);
}

// ------ Seed Rankings Loading ------

function loadSeedRankings(config: SeedConfig, setCode: string): SeedRankingRow[] {
  // Try manual CSVs first, then fixture (both sets share the fixture in test mode)
  const manualPath = path.join(config.dataDir, `raw/seed-rankings/${setCode}.csv`);
  const fixturePath = path.join(config.dataDir, 'fixtures/seed-rankings.sample.csv');

  const csvPath = config.fixturesMode
    ? fixturePath
    : (fs.existsSync(manualPath) ? manualPath : fixturePath);

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

const NAME_SUFFIXES = /\b(jr|sr|ii|iii|iv|v)\b/g;

function normalizeName(name: string): string {
  return name.toLowerCase().replace(/[^a-z ]/g, '').replace(NAME_SUFFIXES, '').replace(/\s+/g, ' ').trim();
}

/**
 * Fuzzy match a seed ranking name to a DB player.
 * Strips suffixes (Jr, III, etc.) so "Kenneth Walker III" matches "Kenneth Walker".
 * Returns player ID or null.
 */
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

// ------ Main Seed Function ------

export async function seed(db: Database.Database, config: SeedConfig): Promise<void> {
  const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
  const today = new Date().toISOString().slice(0, 10);

  console.log('=== Empire Fantasy Seed ===');
  console.log(`Mode: ${config.fixturesMode ? 'FIXTURES' : 'LIVE'}`);

  // Step 1: Load and insert players
  console.log('\n[1/7] Loading players...');
  const sleeperPlayers = await loadSleeperPlayers(config);
  console.log(`  Found ${sleeperPlayers.length} eligible players`);

  const insertPlayer = db.prepare(`
    INSERT OR IGNORE INTO players (sleeper_id, name, position, team, age, status)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  const insertAsset = db.prepare(`
    INSERT INTO assets (kind, player_id, pick_id) VALUES ('player', ?, NULL)
  `);
  const getPlayer = db.prepare('SELECT id FROM players WHERE sleeper_id = ?');

  const insertPlayers = db.transaction(() => {
    for (const p of sleeperPlayers) {
      const status = p.status === 'Injured Reserve' ? 'injured'
        : p.status === 'Inactive' ? 'inactive' : 'active';
      insertPlayer.run(p.player_id, p.full_name, p.position, p.team, p.age, status);

      const row = getPlayer.get(p.player_id) as { id: number } | undefined;
      if (row) {
        const existingAsset = db.prepare('SELECT id FROM assets WHERE player_id = ?').get(row.id);
        if (!existingAsset) {
          insertAsset.run(row.id);
        }
      }
    }
  });
  insertPlayers();

  const playerCount = (db.prepare('SELECT COUNT(*) as c FROM players').get() as any).c;
  const assetCount = (db.prepare('SELECT COUNT(*) as c FROM assets WHERE kind = ?').get('player') as any).c;
  console.log(`  Inserted: ${playerCount} players, ${assetCount} player assets`);

  // Build player lookup by normalized name
  const allPlayers = db.prepare('SELECT id, name, position FROM players').all() as { id: number; name: string; position: string }[];
  const playersByName = new Map<string, { id: number; position: string }[]>();
  for (const p of allPlayers) {
    const key = normalizeName(p.name);
    const arr = playersByName.get(key) || [];
    arr.push({ id: p.id, position: p.position });
    playersByName.set(key, arr);
  }

  const allAssets = db.prepare(`
    SELECT a.id as asset_id, p.id as player_id, p.position
    FROM assets a JOIN players p ON a.player_id = p.id
  `).all() as { asset_id: number; player_id: number; position: string }[];

  // Match seed rankings to DB players and assign values via rankToValue curve.
  // Unranked players get tail-end values. Used for both dynasty and redraft bases.
  function matchAndValueRankings(
    seedRankings: SeedRankingRow[],
    label: string,
  ): Map<number, { value: number; position: Position }> {
    type RankedPlayer = { playerId: number; assetId: number; position: Position; rank: number; value: number };
    const rankedPlayers: RankedPlayer[] = [];
    const unmatched: string[] = [];

    for (const row of seedRankings) {
      const playerId = matchPlayer(row.name, row.position, playersByName);
      if (!playerId) {
        unmatched.push(`${row.rank}: ${row.name} (${row.position})`);
        continue;
      }
      const asset = db.prepare('SELECT id FROM assets WHERE player_id = ?').get(playerId) as { id: number } | undefined;
      if (!asset) continue;

      const value = rankToValue(row.rank, seedRankings.length);
      rankedPlayers.push({
        playerId,
        assetId: asset.id,
        position: row.position as Position,
        rank: row.rank,
        value,
      });
    }

    if (unmatched.length > 0) {
      console.log(`  WARNING [${label}]: ${unmatched.length} unmatched rankings:`);
      unmatched.slice(0, 10).forEach(u => console.log(`    ${u}`));
      if (unmatched.length > 10) console.log(`    ... and ${unmatched.length - 10} more`);
    }
    console.log(`  [${label}] Matched ${rankedPlayers.length} of ${seedRankings.length} ranked entries`);

    // Assign tail-end values to unranked players
    const rankedIds = new Set(rankedPlayers.map(r => r.playerId));
    let nextRank = rankedPlayers.length + 1;
    for (const a of allAssets) {
      if (rankedIds.has(a.player_id)) continue;
      const value = rankToValue(nextRank, allAssets.length);
      rankedPlayers.push({
        playerId: a.player_id,
        assetId: a.asset_id,
        position: a.position as Position,
        rank: nextRank,
        value,
      });
      nextRank++;
    }

    const baseValues = new Map<number, { value: number; position: Position }>();
    for (const rp of rankedPlayers) {
      baseValues.set(rp.assetId, { value: rp.value, position: rp.position });
    }
    return baseValues;
  }

  // Step 2: Load dynasty seed rankings (DYN_1QB as primary base)
  console.log('\n[2/7] Loading seed rankings...');
  const dynRankings = loadSeedRankings(config, 'DYN_1QB');
  const dynBaseValues = matchAndValueRankings(dynRankings, 'DYN_1QB');

  // Load redraft seed rankings (RED_1QB) — independent source, not derived from dynasty
  let redBaseValues: Map<number, { value: number; position: Position }>;
  const redManualPath = path.join(config.dataDir, 'raw/seed-rankings/RED_1QB.csv');
  const hasRedraftCSV = !config.fixturesMode && fs.existsSync(redManualPath);

  if (hasRedraftCSV) {
    const redRankings = loadSeedRankings(config, 'RED_1QB');
    redBaseValues = matchAndValueRankings(redRankings, 'RED_1QB');
  } else if (config.fixturesMode) {
    // In fixtures mode, both sets use the same fixture (structural testing)
    redBaseValues = matchAndValueRankings(loadSeedRankings(config, 'RED_1QB'), 'RED_1QB');
  } else {
    // Fallback: derive from dynasty values (preserves old behavior)
    console.log('  WARNING: RED_1QB.csv not found, deriving redraft from dynasty values');
    redBaseValues = new Map();
    for (const [assetId, { value, position }] of dynBaseValues) {
      const compressed = value > 70 ? value * 0.98 : value * 1.03;
      redBaseValues.set(assetId, { value: clampRound(compressed), position });
    }
  }

  // Step 3: Generate values for all 4 base sets
  console.log('\n[3/7] Computing 4 base sets...');
  const leagueTypes = db.prepare('SELECT * FROM league_types').all() as {
    id: number; code: string; format: string; qb: string; rec: string; tep: number;
  }[];

  // Base sets: DYN_1QB_PPR_STD, DYN_SF_PPR_STD, RED_1QB_PPR_STD, RED_SF_PPR_STD
  const baseSetMap = new Map<string, Map<number, number>>(); // code -> assetId -> value

  // For SF sets: boost QBs by ~20-25% of gap to 100 (SF makes QBs much more valuable)
  function computeSFValues(base: Map<number, { value: number; position: Position }>): Map<number, number> {
    const sfMap = new Map<number, number>();
    for (const [assetId, { value, position }] of base) {
      if (position === 'QB') {
        const boost = (100 - value) * 0.25;
        sfMap.set(assetId, clampRound(value + boost));
      } else {
        sfMap.set(assetId, clampRound(value * 0.97));
      }
    }
    return sfMap;
  }

  // DYN_1QB: from dynasty consensus rankings
  const dyn1qb = new Map<number, number>();
  for (const [id, { value }] of dynBaseValues) dyn1qb.set(id, value);
  baseSetMap.set('DYN_1QB', dyn1qb);

  // DYN_SF: boost QBs from dynasty base
  const dynSF = computeSFValues(dynBaseValues);
  baseSetMap.set('DYN_SF', dynSF);

  // RED_1QB: from redraft consensus rankings (independent source)
  const red1qb = new Map<number, number>();
  for (const [id, { value }] of redBaseValues) red1qb.set(id, value);
  baseSetMap.set('RED_1QB', red1qb);

  // RED_SF: boost QBs from redraft base
  const redSF = computeSFValues(redBaseValues);
  baseSetMap.set('RED_SF', redSF);

  // baseValues used by expansion step (line 363) to look up position per asset
  const baseValues = dynBaseValues;

  // Step 4: Expand 4 base sets → 24 league types
  console.log('\n[4/7] Expanding to 24 league types...');
  const insertValue = db.prepare(`
    INSERT OR REPLACE INTO asset_values (asset_id, league_type_id, value, updated_at)
    VALUES (?, ?, ?, ?)
  `);
  const insertLog = db.prepare(`
    INSERT INTO adjustment_log (asset_id, league_type_id, old_value, new_value, delta, reason, detail)
    VALUES (?, ?, ?, ?, 0, 'seed', NULL)
  `);
  const insertHistory = db.prepare(`
    INSERT OR REPLACE INTO value_history (asset_id, league_type_id, date, value)
    VALUES (?, ?, ?, ?)
  `);

  let valueCount = 0;

  const expandAll = db.transaction(() => {
    for (const lt of leagueTypes) {
      // Determine base set key
      const baseKey = `${lt.format}_${lt.qb}`;
      const baseVals = baseSetMap.get(baseKey);
      if (!baseVals) continue;

      for (const [assetId, baseValue] of baseVals) {
        const { position } = baseValues.get(assetId) || { position: 'QB' as Position };

        // Apply scoring multipliers
        let value = baseValue;

        // Reception scoring adjustment
        if (lt.rec === 'HALF') {
          const mult = SCORING_MULTIPLIERS.HALF[position as keyof typeof SCORING_MULTIPLIERS.HALF];
          value *= mult;
        } else if (lt.rec === 'ZERO') {
          const mult = SCORING_MULTIPLIERS.ZERO[position as keyof typeof SCORING_MULTIPLIERS.ZERO];
          value *= mult;
        }
        // PPR is the baseline, no adjustment

        // TEP adjustment
        if (lt.tep === 1 && position === 'TE') {
          value *= SCORING_MULTIPLIERS.TEP.TE;
        }

        value = clampRound(value);

        insertValue.run(assetId, lt.id, value, now);
        insertLog.run(assetId, lt.id, value, value);
        insertHistory.run(assetId, lt.id, today, value);
        valueCount++;
      }
    }
  });
  expandAll();
  console.log(`  Wrote ${valueCount} asset values across 24 league types`);

  // Step 5: Seed picks for dynasty sets
  console.log('\n[5/7] Seeding picks...');
  const insertPick = db.prepare(`
    INSERT OR IGNORE INTO picks (season, round, tier) VALUES (?, ?, ?)
  `);
  const insertPickAsset = db.prepare(`
    INSERT INTO assets (kind, player_id, pick_id) VALUES ('pick', NULL, ?)
  `);
  const getPick = db.prepare('SELECT id FROM picks WHERE season = ? AND round = ? AND tier = ?');

  const dynLeagueTypes = leagueTypes.filter(lt => lt.format === 'DYN');
  let pickValueCount = 0;

  const seedPicks = db.transaction(() => {
    const tiers: PickTier[] = ['EARLY', 'MID', 'LATE'];

    for (const season of PICK_YEARS) {
      for (let round = 1; round <= 4; round++) {
        for (const tier of tiers) {
          insertPick.run(season, round, tier);
          const pickRow = getPick.get(season, round, tier) as { id: number };

          // Create asset if not exists
          const existingAsset = db.prepare('SELECT id FROM assets WHERE pick_id = ?').get(pickRow.id);
          if (!existingAsset) {
            insertPickAsset.run(pickRow.id);
          }

          const assetRow = db.prepare('SELECT id FROM assets WHERE pick_id = ?').get(pickRow.id) as { id: number };
          const assetId = assetRow.id;

          // Compute base value
          const yearOffset = season - PICK_YEARS[0] + 1; // 1, 2, or 3
          const pickKey = `1_${round}_${tier}`;
          const basePickValue = PICK_VALUES[pickKey] ?? 3;
          const yearDecay = Math.pow(PICK_YEAR_DECAY, yearOffset - 1);

          for (const lt of dynLeagueTypes) {
            let value = basePickValue * yearDecay;

            // SF boost for round 1
            if (lt.qb === 'SF' && round === 1) {
              value *= PICK_SF_FIRST_ROUND_MULTIPLIER;
            }

            value = clampRound(value);

            insertValue.run(assetId, lt.id, value, now);
            insertLog.run(assetId, lt.id, value, value);
            insertHistory.run(assetId, lt.id, today, value);
            pickValueCount++;
          }
        }
      }
    }
  });
  seedPicks();

  const pickCount = (db.prepare('SELECT COUNT(*) as c FROM picks').get() as any).c;
  console.log(`  Created ${pickCount} picks, ${pickValueCount} pick values across 12 DYN sets`);

  // Step 6: Summary
  const totalValues = (db.prepare('SELECT COUNT(*) as c FROM asset_values').get() as any).c;
  const totalLogs = (db.prepare('SELECT COUNT(*) as c FROM adjustment_log').get() as any).c;
  console.log(`\n[6/7] Summary:`);
  console.log(`  Total asset_values: ${totalValues}`);
  console.log(`  Total adjustment_log entries: ${totalLogs}`);
  console.log(`  Total value_history snapshots: ${totalValues}`);

  console.log('\n[7/7] Seed complete!');
}

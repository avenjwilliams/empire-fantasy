import type Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  clampRound,
  rankToValue,
  RANK_DECAY_K,
  SCORING_MULTIPLIERS,
} from '@empire-fantasy/shared';
import type { Position, LeagueType } from '@empire-fantasy/shared';
import { initDb, closeDb } from '../server/src/db/db.js';
import {
  loadSleeperPlayers,
  loadSeedRankingsCSV,
  recoverSeedRanks,
  applyScoringMultipliers,
  CSV_SETS,
  SeedConfig,
  SeedRankingRow,
  Position,
  LeagueType,
} from '../server/src/services/seedService.js';

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

/** Old rankToValue with 100 amplitude (×10 for migration) — kept local because it models what migration 004 produced. */
function oldRankToValue100(rank: number, totalPlayers: number): number {
  const N = totalPlayers;
  const raw = 100 * Math.exp(-RANK_DECAY_K * (rank - 1) / N);
  return clampRound(raw);
}

/** Clamp at 100-scale (what migration 004 did before ×10) */
function clampRound100(v: number): number {
  const clamped = Math.max(1.0, Math.min(100.0, v));
  return Math.round(clamped * 10) / 10;
}

/** Apply scoring multipliers at 100-scale (migration 004 behavior), then clampRound100 */
function applyScoringMultipliers100(baseValue: number, position: Position, leagueType: LeagueType): number {
  let value = baseValue;

  // Reception scoring adjustment
  if (leagueType.rec === 'HALF') {
    const mult = SCORING_MULTIPLIERS.HALF[position as keyof typeof SCORING_MULTIPLIERS.HALF];
    value *= mult;
  } else if (leagueType.rec === 'ZERO') {
    const mult = SCORING_MULTIPLIERS.ZERO[position as keyof typeof SCORING_MULTIPLIERS.ZERO];
    value *= mult;
  }
  // PPR is the baseline, no adjustment

  // TEP adjustment
  if (leagueType.tep === 1 && position === 'TE') {
    value *= SCORING_MULTIPLIERS.TEP.TE;
  }

  return clampRound100(value);
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
    const dbForLts = initDb(dbPath);
    const leagueTypes = dbForLts.prepare('SELECT * FROM league_types').all() as {
      id: number;
      code: string;
      format: string;
      qb: string;
      rec: string;
      tep: number;
    }[];
    closeDb(dbForLts);

    const ltByCode = new Map(leagueTypes.map(lt => [lt.code, lt]));
    const ltById = new Map(leagueTypes.map(lt => [lt.id, lt]));

    // --- 1. Recover seed ranks ---
    console.log('\n[1/5] Recovering seed ranks from CSV sources...');
    const dbForRanks = initDb(dbPath);
    const seedRanks = recoverSeedRanks(dbForRanks, config);
    closeDb(dbForRanks);
    console.log(`  Recovered ranks for ${seedRanks.size} assets across ${CSV_SETS.length} base sets`);

    // --- 2. Read current values ---
    console.log('\n[2/5] Reading current asset values...');
    const dbForValues = initDb(dbPath);
    const currentValues = dbForValues.prepare(`
      SELECT av.asset_id, av.league_type_id, av.value, lt.code as leagueTypeCode
      FROM asset_values av
      JOIN league_types lt ON lt.id = av.league_type_id
    `).all() as { asset_id: number; league_type_id: number; value: number; leagueTypeCode: string }[];
    closeDb(dbForValues);

    const currentByAsset = new Map<number, Map<number, { value: number; code: string }>>();
    for (const row of currentValues) {
      const m = currentByAsset.get(row.asset_id) || new Map();
      m.set(row.league_type_id, { value: row.value, code: row.leagueTypeCode });
      currentByAsset.set(row.asset_id, m);
    }

    // --- 3. For each asset, compute precise base per league type ---
    console.log('\n[3/5] Computing rebase deltas...');

    // First, compute N per base set from the actual seed CSV row counts
    const baseSetSizes = new Map<string, number>();
    for (const setCode of CSV_SETS) {
      const rows = loadSeedRankingsCSV(config, setCode);
      baseSetSizes.set(setCode, rows.length);
    }
    console.log('  Base set N values:', Object.fromEntries(baseSetSizes));

    // --- Idempotency: load existing rebase adjustment_log entries ---
    console.log('\n  Loading existing rebase log for idempotency...');
    const dbForLogs = initDb(dbPath);
    const rebaseLogs = dbForLogs.prepare(`
      SELECT asset_id, league_type_id, old_value, detail
      FROM adjustment_log
      WHERE reason = 'manual' AND detail LIKE '%"rebase":true%'
    `).all() as { asset_id: number; league_type_id: number; old_value: number; detail: string }[];
    closeDb(dbForLogs);

    const rebaseLogMap = new Map<string, number>(); // key: "assetId:leagueTypeId" -> old_value
    for (const log of rebaseLogs) {
      rebaseLogMap.set(`${log.asset_id}:${log.league_type_id}`, log.old_value);
    }
    console.log(`  Found ${rebaseLogMap.size} existing rebase log entries`);

    let touched = 0;
    let unchanged = 0;
    let noRank = 0;
    let skippedNoRankInBaseSet = 0;
    const deltas: { assetId: number; code: string; old: number; new: number; drift: number; baseBefore: number; baseAfter: number }[] = [];

    for (const [assetId, baseSetMap] of seedRanks) {
      const currentMap = currentByAsset.get(assetId);
      if (!currentMap) {
        noRank++;
        continue;
      }

      // For each league type this asset has a value for
      for (const [ltId, { value: currentValue, code }] of currentMap) {
        const lt = ltByCode.get(code);
        if (!lt) continue;

        // Determine which base set this league type maps to
        const baseKey = `${lt.format}_${lt.qb}`;
        const rankInfo = baseSetMap.get(baseKey);
        if (!rankInfo) {
          // Asset doesn't have a rank in this base set (e.g., RED_SF has fewer players)
          skippedNoRankInBaseSet++;
          continue;
        }

        const { rank, position } = rankInfo;
        const N = baseSetSizes.get(baseKey);
        if (!N) {
          noRank++;
          continue;
        }

        // Compute precise base with 999.9 amplitude
        const preciseBase = rankToValue(rank, N);
        const baseAfter = applyScoringMultipliers(preciseBase, position, {
          code: lt.code,
          format: lt.format,
          qb: lt.qb,
          rec: lt.rec,
          tep: lt.tep,
        } as LeagueType);

        // Compute quantized base (what migration 004 produced):
        // 1. oldRankToValue100 at 100-scale
        // 2. Apply multipliers at 100-scale, clampRound100
        // 3. Multiply by 10 (migration 004 did ROUND(value * 10, 1))
        const quantizedBase = oldRankToValue100(rank, N);
        const quantizedBaseAfter = applyScoringMultipliers100(quantizedBase, position, {
          code: lt.code,
          format: lt.format,
          qb: lt.qb,
          rec: lt.rec,
          tep: lt.tep,
        } as LeagueType);
        const quantizedBaseFinal = Math.round(quantizedBaseAfter * 100) / 10; // clampRound at 1000-scale after ×10

        // Idempotency: if already rebased, use the pre-rebase old_value as drift basis
        const logKey = `${assetId}:${ltId}`;
        const driftBasis = rebaseLogMap.has(logKey) ? rebaseLogMap.get(logKey)! : currentValue;
        const drift = driftBasis - quantizedBaseFinal;

        // New value = preciseBase + drift
        const newValue = clampRound(baseAfter + drift);

        if (newValue !== currentValue) {
          deltas.push({
            assetId,
            code,
            old: currentValue,
            new: newValue,
            drift,
            baseBefore: quantizedBaseFinal,
            baseAfter,
          });
          touched++;
        } else {
          unchanged++;
        }
      }
    }

    console.log(`  Assets touched: ${touched}`);
    console.log(`  Assets unchanged: ${unchanged}`);
    console.log(`  Assets without any rank: ${noRank}`);
    console.log(`  Assets skipped (no rank in this base set): ${skippedNoRankInBaseSet}`);

    // Summary stats
    const wholeCount = deltas.filter(d => Number.isInteger(d.new * 10)).length;
    const wholePct = touched > 0 ? Math.round(wholeCount / touched * 100) : 0;
    console.log(`  Values ending in .0: ${wholeCount}/${touched} (${wholePct}%)`);

    if (deltas.length > 0) {
      const maxDelta = deltas.reduce((max, d) => Math.max(max, Math.abs(d.new - d.old)), 0);
      console.log(`  Max absolute delta: ${maxDelta.toFixed(1)}`);
      
      // Idempotency check: no asset should move by more than ~2.0 on re-run
      if (!dryRun) {
        const maxReRunDelta = deltas.reduce((max, d) => Math.max(max, Math.abs(d.new - d.old)), 0);
        if (maxReRunDelta > 2.0) {
          console.warn(`  WARNING: Max delta ${maxReRunDelta.toFixed(1)} > 2.0 — idempotency may be broken!`);
        }
      }
    }

    if (dryRun) {
      console.log('\n[DRY RUN] No changes written.');
      return;
    }

    // --- 4. Write changes ---
    console.log('\n[4/5] Writing changes to DB...');
    const dbForWrite = initDb(dbPath);
    const updateValue = dbForWrite.prepare('UPDATE asset_values SET value = ?, updated_at = ? WHERE asset_id = ? AND league_type_id = ?');
    const insertLog = dbForWrite.prepare(`
      INSERT INTO adjustment_log (asset_id, league_type_id, old_value, new_value, delta, reason, detail)
      VALUES (?, ?, ?, ?, ?, 'manual', ?)
    `);
    const insertHistory = dbForWrite.prepare(`
      INSERT OR REPLACE INTO value_history (asset_id, league_type_id, date, value)
      VALUES (?, ?, ?, ?)
    `);
    const today = new Date().toISOString().slice(0, 10);

    const writeTxn = dbForWrite.transaction(() => {
      for (const d of deltas) {
        const ltId = ltByCode.get(d.code)!.id;
        updateValue.run(d.new, now, d.assetId, ltId);
        const delta = Math.round((d.new - d.old) * 10) / 10;
        const detail = JSON.stringify({
          rebase: true,
          baseBefore: d.baseBefore.toFixed(1),
          baseAfter: d.baseAfter.toFixed(1),
          driftPreserved: d.drift.toFixed(1),
        });
        insertLog.run(d.assetId, ltId, d.old, d.new, delta, detail);
        insertHistory.run(d.assetId, ltId, today, d.new);
      }
    });
    writeTxn();
    closeDb(dbForWrite);
    console.log(`  Wrote ${deltas.length} adjustments to DB.`);

    // --- 5. Export CSVs ---
    console.log('\n[5/5] Exporting updated rankings CSVs...');
    console.log(`  Run: npm run rankings:export (outside this script)`);
    console.log('\n✅ Precision rebase complete!');
  } finally {
    closeDb(db);
  }
}

main().catch(e => {
  console.error('❌ Rebase failed:', e);
  process.exit(1);
});
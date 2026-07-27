import type Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import {
  clampRound,
  computeFantasyPoints,
  computeStatDelta,
  computeAgeNudge,
  computeExpectations,
  populationStddev,
  MIN_VALUE_FOR_EXPECTATION,
  INACTIVE_THRESHOLD_WEEKS,
  INACTIVE_DECAY_RATE,
  INACTIVE_FLOOR,
  INACTIVE_MIN_VALUE,
} from '@empire-fantasy/shared';
import type { Position, RecScoring, TEPSetting, Format, WeekStats } from '@empire-fantasy/shared';

interface IngestConfig {
  fixturesMode: boolean;
  dataDir: string;
  season: number;
  week: number;
  force: boolean;
}

// ---- Stats Fetching ----

function loadWeekStats(config: IngestConfig): Record<string, WeekStats> {
  if (config.fixturesMode) {
    const fixturePath = path.join(config.dataDir, 'fixtures/week-stats.sample.json');
    return JSON.parse(fs.readFileSync(fixturePath, 'utf-8'));
  }

  // Live: fetch from Sleeper API cache file
  const rawDir = path.join(config.dataDir, 'raw');
  const statsFile = path.join(rawDir, `stats-${config.season}-${config.week}.json`);

  if (fs.existsSync(statsFile)) {
    return JSON.parse(fs.readFileSync(statsFile, 'utf-8'));
  }

  throw new Error(
    `Stats file not found: ${statsFile}. ` +
    `Fetch it first with: curl -o "${statsFile}" ` +
    `"https://api.sleeper.app/v1/stats/nfl/regular/${config.season}/${config.week}"`
  );
}

// ---- Upsert Raw Stats ----

function upsertWeeklyStats(
  db: Database.Database,
  rawStats: Record<string, WeekStats>,
  season: number,
  week: number,
): number {
  const upsert = db.prepare(`
    INSERT OR REPLACE INTO weekly_stats (player_id, season, week, raw)
    VALUES (?, ?, ?, ?)
  `);

  // Map sleeper_id → player_id
  const playerLookup = db.prepare(
    'SELECT id FROM players WHERE sleeper_id = ?'
  );

  let count = 0;
  const run = db.transaction(() => {
    for (const [sleeperId, stats] of Object.entries(rawStats)) {
      const player = playerLookup.get(sleeperId) as { id: number } | undefined;
      if (!player) continue;

      // Skip players with zero total stats (no game)
      const total = (stats.pass_yd ?? 0) + (stats.rush_yd ?? 0) +
        (stats.rec_yd ?? 0) + (stats.pass_td ?? 0) + (stats.rush_td ?? 0) +
        (stats.rec_td ?? 0) + (stats.rec ?? 0);
      if (total === 0) continue;

      upsert.run(player.id, season, week, JSON.stringify(stats));
      count++;
    }
  });
  run();
  return count;
}

// ---- Performance Adjustments ----

interface PlayerForAdjustment {
  playerId: number;
  assetId: number;
  position: Position;
  age: number | null;
  value: number;
  stats: WeekStats;
}

export function applyPerformanceAdjustments(
  db: Database.Database,
  season: number,
  week: number,
): { adjustments: number; skipped: number } {
  const now = new Date().toISOString().slice(0, 19).replace('T', ' ');

  const leagueTypes = db.prepare('SELECT * FROM league_types').all() as {
    id: number; code: string; format: string; qb: string; rec: string; tep: number;
  }[];

  const updateValue = db.prepare(
    'UPDATE asset_values SET value = ?, updated_at = ? WHERE asset_id = ? AND league_type_id = ?'
  );
  const insertLog = db.prepare(`
    INSERT INTO adjustment_log (asset_id, league_type_id, old_value, new_value, delta, reason, detail)
    VALUES (?, ?, ?, ?, ?, 'stat', ?)
  `);

  let totalAdjustments = 0;
  let totalSkipped = 0;

  const applyAll = db.transaction(() => {
    for (const lt of leagueTypes) {
      const rec = lt.rec as RecScoring;
      const tep = (lt.tep === 1 ? 'TEP' : 'STD') as TEPSetting;
      const format = lt.format as Format;
      const isDynasty = format === 'DYN';

      // Get all players who have stats for this week AND have values in this league type
      const playersWithStats = db.prepare(`
        SELECT p.id as playerId, a.id as assetId, p.position, p.age,
               av.value, ws.raw
        FROM players p
        JOIN assets a ON a.player_id = p.id
        JOIN asset_values av ON av.asset_id = a.id AND av.league_type_id = ?
        JOIN weekly_stats ws ON ws.player_id = p.id AND ws.season = ? AND ws.week = ?
        WHERE av.value >= ?
      `).all(lt.id, season, week, MIN_VALUE_FOR_EXPECTATION) as {
        playerId: number; assetId: number; position: string; age: number | null;
        value: number; raw: string;
      }[];

      if (playersWithStats.length === 0) continue;

      // Parse stats and compute fantasy points
      const players: (PlayerForAdjustment & { fantasyPoints: number })[] = [];
      for (const row of playersWithStats) {
        const stats: WeekStats = JSON.parse(row.raw);
        const pts = computeFantasyPoints(stats, rec, tep, row.position as Position);
        players.push({
          playerId: row.playerId,
          assetId: row.assetId,
          position: row.position as Position,
          age: row.age,
          value: row.value,
          stats,
          fantasyPoints: pts,
        });
      }

      // Group by position and compute expectations
      const byPosition = new Map<Position, typeof players>();
      for (const p of players) {
        const arr = byPosition.get(p.position) || [];
        arr.push(p);
        byPosition.set(p.position, arr);
      }

      for (const [position, posPlayers] of byPosition) {
        if (posPlayers.length < 2) {
          totalSkipped += posPlayers.length;
          continue;
        }

        // Build expectation model
        const entries = posPlayers.map(p => ({
          assetId: p.assetId,
          value: p.value,
          actualPoints: p.fantasyPoints,
        }));

        const expectations = computeExpectations(entries);
        const allScores = posPlayers.map(p => p.fantasyPoints);
        const stddev = populationStddev(allScores);

        // Compute and apply deltas
        for (const exp of expectations) {
          const player = posPlayers.find(p => p.assetId === exp.assetId)!;
          const oldValue = player.value;

          // Performance delta
          let perfDelta = computeStatDelta(exp.surprise, stddev, format);

          // Dynasty age nudge
          let ageNudge = 0;
          if (isDynasty) {
            ageNudge = computeAgeNudge(player.position, player.age);
          }

          const totalDelta = perfDelta + ageNudge;
          const newValue = clampRound(oldValue + totalDelta);
          const roundedDelta = Math.round((newValue - oldValue) * 10) / 10;

          updateValue.run(newValue, now, player.assetId, lt.id);

          const detail = JSON.stringify({
            season,
            week,
            pts: player.fantasyPoints,
            expected: Math.round(exp.expected * 100) / 100,
            delta: Math.round(perfDelta * 100) / 100,
            ...(ageNudge !== 0 ? { ageNudge } : {}),
          });

          insertLog.run(player.assetId, lt.id, oldValue, newValue, roundedDelta, detail);
          totalAdjustments++;
        }
      }
    }
  });

  applyAll();
  return { adjustments: totalAdjustments, skipped: totalSkipped };
}

// ---- Inactive Decay ----

export function applyInactiveDecay(
  db: Database.Database,
  currentSeason: number,
  currentWeek: number,
): { decayed: number } {
  const now = new Date().toISOString().slice(0, 19).replace('T', ' ');

  // Only run if we have processed weeks this season (we're in-season)
  const hasProcessed = db.prepare(
    'SELECT 1 FROM processed_weeks WHERE season = ? LIMIT 1'
  ).get(currentSeason);
  if (!hasProcessed) return { decayed: 0 };

  const leagueTypes = db.prepare('SELECT * FROM league_types').all() as {
    id: number; code: string; format: string;
  }[];

  const updateValue = db.prepare(
    'UPDATE asset_values SET value = ?, updated_at = ? WHERE asset_id = ? AND league_type_id = ?'
  );
  const insertLog = db.prepare(`
    INSERT INTO adjustment_log (asset_id, league_type_id, old_value, new_value, delta, reason, detail)
    VALUES (?, ?, ?, ?, ?, 'stat', ?)
  `);

  let decayed = 0;

  const applyAll = db.transaction(() => {
    for (const lt of leagueTypes) {
      // Find players with value above floor who have no recent stats
      const candidates = db.prepare(`
        SELECT av.asset_id, av.value, p.id as playerId, p.name
        FROM asset_values av
        JOIN assets a ON av.asset_id = a.id
        JOIN players p ON a.player_id = p.id
        WHERE av.league_type_id = ? AND av.value > ?
        AND NOT EXISTS (
          SELECT 1 FROM weekly_stats ws
          WHERE ws.player_id = p.id
          AND (ws.season > ? OR (ws.season = ? AND ws.week > ?))
        )
      `).all(
        lt.id, INACTIVE_MIN_VALUE,
        currentSeason, currentSeason, currentWeek - INACTIVE_THRESHOLD_WEEKS,
      ) as { asset_id: number; value: number; playerId: number; name: string }[];

      for (const c of candidates) {
        const oldValue = c.value;
        const newValue = clampRound(oldValue * (1 - INACTIVE_DECAY_RATE));
        if (newValue === oldValue) continue;

        const delta = Math.round((newValue - oldValue) * 10) / 10;
        updateValue.run(newValue, now, c.asset_id, lt.id);

        const detail = JSON.stringify({
          inactive_weeks: INACTIVE_THRESHOLD_WEEKS,
          decay_rate: INACTIVE_DECAY_RATE,
        });
        insertLog.run(c.asset_id, lt.id, oldValue, newValue, delta, detail);
        decayed++;
      }
    }
  });

  applyAll();
  return { decayed };
}

// ---- Main Ingest Function ----

export function ingestWeek(db: Database.Database, config: IngestConfig): void {
  console.log('=== Empire Fantasy — Stats Ingestion ===');
  console.log(`Season ${config.season}, Week ${config.week}`);
  console.log(`Mode: ${config.fixturesMode ? 'FIXTURES' : 'LIVE'}`);

  // Idempotency check
  const existing = db.prepare(
    'SELECT 1 FROM processed_weeks WHERE season = ? AND week = ?'
  ).get(config.season, config.week);

  if (existing && !config.force) {
    console.log(`\nWeek ${config.week} already processed. Use --force to re-run.`);
    return;
  }

  // Step 1: Load stats
  console.log('\n[1/4] Loading week stats...');
  const rawStats = loadWeekStats(config);
  const playerCount = Object.keys(rawStats).length;
  console.log(`  Found stats for ${playerCount} players`);

  // Step 2: Upsert into weekly_stats
  console.log('\n[2/4] Storing raw stats...');
  const stored = upsertWeeklyStats(db, rawStats, config.season, config.week);
  console.log(`  Stored ${stored} player stat rows`);

  // Step 3: Apply performance adjustments across all league types
  console.log('\n[3/5] Applying performance adjustments...');
  const { adjustments, skipped } = applyPerformanceAdjustments(
    db, config.season, config.week,
  );
  console.log(`  ${adjustments} adjustments applied, ${skipped} skipped (< 2 at position)`);

  // Step 4: Apply inactive decay for players with no recent stats
  console.log('\n[4/5] Applying inactive decay...');
  const { decayed } = applyInactiveDecay(db, config.season, config.week);
  console.log(`  ${decayed} values decayed for inactive players`);

  // Step 5: Mark week as processed
  console.log('\n[5/5] Marking week as processed...');
  if (existing && config.force) {
    db.prepare('UPDATE processed_weeks SET processed_at = datetime(\'now\') WHERE season = ? AND week = ?')
      .run(config.season, config.week);
  } else {
    db.prepare('INSERT INTO processed_weeks (season, week) VALUES (?, ?)')
      .run(config.season, config.week);
  }

  // Summary
  const totalLogs = (db.prepare(
    "SELECT COUNT(*) as c FROM adjustment_log WHERE reason = 'stat'"
  ).get() as any).c;
  console.log(`\nDone! Total stat log entries: ${totalLogs}`);
}

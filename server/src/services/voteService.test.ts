import { describe, it, expect, beforeEach } from 'vitest';
import { initDb } from '../db/db.js';
import { seedLeagueTypes } from '../db/seedLeagueTypes.js';
import { generatePrompt, skipPrompt } from './voteService.js';

const LEAGUE_CODE = 'RED_1QB_HALF_STD';

function seedTestDb(db: any): number {
  // Two sessions — foreign key on ktc_prompts.session_id requires them.
  db.prepare('INSERT INTO sessions (id) VALUES (?)').run('session-1');
  db.prepare('INSERT INTO sessions (id) VALUES (?)').run('session-2');

  // Seed league types (24 rows). Then resolve the league_type_id for our fixed code.
  seedLeagueTypes(db);
  const ltRow = db.prepare('SELECT id FROM league_types WHERE code = ?').get(LEAGUE_CODE) as { id: number };
  const leagueTypeId = ltRow.id;

  // 10 clustered players in the anchor window [20, 95].
  // Values 50.0–54.5 (step 0.5) → every asset within NARROW_SPREAD (6.0) of every other.
  // That guarantees a valid trio on the first attempt.
  const names = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J'];
  for (let i = 0; i < names.length; i++) {
    const player = db.prepare(
      'INSERT INTO players (sleeper_id, name, position, team, age) VALUES (?, ?, ?, ?, ?)'
    ).run(`sleeper-${i}`, `Player ${names[i]}`, 'RB', 'DAL', 25);
    const playerId = Number(player.lastInsertRowid);

    const asset = db.prepare('INSERT INTO assets (kind, player_id) VALUES (?, ?)')
      .run('player', playerId);
    const assetId = Number(asset.lastInsertRowid);

    const value = 50.0 + i * 0.5; // 50.0, 50.5, … 54.5
    db.prepare(
      'INSERT INTO asset_values (asset_id, league_type_id, value, updated_at) VALUES (?, ?, ?, ?)'
    ).run(assetId, leagueTypeId, value, '2026-08-06 00:00:00');
  }

  return leagueTypeId;
}

describe('voteService generatePrompt / skipPrompt', () => {
  let db: any;
  let leagueTypeId: number;

  beforeEach(() => {
    db = initDb(':memory:');
    leagueTypeId = seedTestDb(db);
  });

  function assertSuccess<T extends object>(result: T | { error: string; code: number }): asserts result is T {
    if ('error' in result) throw new Error(`Expected success, got error: ${result.error}`);
  }

  // Regression — skipping yields a new prompt
  it('does not reuse a skipped prompt — second promptId differs', () => {
    const first = generatePrompt(db, 'session-1', LEAGUE_CODE);
    assertSuccess(first);

    const skip = skipPrompt(db, 'session-1', first.promptId);
    expect(skip).toEqual({ success: true });

    const second = generatePrompt(db, 'session-1', LEAGUE_CODE);
    assertSuccess(second);

    expect(second.promptId).not.toBe(first.promptId);
  });

  // Double-skip still 409s
  it('skipping twice returns 409 (the guard stays)', () => {
    const first = generatePrompt(db, 'session-1', LEAGUE_CODE);
    assertSuccess(first);

    expect(skipPrompt(db, 'session-1', first.promptId)).toEqual({ success: true });

    const again = skipPrompt(db, 'session-1', first.promptId);
    expect(again).toEqual({ success: false, error: 'Prompt already skipped', code: 409 });
  });

  // Un-skipped prompts are still reused (intentional behavior)
  it('reuses an unanswered, un-skipped prompt', () => {
    const first = generatePrompt(db, 'session-1', LEAGUE_CODE);
    assertSuccess(first);

    const second = generatePrompt(db, 'session-1', LEAGUE_CODE);
    assertSuccess(second);

    expect(second.promptId).toBe(first.promptId);
  });

  // Cross-session skip is rejected
  it('skipping a prompt belonging to another session returns 403 and leaves skipped_at null', () => {
    const first = generatePrompt(db, 'session-1', LEAGUE_CODE);
    assertSuccess(first);

    const result = skipPrompt(db, 'session-2', first.promptId);
    expect(result).toEqual({ success: false, error: 'Prompt belongs to another session', code: 403 });

    const row = db.prepare('SELECT skipped_at FROM ktc_prompts WHERE id = ?')
      .get(first.promptId) as { skipped_at: string | null };
    expect(row.skipped_at).toBeNull();
  });
});
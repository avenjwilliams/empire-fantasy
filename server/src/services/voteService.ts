import type Database from 'better-sqlite3';
import { clampRound, computeVoteDeltas, VOTE_CONSTANTS } from '@empire-fantasy/shared';
import { parseCode } from '@empire-fantasy/shared';

/** League types that get 2x selection weight */
const WEIGHTED_CODES = new Set([
  'DYN_SF_PPR_STD', 'DYN_1QB_PPR_STD',
  'RED_1QB_HALF_STD', 'RED_1QB_PPR_STD',
]);

const MAX_VOTES_PER_DAY = 20;
const ANCHOR_MIN = 20;
const ANCHOR_MAX = 95;
const NARROW_SPREAD = 6.0;
const WIDE_SPREAD = 10.0;

interface PromptAsset {
  asset_id: number;
  name: string;
  position: string;
  team: string | null;
  age: number | null;
}

interface PromptResponse {
  promptId: number;
  leagueType: string;
  assets: PromptAsset[];
}

// ---- Prompt Generation ----

export function generatePrompt(
  db: Database.Database,
  sessionId: string,
  leagueTypeCode?: string,
): PromptResponse | { error: string; code: number } {
  // Check daily vote count
  const today = new Date().toISOString().slice(0, 10);
  const voteCount = db.prepare(`
    SELECT COUNT(*) as c FROM ktc_votes v
    JOIN ktc_prompts p ON p.id = v.prompt_id
    WHERE p.session_id = ? AND DATE(v.created_at) = ?
  `).get(sessionId, today) as { c: number };

  if (voteCount.c >= MAX_VOTES_PER_DAY) {
    return { error: 'Daily vote limit reached', code: 429 };
  }

  // If a league type was provided, resolve it
  let forcedLeagueTypeId: number | null = null;
  if (leagueTypeCode) {
    const parsed = parseCode(leagueTypeCode);
    if (!parsed) {
      return { error: `Invalid league type: ${leagueTypeCode}`, code: 400 };
    }
    const ltRow = db.prepare('SELECT id FROM league_types WHERE code = ?').get(leagueTypeCode) as { id: number } | undefined;
    if (!ltRow) {
      return { error: `League type not found: ${leagueTypeCode}`, code: 400 };
    }
    forcedLeagueTypeId = ltRow.id;
  }

  // Check for unanswered prompt
  // With a leagueType param: only reuse if league_type_id matches
  // Without param: reuse most recent regardless of type
  let unansweredQuery = `
    SELECT p.id as promptId, lt.code as leagueType,
      p.asset_a, p.asset_b, p.asset_c
    FROM ktc_prompts p
    JOIN league_types lt ON lt.id = p.league_type_id
    WHERE p.session_id = ? AND p.answered_at IS NULL
  `;
  const queryParams: (string | number)[] = [sessionId];

  if (forcedLeagueTypeId !== null) {
    unansweredQuery += ' AND p.league_type_id = ?';
    queryParams.push(forcedLeagueTypeId);
  }

  unansweredQuery += ' ORDER BY p.created_at DESC LIMIT 1';

  const unanswered = db.prepare(unansweredQuery).get(...queryParams) as any;

  if (unanswered) {
    return buildPromptResponse(db, unanswered.promptId, unanswered.leagueType,
      [unanswered.asset_a, unanswered.asset_b, unanswered.asset_c]);
  }

  // Pick a league type
  let lt: { id: number; code: string; format: string };
  if (forcedLeagueTypeId !== null) {
    lt = db.prepare('SELECT id, code, format FROM league_types WHERE id = ?')
      .get(forcedLeagueTypeId) as { id: number; code: string; format: string };
  } else {
    // Weighted random selection (original behavior)
    const allLts = db.prepare('SELECT id, code, format FROM league_types').all() as {
      id: number; code: string; format: string;
    }[];
    const weighted: typeof allLts = [];
    for (const l of allLts) {
      weighted.push(l);
      if (WEIGHTED_CODES.has(l.code)) weighted.push(l);
    }
    lt = weighted[Math.floor(Math.random() * weighted.length)];
  }

  const isDynasty = lt.format === 'DYN';

  // Get previously seen trios for this session
  const seenTrios = new Set<string>();
  const prevPrompts = db.prepare(`
    SELECT asset_a, asset_b, asset_c FROM ktc_prompts WHERE session_id = ?
  `).all(sessionId) as { asset_a: number; asset_b: number; asset_c: number }[];
  for (const p of prevPrompts) {
    seenTrios.add(trioKey(p.asset_a, p.asset_b, p.asset_c));
  }

  // Try to build a prompt — try multiple anchors if needed
  for (let attempt = 0; attempt < 10; attempt++) {
    // Pick whether to use players or picks (for DYN, chance of picks)
    const usePicksThisAttempt = isDynasty && Math.random() < 0.15;
    const kindFilter = usePicksThisAttempt ? "a.kind = 'pick'" : "a.kind = 'player'";

    // Pick a random anchor in [ANCHOR_MIN, ANCHOR_MAX]
    const anchors = db.prepare(`
      SELECT a.id as asset_id, av.value
      FROM asset_values av
      JOIN assets a ON a.id = av.asset_id
      WHERE av.league_type_id = ?
        AND av.value BETWEEN ? AND ?
        AND ${kindFilter}
      ORDER BY RANDOM() LIMIT 1
    `).get(lt.id, ANCHOR_MIN, ANCHOR_MAX) as { asset_id: number; value: number } | undefined;

    if (!anchors) continue;
    const anchor = anchors;

    // Find 2 candidates within spread, same kind
    for (const spread of [NARROW_SPREAD, WIDE_SPREAD]) {
      const candidates = db.prepare(`
        SELECT a.id as asset_id, av.value
        FROM asset_values av
        JOIN assets a ON a.id = av.asset_id
        WHERE av.league_type_id = ?
          AND av.value BETWEEN ? AND ?
          AND a.id != ?
          AND ${kindFilter}
        ORDER BY RANDOM()
      `).all(
        lt.id,
        anchor.value - spread,
        anchor.value + spread,
        anchor.asset_id,
      ) as { asset_id: number; value: number }[];

      // Find 2 that don't form a seen trio
      for (let i = 0; i < candidates.length; i++) {
        for (let j = i + 1; j < candidates.length; j++) {
          const trio = [anchor.asset_id, candidates[i].asset_id, candidates[j].asset_id];
          const key = trioKey(trio[0], trio[1], trio[2]);
          if (seenTrios.has(key)) continue;

          // Found a valid trio — persist and return
          const promptId = createPrompt(db, sessionId, lt.id, trio[0], trio[1], trio[2]);
          return buildPromptResponse(db, promptId, lt.code, trio);
        }
      }
    }
  }

  return { error: 'Could not generate a prompt — try again later', code: 503 };
}

function trioKey(a: number, b: number, c: number): string {
  return [a, b, c].sort((x, y) => x - y).join(',');
}

function createPrompt(
  db: Database.Database, sessionId: string, leagueTypeId: number,
  a: number, b: number, c: number,
): number {
  const result = db.prepare(`
    INSERT INTO ktc_prompts (session_id, league_type_id, asset_a, asset_b, asset_c)
    VALUES (?, ?, ?, ?, ?)
  `).run(sessionId, leagueTypeId, a, b, c);
  return Number(result.lastInsertRowid);
}

function buildPromptResponse(
  db: Database.Database, promptId: number, leagueType: string, assetIds: number[],
): PromptResponse {
  const assets: PromptAsset[] = [];
  for (const id of assetIds) {
    const row = db.prepare(`
      SELECT a.id as asset_id,
        CASE
          WHEN a.kind = 'player' THEN p.name
          WHEN a.kind = 'pick' THEN (pk.season || ' ' || pk.tier || ' ' ||
            CASE pk.round WHEN 1 THEN '1st' WHEN 2 THEN '2nd' WHEN 3 THEN '3rd' WHEN 4 THEN '4th' END)
        END as name,
        CASE WHEN a.kind = 'player' THEN p.position ELSE 'PICK' END as position,
        CASE WHEN a.kind = 'player' THEN p.team ELSE NULL END as team,
        CASE WHEN a.kind = 'player' THEN p.age ELSE NULL END as age
      FROM assets a
      LEFT JOIN players p ON a.player_id = p.id
      LEFT JOIN picks pk ON a.pick_id = pk.id
      WHERE a.id = ?
    `).get(id) as PromptAsset;
    if (row) assets.push(row);
  }

  // Shuffle display order
  for (let i = assets.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [assets[i], assets[j]] = [assets[j], assets[i]];
  }

  return { promptId, leagueType, assets };
}

// ---- Vote Application ----

export function applyVote(
  db: Database.Database,
  sessionId: string,
  promptId: number,
  keepId: number,
  tradeId: number,
  cutId: number,
): { success: boolean; error?: string; code?: number } {
  // Validate prompt belongs to this session and is unanswered
  const prompt = db.prepare(`
    SELECT p.id, p.session_id, p.league_type_id, p.asset_a, p.asset_b, p.asset_c, p.answered_at
    FROM ktc_prompts p WHERE p.id = ?
  `).get(promptId) as any;

  if (!prompt) return { success: false, error: 'Prompt not found', code: 404 };
  if (prompt.session_id !== sessionId) return { success: false, error: 'Prompt belongs to another session', code: 403 };
  if (prompt.answered_at) return { success: false, error: 'Prompt already answered', code: 409 };

  // Validate the three IDs match the prompt's assets
  const promptAssets = new Set([prompt.asset_a, prompt.asset_b, prompt.asset_c]);
  const voteAssets = new Set([keepId, tradeId, cutId]);
  if (voteAssets.size !== 3 || ![keepId, tradeId, cutId].every(id => promptAssets.has(id))) {
    return { success: false, error: 'Vote assets must match prompt assets', code: 400 };
  }

  const ltId = prompt.league_type_id;
  const now = new Date().toISOString().slice(0, 19).replace('T', ' ');

  // Get current values with null guard (robustness fix)
  const getValue = (assetId: number): number | null => {
    const row = db.prepare('SELECT value FROM asset_values WHERE asset_id = ? AND league_type_id = ?')
      .get(assetId, ltId) as { value: number } | undefined;
    return row?.value ?? null;
  };

  const keepValue = getValue(keepId);
  const tradeValue = getValue(tradeId);
  const cutValue = getValue(cutId);

  if (keepValue === null || tradeValue === null || cutValue === null) {
    return { success: false, error: 'One or more assets missing value for this league type', code: 422 };
  }

  // Check dampening for each asset
  const getK = (assetId: number): number => {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
      .toISOString().slice(0, 19).replace('T', ' ');
    const count = db.prepare(`
      SELECT COUNT(*) as c FROM adjustment_log
      WHERE asset_id = ? AND league_type_id = ? AND reason = 'vote' AND created_at >= ?
    `).get(assetId, ltId, sevenDaysAgo) as { c: number };
    return count.c > VOTE_CONSTANTS.DAMPEN_THRESHOLD
      ? VOTE_CONSTANTS.K_DAMPENED
      : VOTE_CONSTANTS.K;
  };

  const kKeep = getK(keepId);
  const kTrade = getK(tradeId);
  const kCut = getK(cutId);

  // Compute deltas
  const { keepDelta, tradeDelta, cutDelta } = computeVoteDeltas(
    keepValue, tradeValue, cutValue, kKeep, kTrade, kCut,
  );

  // Apply in a single transaction
  const applyAll = db.transaction(() => {
    // Insert vote record
    db.prepare(`
      INSERT INTO ktc_votes (prompt_id, keep_asset, trade_asset, cut_asset) VALUES (?, ?, ?, ?)
    `).run(promptId, keepId, tradeId, cutId);

    // Mark prompt answered
    db.prepare('UPDATE ktc_prompts SET answered_at = ? WHERE id = ?').run(now, promptId);

    // Update each asset's value and log
    const updates: { assetId: number; oldValue: number; delta: number }[] = [
      { assetId: keepId, oldValue: keepValue, delta: keepDelta },
      { assetId: tradeId, oldValue: tradeValue, delta: tradeDelta },
      { assetId: cutId, oldValue: cutValue, delta: cutDelta },
    ];

    for (const { assetId, oldValue, delta } of updates) {
      const newValue = clampRound(oldValue + delta);
      const roundedDelta = Math.round((newValue - oldValue) * 10) / 10;

      db.prepare('UPDATE asset_values SET value = ?, updated_at = ? WHERE asset_id = ? AND league_type_id = ?')
        .run(newValue, now, assetId, ltId);

      db.prepare(`
        INSERT INTO adjustment_log (asset_id, league_type_id, old_value, new_value, delta, reason, detail)
        VALUES (?, ?, ?, ?, ?, 'vote', ?)
      `).run(assetId, ltId, oldValue, newValue, roundedDelta, JSON.stringify({ promptId }));
    }
  });

  applyAll();
  return { success: true };
}

// ---- Skip Prompt ----

export function skipPrompt(
  db: Database.Database,
  sessionId: string,
  promptId: number,
): { success: boolean; error?: string; code?: number } {
  const now = new Date().toISOString().slice(0, 19).replace('T', ' ');

  const prompt = db.prepare(`
    SELECT p.id, p.session_id, p.answered_at, p.skipped_at
    FROM ktc_prompts p WHERE p.id = ?
  `).get(promptId) as any;

  if (!prompt) return { success: false, error: 'Prompt not found', code: 404 };
  if (prompt.session_id !== sessionId) return { success: false, error: 'Prompt belongs to another session', code: 403 };
  if (prompt.answered_at) return { success: false, error: 'Prompt already answered', code: 409 };
  if (prompt.skipped_at) return { success: false, error: 'Prompt already skipped', code: 409 };

  db.prepare('UPDATE ktc_prompts SET skipped_at = ? WHERE id = ?').run(now, promptId);
  return { success: true };
}

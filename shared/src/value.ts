import type { TradeAsset, TradeSide, TradeResult, Verdict, Position, RecScoring, TEPSetting, Format, TradeSuggestion, SideBoomBust } from './types.js';
import {
  SCORING, REC_BONUS, TEP_BONUS,
  STAT_SENSITIVITY, STAT_CAP, AGE_NUDGE,
  RANK_DECAY_K,
} from './constants.js';

// =====================================================
// Constants
// =====================================================

export const VOTE_CONSTANTS = {
  /** Elo K-factor per pairwise comparison. Deliberately NOT scaled with the
   *  1–1000 value range: keeping deltas absolute (~0.1–0.2 per pair) is what
   *  damps individual vote influence to ~1/10 of its old relative weight. */
  K: 0.20,
  /** Dampened K when asset has >30 votes in trailing 7 days */
  K_DAMPENED: 0.10,
  /** Elo scale divisor (±60 spread ≈ 24–76% expectation on 1–1000 scale) */
  ELO_SCALE: 120,
  /** Dampening threshold: votes in trailing 7 days */
  DAMPEN_THRESHOLD: 30,
} as const;

export const TRADE_CONSTANTS = {
  DEPTH_WEIGHTS: [1.0, 0.9, 0.8, 0.65, 0.5, 0.4, 0.3],
  DEPTH_FLOOR: 0.3,
  SCALE_MULTIPLIER: 300,
  BANDS: [
    { threshold: 0.03, verdict: 'Fair trade' as Verdict },
    { threshold: 0.08, verdict: 'Slight edge' as Verdict },
    { threshold: 0.18, verdict: 'Clear win' as Verdict },
  ],
  MAX_ASSETS_PER_SIDE: 15,
} as const;

/** Clamp value to [1.0, 1000.0] and round to one decimal place. */
export function clampRound(v: number): number {
  const clamped = Math.max(1.0, Math.min(1000.0, v));
  return Math.round(clamped * 10) / 10;
}

/** Round to one decimal place without clamping (for side totals, adjustments). */
export function round1(v: number): number {
  return Math.round(v * 10) / 10;
}

/** Linear identity function - used as trueValue for compatibility with client UI. */
export function trueValue(v: number): number {
  return Math.round(v);
}

/** Get depth weight for a given slot index (0-based). */
export function getWeight(index: number): number {
  if (index < TRADE_CONSTANTS.DEPTH_WEIGHTS.length) {
    return TRADE_CONSTANTS.DEPTH_WEIGHTS[index];
  }
  return TRADE_CONSTANTS.DEPTH_FLOOR;
}

/** Determine verdict from lean value. */
export function getVerdict(lean: number): Verdict {
  const absLean = Math.abs(lean);
  if (absLean < TRADE_CONSTANTS.BANDS[0].threshold) return 'Fair trade';
  if (absLean < TRADE_CONSTANTS.BANDS[1].threshold) return 'Slight edge';
  if (absLean < TRADE_CONSTANTS.BANDS[2].threshold) return 'Clear win';
  return 'Landslide';
}

/**
 * Convert rank (1-based) to value (1.0-1000.0).
 * Uses exponential decay: value = 999.9 * exp(-k * (rank-1) / N)
 * Tuned so rank 1 = 999.9, rank ~50 ≈ 620, rank ~200 ≈ 143.
 */
export function rankToValue(rank: number, totalPlayers: number): number {
  const N = totalPlayers;
  const raw = 999.9 * Math.exp(-RANK_DECAY_K * (rank - 1) / N);
  return clampRound(raw);
}

/** Compute weighted side value from an array of asset values (already sorted desc). */
function computeSideValue(linearValues: number[]): number {
  let total = 0;
  for (let i = 0; i < linearValues.length; i++) {
    total += linearValues[i] * getWeight(i);
  }
  return total;
}

/** Compute raw sum, weighted sum, and depth penalty for a sorted array of values. */
function computeSideBreakdown(linearValues: number[]): { rawSum: number; weightedSum: number; depthPenalty: number } {
  const rawSum = linearValues.reduce((sum, v) => sum + v, 0);
  const weightedSum = computeSideValue(linearValues);
  const depthPenalty = rawSum - weightedSum; // ≥ 0
  return { rawSum, weightedSum, depthPenalty };
}

/**
 * Compute value adjustment based on depth penalty difference.
 * The side with the SMALLER depth penalty (fewer/more concentrated pieces) gets the credit.
 * Returns { adjustment: number, adjustmentSide: 1 | 2 | null }
 * adjustment is rounded to 1 decimal, range [0, 1000].
 */
function computeValueAdjustment(
  team1Values: number[],
  team2Values: number[]
): { adjustment: number | null; adjustmentSide: 1 | 2 | null } {
  const breakdown1 = computeSideBreakdown(team1Values);
  const breakdown2 = computeSideBreakdown(team2Values);

  const penaltyDiff = Math.abs(breakdown1.depthPenalty - breakdown2.depthPenalty);
  
  if (penaltyDiff === 0) {
    return { adjustment: null, adjustmentSide: null };
  }

  // Side with SMALLER penalty gets the credit
  const adjustmentSide = breakdown1.depthPenalty < breakdown2.depthPenalty ? 1 : 2;
  const adjustment = round1(penaltyDiff);

  return { adjustment, adjustmentSide };
}

/**
 * Find the linear value (1-1000) that would roughly even the trade
 * when added to the losing side at its next slot weight.
 */
function computeAdviceGap(diff: number, losingAssetCount: number): number | null {
  const nextWeight = getWeight(losingAssetCount);
  // For linear values, we need v * nextWeight >= |diff|
  const neededValue = Math.abs(diff) / nextWeight;
  if (neededValue > 1000) return null; // No single player can close this gap
  return clampRound(neededValue);
}

/**
 * Compute value-weighted mean boom/bust for a side.
 * Weight is raw value (not depth weight), excludes unrated assets.
 * Returns null for boom/bust when no rated assets.
 * Boom and bust are independent — each uses its own denominator.
 */
export function computeSideBoomBust(
  assets: { value: number; boom_pct: number | null; bust_pct: number | null }[]
): SideBoomBust {
  let boomNumerator = 0;
  let bustNumerator = 0;
  let boomDenominator = 0;
  let bustDenominator = 0;
  let ratedCount = 0;
  let unratedCount = 0;

  for (const asset of assets) {
    const hasBoom = asset.boom_pct !== null;
    const hasBust = asset.bust_pct !== null;

    if (!hasBoom && !hasBust) {
      unratedCount++;
      continue;
    }

    ratedCount++;

    if (hasBoom) {
      boomNumerator += asset.value * asset.boom_pct!;
      boomDenominator += asset.value;
    }
    if (hasBust) {
      bustNumerator += asset.value * asset.bust_pct!;
      bustDenominator += asset.value;
    }
  }

  if (ratedCount === 0) {
    // No assets with any rating at all
    return { boom: null, bust: null, ratedCount: 0, unratedCount };
  }

  return {
    boom: boomDenominator > 0 ? Math.round(boomNumerator / boomDenominator) : null,
    bust: bustDenominator > 0 ? Math.round(bustNumerator / bustDenominator) : null,
    ratedCount,
    unratedCount,
  };
}

export interface EvaluateTradeInput {
  leagueType: string;
  team1: { id: number; name: string; value: number; boom_pct?: number | null; bust_pct?: number | null }[];
  team2: { id: number; name: string; value: number; boom_pct?: number | null; bust_pct?: number | null }[];
}

/**
 * Evaluate a trade between two teams.
 * Team 1 and Team 2 are the sides *receiving* assets.
 * Negative scale means trade favors Team 1 (Team 1 received more value).
 * Positive scale means trade favors Team 2 (Team 2 received more value).
 */
export function evaluateTrade(input: EvaluateTradeInput): TradeResult {
  const { leagueType, team1, team2 } = input;

  // Build trade assets sorted by linear value descending
  const buildSide = (assets: { id: number; name: string; value: number; boom_pct?: number | null; bust_pct?: number | null }[]): TradeSide => {
    const sorted = assets
      .slice()
      .sort((a, b) => b.value - a.value);

    const tradeAssets: TradeAsset[] = sorted.map((a, i) => ({
      id: a.id,
      name: a.name,
      value: a.value,
      trueValue: Math.round(a.value), // Keep trueValue for compatibility with client UI
      weight: getWeight(i),
    }));

    const values = sorted.map(a => a.value);
    const breakdown = computeSideBreakdown(values);
    
    // sideValue = rawSum initially; adjustment added later to the credit-receiving side
    // The non-credit side keeps rawSum as its total (not weightedSum)
    return { 
      assets: tradeAssets, 
      sideValue: round1(breakdown.rawSum),
      rawSum: round1(breakdown.rawSum),
      adjustment: 0, // Will be set after adjustment computed
    };
  };

  const side1 = buildSide(team1);
  const side2 = buildSide(team2);

  // Compute value adjustment from depth penalties
  const team1Values = team1.map(a => a.value).sort((a, b) => b - a);
  const team2Values = team2.map(a => a.value).sort((a, b) => b - a);
  const { adjustment, adjustmentSide } = computeValueAdjustment(team1Values, team2Values);

  // Apply adjustment to the appropriate side
  if (adjustment !== null && adjustmentSide !== null) {
    if (adjustmentSide === 1) {
      side1.adjustment = adjustment;
      side1.sideValue = round1(side1.rawSum + adjustment);
    } else {
      side2.adjustment = adjustment;
      side2.sideValue = round1(side2.rawSum + adjustment);
    }
  }

  // Compute diff from adjusted sideValues
  const diff = side1.sideValue - side2.sideValue;
  const total = side1.sideValue + side2.sideValue;
  const lean = diff / Math.max(total, 1);

  const scale = Math.max(-100, Math.min(100, Math.round(-lean * TRADE_CONSTANTS.SCALE_MULTIPLIER)));
  const verdict = getVerdict(lean);

  const verdictLabel = scale === 0 || verdict === 'Fair trade'
    ? verdict
    : `${verdict} — Team ${diff > 0 ? '1' : '2'}`;

  const differencePct = total > 0 ? Math.round(Math.abs(diff) / total * 1000) / 10 : 0;

  // Advice gap: which side is losing and how much to add
  let adviceGap: number | null = null;
  if (verdict !== 'Fair trade') {
    const losingCount = diff > 0 ? team2.length : team1.length;
    adviceGap = computeAdviceGap(diff, losingCount);
  }

  // valueAdjustment: the roster-spot credit (adjustment), reported whenever penalties differ
  const valueAdjustment = adjustment;
  const valueAdjustmentSide = adjustmentSide;

  // Compute boom/bust averages for each side (descriptive only, never affects verdict)
  const team1BoomBust = computeSideBoomBust(team1.map(a => ({ value: a.value, boom_pct: a.boom_pct ?? null, bust_pct: a.bust_pct ?? null })));
  const team2BoomBust = computeSideBoomBust(team2.map(a => ({ value: a.value, boom_pct: a.boom_pct ?? null, bust_pct: a.bust_pct ?? null })));

  return {
    leagueType,
    team1: side1,
    team2: side2,
    scale,
    verdict: verdictLabel,
    differencePct,
    adviceGap,
    valueAdjustment,
    valueAdjustmentSide,
    suggestions: [], // Will be populated by the server route after fetching candidates
    boomBust: {
      team1: team1BoomBust,
      team2: team2BoomBust,
    },
  };
}

/**
 * Compute trade suggestions — concrete assets that would move the trade toward Fair.
 * This is called by the server route after fetching candidate assets from the DB.
 */

export interface TradeSuggestionInput {
  /** The league type code (e.g., "DYN_SF_PPR_STD") */
  leagueType: string;
  /** Current team 1 assets (already on the trade) */
  team1: { id: number; name: string; value: number; position: string; team: string | null; kind: string }[];
  /** Current team 2 assets (already on the trade) */
  team2: { id: number; name: string; value: number; position: string; team: string | null; kind: string }[];
  /** Candidate assets from the DB (already filtered to have values for this league type) */
  candidates: { id: number; name: string; value: number; position: string; team: string | null; kind: string }[];
  /** The initial trade evaluation result (to get lean, verdict, etc.) */
  initialResult: {
    diff: number;
    total: number;
    lean: number;
    verdict: string;
    team1Length: number;
    team2Length: number;
  };
}

/**
 * Simulate adding each candidate asset to the losing side and score by |lean_after|.
 * Returns up to 3 best suggestions, position-diverse.
 */
export function computeTradeSuggestions(input: TradeSuggestionInput): TradeSuggestion[] {
  const { team1, team2, candidates, initialResult } = input;
  
  // Return empty for Fair trades
  if (initialResult.verdict === 'Fair trade') {
    return [];
  }

  const { diff, total, lean, team1Length, team2Length } = initialResult;
  const leanBefore = Math.abs(lean);
  
  // Determine which side is losing (the side that would receive the asset)
  // diff > 0 means Team 1 gives more value, so Team 2 is losing
  // diff < 0 means Team 2 gives more value, so Team 1 is losing
  const losingSide = diff > 0 ? 2 : 1;
  const losingTeam = losingSide === 1 ? team1 : team2;
  const winningTeam = losingSide === 1 ? team2 : team1;
  
  const excludeIds = new Set([...team1.map(a => a.id), ...team2.map(a => a.id)]);

  // Filter candidates: exclude already-in-trade assets, and for RED league types exclude picks
  const isRedLeague = input.leagueType.startsWith('RED_');
  const validCandidates = candidates.filter(c => {
    if (excludeIds.has(c.id)) return false;
    if (isRedLeague && c.kind === 'pick') return false;
    return true;
  });

  if (validCandidates.length === 0) {
    return [];
  }

  // Pre-narrow candidate pool for performance using adviceGap if available
  // We use ±40% around adviceGap as a rough filter, but widen if too few candidates
  // Note: adviceGap might be null if no single asset can close the gap
  let candidatePool = validCandidates;
  if (initialResult.lean !== 0 && initialResult.verdict !== 'Fair trade') {
    // We don't have adviceGap here, but we can estimate from the diff
    // The target value to add is roughly |diff| / nextWeight
    const nextWeight = getWeight(losingTeam.length);
    const estimatedTarget = Math.abs(diff) / nextWeight;
    const narrowPool = validCandidates.filter(c => 
      c.value >= estimatedTarget * 0.6 && c.value <= estimatedTarget * 1.4
    );
    // If narrowed pool is too small, use wider pool or all candidates
    candidatePool = narrowPool.length >= 20 ? narrowPool : validCandidates;
  }

  // Simulate each candidate
  interface SimResult {
    candidate: typeof validCandidates[0];
    leanAfter: number;
    verdictAfter: string;
  }

  const simulations: SimResult[] = [];
  
  for (const candidate of candidatePool) {
    // Build hypothetical teams with candidate added to losing side
    const newLosingTeam = [...losingTeam, candidate];
    const newWinningTeam = [...winningTeam];
    
    // Re-evaluate the trade with the new asset
    // We need to construct the full trade input and evaluate
    const hypoTeam1 = losingSide === 1 ? newLosingTeam : newWinningTeam;
    const hypoTeam2 = losingSide === 2 ? newLosingTeam : newWinningTeam;
    
    const hypoResult = evaluateTrade({
      leagueType: input.leagueType,
      team1: hypoTeam1,
      team2: hypoTeam2,
    });
    
    const leanAfter = Math.abs(hypoResult.scale) / TRADE_CONSTANTS.SCALE_MULTIPLIER;
    // Actually, lean = diff / total, so let's compute it properly
    const diffAfter = hypoResult.team1.sideValue - hypoResult.team2.sideValue;
    const totalAfter = hypoResult.team1.sideValue + hypoResult.team2.sideValue;
    const leanValueAfter = diffAfter / Math.max(totalAfter, 1);
    const absLeanAfter = Math.abs(leanValueAfter);
    
    // Only keep candidates that improve the trade (reduce |lean|)
    if (absLeanAfter < leanBefore) {
      simulations.push({
        candidate,
        leanAfter: absLeanAfter,
        verdictAfter: hypoResult.verdict.split(' — ')[0], // base verdict
      });
    }
  }

  if (simulations.length === 0) {
    return [];
  }

  // Group by position
  const byPosition = new Map<string, SimResult[]>();
  for (const sim of simulations) {
    const pos = sim.candidate.position;
    const arr = byPosition.get(pos) || [];
    arr.push(sim);
    byPosition.set(pos, arr);
  }

  // Pick best from each position group
  const groupWinners: SimResult[] = [];
  for (const [, group] of byPosition) {
    // Sort group by leanAfter ascending (best fit first)
    group.sort((a, b) => a.leanAfter - b.leanAfter);
    groupWinners.push(group[0]);
  }

  // Sort group winners by leanAfter
  groupWinners.sort((a, b) => a.leanAfter - b.leanAfter);

  // Take top 3 group winners
  const selected = groupWinners.slice(0, 3);

  // If fewer than 3 groups produced winners, backfill from remaining simulations
  if (selected.length < 3) {
    const usedIds = new Set(selected.map(s => s.candidate.id));
    const remaining = simulations
      .filter(s => !usedIds.has(s.candidate.id))
      .sort((a, b) => a.leanAfter - b.leanAfter);
    
    for (const sim of remaining) {
      if (selected.length >= 3) break;
      selected.push(sim);
    }
  }

  // Map to TradeSuggestion format
  return selected.map(s => ({
    id: s.candidate.id,
    name: s.candidate.name,
    position: s.candidate.position as Position | 'PICK',
    team: s.candidate.team,
    value: s.candidate.value,
    side: losingSide,
    resultingLean: s.leanAfter,
    resultingVerdict: s.verdictAfter,
  }));
}

// =====================================================
// Vote (KTC) Math
// =====================================================

export interface PairwiseDelta {
  winnerId: number;
  loserId: number;
  winnerDelta: number;
  loserDelta: number;
}

/**
 * Compute the Elo-style delta for a single pairwise comparison.
 * Winner's value should increase, loser's should decrease.
 * K may be dampened per asset externally.
 */
export function computePairwiseDelta(
  winnerValue: number,
  loserValue: number,
  k: number = VOTE_CONSTANTS.K,
): number {
  const expected = 1 / (1 + Math.pow(10, (loserValue - winnerValue) / VOTE_CONSTANTS.ELO_SCALE));
  return k * (1 - expected);
}

/**
 * Apply a full KTC vote (KEEP > TRADE > CUT) to three assets.
 * Returns the net delta for each asset (before clamp/round).
 *
 * Pairs: (keep, trade), (keep, cut), (trade, cut)
 * Each pair: winner gets +delta, loser gets -delta.
 * Net per asset is sum of their two pairwise results.
 */
export function computeVoteDeltas(
  keepValue: number,
  tradeValue: number,
  cutValue: number,
  kKeep: number = VOTE_CONSTANTS.K,
  kTrade: number = VOTE_CONSTANTS.K,
  kCut: number = VOTE_CONSTANTS.K,
): { keepDelta: number; tradeDelta: number; cutDelta: number } {
  // (keep beats trade): use min K of the two involved assets
  const k_kt = Math.min(kKeep, kTrade);
  const d_kt = computePairwiseDelta(keepValue, tradeValue, k_kt);

  // (keep beats cut)
  const k_kc = Math.min(kKeep, kCut);
  const d_kc = computePairwiseDelta(keepValue, cutValue, k_kc);

  // (trade beats cut)
  const k_tc = Math.min(kTrade, kCut);
  const d_tc = computePairwiseDelta(tradeValue, cutValue, k_tc);

  return {
    keepDelta:  d_kt + d_kc,       // wins both
    tradeDelta: -d_kt + d_tc,      // loses to keep, beats cut
    cutDelta:   -d_kc - d_tc,      // loses both
  };
}

// =====================================================
// Stat Ingestion Math
// =====================================================

export interface WeekStats {
  pass_yd?: number;
  pass_td?: number;
  pass_int?: number;
  rush_yd?: number;
  rush_td?: number;
  rec?: number;
  rec_yd?: number;
  rec_td?: number;
  fum_lost?: number;
}

/**
 * Compute fantasy points for a player's week stats under a given scoring config.
 * QB axis (1QB/SF) does not change points — only rec/tep matter.
 */
export function computeFantasyPoints(
  stats: WeekStats,
  rec: RecScoring,
  tep: TEPSetting,
  position: Position,
): number {
  let pts = 0;
  pts += (stats.pass_yd ?? 0) * SCORING.PASS_YD;
  pts += (stats.pass_td ?? 0) * SCORING.PASS_TD;
  pts += (stats.pass_int ?? 0) * SCORING.PASS_INT;
  pts += (stats.rush_yd ?? 0) * SCORING.RUSH_YD;
  pts += (stats.rush_td ?? 0) * SCORING.RUSH_TD;
  pts += (stats.rec_yd ?? 0) * SCORING.REC_YD;
  pts += (stats.rec_td ?? 0) * SCORING.REC_TD;
  pts += (stats.fum_lost ?? 0) * SCORING.FUM_LOST;

  const receptions = stats.rec ?? 0;
  pts += receptions * (REC_BONUS[rec] ?? 0);

  if (tep === 'TEP' && position === 'TE') {
    pts += receptions * TEP_BONUS;
  }

  return Math.round(pts * 100) / 100;
}

/**
 * Compute the capped stat adjustment delta from surprise and stddev.
 */
export function computeStatDelta(
  surprise: number,
  stddev: number,
  format: Format,
): number {
  if (stddev <= 0) return 0;
  const z = surprise / stddev;
  const sensitivity = STAT_SENSITIVITY[format];
  const cap = STAT_CAP[format];
  const raw = z * sensitivity;
  return Math.max(-cap, Math.min(cap, raw));
}

/**
 * Compute the weekly dynasty age nudge for a player.
 * Returns 0 for RED formats or players below the age threshold.
 */
export function computeAgeNudge(position: Position, age: number | null): number {
  if (age === null) return 0;
  const rule = AGE_NUDGE[position];
  if (!rule) return 0;
  if (age >= rule.minAge) return rule.nudge;
  return 0;
}

export interface PositionWeekEntry {
  assetId: number;
  value: number;
  actualPoints: number;
}

/**
 * Quantile-map expectation model: rank players by value, rank scores,
 * and map by position to compute expected points per player.
 */
export function computeExpectations(
  players: PositionWeekEntry[],
): { assetId: number; expected: number; surprise: number }[] {
  if (players.length === 0) return [];

  // Sort by value descending — rank 0 = highest valued
  const byValue = [...players].sort((a, b) => b.value - a.value);

  // Sort scores descending
  const sortedScores = players.map(p => p.actualPoints).sort((a, b) => b - a);

  return byValue.map((player, rank) => ({
    assetId: player.assetId,
    expected: sortedScores[rank],
    surprise: player.actualPoints - sortedScores[rank],
  }));
}

/**
 * Population standard deviation of an array of numbers.
 * Returns 1 if fewer than 2 values to prevent division by zero.
 */
export function populationStddev(values: number[]): number {
  if (values.length < 2) return 1;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance) || 1; // fallback to 1 if all values identical
}

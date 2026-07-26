import type { TradeAsset, TradeSide, TradeResult, Verdict, Position, RecScoring, TEPSetting, Format } from './types.js';
import {
  SCORING, REC_BONUS, TEP_BONUS,
  STAT_SENSITIVITY, STAT_CAP, AGE_NUDGE,
} from './constants.js';

// =====================================================
// Constants
// =====================================================

export const VOTE_CONSTANTS = {
  /** Elo K-factor per pairwise comparison */
  K: 0.20,
  /** Dampened K when asset has >30 votes in trailing 7 days */
  K_DAMPENED: 0.10,
  /** Elo scale divisor (±6 spread ≈ 24–76% expectation) */
  ELO_SCALE: 12,
  /** Dampening threshold: votes in trailing 7 days */
  DAMPEN_THRESHOLD: 30,
} as const;

export const TRADE_CONSTANTS = {
  EXP: 2.6,
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

/** Clamp value to [1.0, 100.0] and round to one decimal place. */
export function clampRound(v: number): number {
  const clamped = Math.max(1.0, Math.min(100.0, v));
  return Math.round(clamped * 10) / 10;
}

/** Convert linear 1-100 value to nonlinear trade value. */
export function trueValue(v: number): number {
  return Math.pow(v / 100, TRADE_CONSTANTS.EXP) * 10000;
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

/** Compute weighted side value from an array of asset values (already sorted desc). */
function computeSideValue(trueValues: number[]): number {
  let total = 0;
  for (let i = 0; i < trueValues.length; i++) {
    total += trueValues[i] * getWeight(i);
  }
  return total;
}

/**
 * Find the linear value (1-100) that would roughly even the trade
 * when added to the losing side at its next slot weight.
 */
function computeAdviceGap(diff: number, losingAssetCount: number): number | null {
  const nextWeight = getWeight(losingAssetCount);
  // We need trueValue(v) * nextWeight >= |diff|
  const neededTrueValue = Math.abs(diff) / nextWeight;
  // Invert: v = 100 * (neededTrueValue / 10000) ^ (1/EXP)
  const ratio = neededTrueValue / 10000;
  if (ratio > 1) return null; // No single player can close this gap
  const v = 100 * Math.pow(ratio, 1 / TRADE_CONSTANTS.EXP);
  return clampRound(v);
}

export interface EvaluateTradeInput {
  leagueType: string;
  team1: { id: number; name: string; value: number }[];
  team2: { id: number; name: string; value: number }[];
}

/**
 * Evaluate a trade between two teams.
 * Positive scale means trade favors Team 2 (Team 1 gives more).
 * Negative scale means trade favors Team 1 (Team 2 gives more).
 */
export function evaluateTrade(input: EvaluateTradeInput): TradeResult {
  const { leagueType, team1, team2 } = input;

  // Build trade assets sorted by trueValue descending
  const buildSide = (assets: { id: number; name: string; value: number }[]): TradeSide => {
    const withTrue = assets
      .map(a => ({ ...a, trueValue: trueValue(a.value) }))
      .sort((a, b) => b.trueValue - a.trueValue);

    const tradeAssets: TradeAsset[] = withTrue.map((a, i) => ({
      id: a.id,
      name: a.name,
      value: a.value,
      trueValue: Math.round(a.trueValue),
      weight: getWeight(i),
    }));

    const sideValue = computeSideValue(withTrue.map(a => a.trueValue));
    return { assets: tradeAssets, sideValue: Math.round(sideValue) };
  };

  const side1 = buildSide(team1);
  const side2 = buildSide(team2);

  const diff = side1.sideValue - side2.sideValue;
  const total = side1.sideValue + side2.sideValue;
  const lean = diff / Math.max(total, 1);

  const scale = Math.max(-100, Math.min(100, Math.round(lean * TRADE_CONSTANTS.SCALE_MULTIPLIER)));
  const verdict = getVerdict(lean);

  const verdictLabel = scale === 0 || verdict === 'Fair trade'
    ? verdict
    : `${verdict} — Team ${diff > 0 ? '2' : '1'}`;

  const differencePct = total > 0 ? Math.round(Math.abs(diff) / total * 1000) / 10 : 0;

  // Advice gap: which side is losing and how much to add
  let adviceGap: number | null = null;
  if (verdict !== 'Fair trade') {
    const losingCount = diff > 0 ? team2.length : team1.length;
    adviceGap = computeAdviceGap(diff, losingCount);
  }

  return {
    leagueType,
    team1: side1,
    team2: side2,
    scale,
    verdict: verdictLabel,
    differencePct,
    adviceGap,
  };
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

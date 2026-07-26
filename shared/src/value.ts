import type { TradeAsset, TradeSide, TradeResult, Verdict } from './types.js';

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

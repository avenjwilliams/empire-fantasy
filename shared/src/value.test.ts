import { describe, it, expect } from 'vitest';
import {
  clampRound,
  trueValue,
  getWeight,
  getVerdict,
  evaluateTrade,
  TRADE_CONSTANTS,
  VOTE_CONSTANTS,
  computePairwiseDelta,
  computeVoteDeltas,
  computeFantasyPoints,
  computeStatDelta,
  computeAgeNudge,
  computeExpectations,
  populationStddev,
  round1,
} from './value.js';

describe('value.ts', () => {
  describe('clampRound', () => {
    it('rounds to one decimal place', () => {
      expect(clampRound(55.55)).toBe(55.6);
      expect(clampRound(55.54)).toBe(55.5);
      expect(clampRound(33.333)).toBe(33.3);
    });

    it('clamps below 1.0 to 1.0', () => {
      expect(clampRound(0)).toBe(1.0);
      expect(clampRound(-5)).toBe(1.0);
      expect(clampRound(0.5)).toBe(1.0);
    });

    it('clamps above 100.0 to 100.0', () => {
      expect(clampRound(100.1)).toBe(100.0);
      expect(clampRound(150)).toBe(100.0);
    });

    it('preserves values within range', () => {
      expect(clampRound(50.0)).toBe(50.0);
      expect(clampRound(1.0)).toBe(1.0);
      expect(clampRound(100.0)).toBe(100.0);
    });
  });

  describe('trueValue', () => {
    it('maps 100 to 100', () => {
      expect(trueValue(100)).toBe(100);
    });

    it('maps 0 to 0', () => {
      expect(trueValue(0)).toBe(0);
    });

    it('is linear (same as input)', () => {
      // v=80 is exactly 80% of v=100
      const tv80 = trueValue(80);
      const tv100 = trueValue(100);
      expect(tv80).toBe(80);
      expect(tv80 / tv100).toBeCloseTo(0.8);
    });

    it('is monotonically increasing (invariant 5a)', () => {
      let prev = trueValue(0);
      for (let v = 1; v <= 100; v++) {
        const curr = trueValue(v);
        expect(curr).toBeGreaterThan(prev);
        prev = curr;
      }
    });

    it('matches expected values (linear identity)', () => {
      expect(trueValue(80)).toBe(80);
      expect(trueValue(60)).toBe(60);
      expect(trueValue(40)).toBe(40);
      expect(trueValue(20)).toBe(20);
    });
  });

  describe('getWeight', () => {
    it('returns correct weights for first 7 slots', () => {
      expect(getWeight(0)).toBe(1.0);
      expect(getWeight(1)).toBe(0.9);
      expect(getWeight(2)).toBe(0.8);
      expect(getWeight(3)).toBe(0.65);
      expect(getWeight(4)).toBe(0.5);
      expect(getWeight(5)).toBe(0.4);
      expect(getWeight(6)).toBe(0.3);
    });

    it('returns floor weight for slots beyond the ladder', () => {
      expect(getWeight(7)).toBe(0.3);
      expect(getWeight(10)).toBe(0.3);
      expect(getWeight(14)).toBe(0.3);
    });

    it('weights are monotone non-increasing (invariant 5b)', () => {
      let prev = getWeight(0);
      for (let i = 1; i < 15; i++) {
        const curr = getWeight(i);
        expect(curr).toBeLessThanOrEqual(prev);
        prev = curr;
      }
    });
  });

  describe('getVerdict', () => {
    it('returns Fair trade for lean below 0.03', () => {
      expect(getVerdict(0)).toBe('Fair trade');
      expect(getVerdict(0.02)).toBe('Fair trade');
      expect(getVerdict(-0.02)).toBe('Fair trade');
    });

    it('returns Slight edge for lean 0.03-0.08', () => {
      expect(getVerdict(0.05)).toBe('Slight edge');
      expect(getVerdict(-0.05)).toBe('Slight edge');
    });

    it('returns Clear win for lean 0.08-0.18', () => {
      expect(getVerdict(0.10)).toBe('Clear win');
      expect(getVerdict(-0.15)).toBe('Clear win');
    });

    it('returns Landslide for lean above 0.18', () => {
      expect(getVerdict(0.20)).toBe('Landslide');
      expect(getVerdict(-0.50)).toBe('Landslide');
    });
  });

  describe('evaluateTrade', () => {
    // Invariant 1: Equal single players → scale 0, "Fair trade"
    it('invariant 1: equal single players → Fair trade', () => {
      const result = evaluateTrade({
        leagueType: 'DYN_SF_PPR_TEP',
        team1: [{ id: 1, name: 'Player A', value: 85.0 }],
        team2: [{ id: 2, name: 'Player B', value: 85.0 }],
      });
      expect(result.scale).toBe(0);
      expect(result.verdict).toBe('Fair trade');
    });

    // Invariant 2: One 95 vs three 55s → in linear mode, three 55s weighted total > 95
    it('invariant 2: one 95 vs three 55s favors the three 55s side in linear mode', () => {
      const result = evaluateTrade({
        leagueType: 'DYN_SF_PPR_TEP',
        team1: [{ id: 1, name: 'Star', value: 95.0 }],
        team2: [
          { id: 2, name: 'Mid A', value: 55.0 },
          { id: 3, name: 'Mid B', value: 55.0 },
          { id: 4, name: 'Mid C', value: 55.0 },
        ],
      });
      // In linear mode with depth weighting:
      // Team 1: 95 * 1.0 = 95
      // Team 2: 55*1.0 + 55*0.9 + 55*0.8 = 55 + 49.5 + 44 = 148.5
      // diff = 95 - 148.5 = -53.5 → scale = -66 (Team 1 gives less value, so Team 2 favored)
      expect(result.scale).toBeLessThan(0);
    });

    // Invariant 3: Symmetric — swap sides, sign flips exactly
    it('invariant 3: symmetric result when sides swap', () => {
      const result1 = evaluateTrade({
        leagueType: 'DYN_SF_PPR_TEP',
        team1: [{ id: 1, name: 'Star', value: 95.0 }],
        team2: [
          { id: 2, name: 'Mid A', value: 55.0 },
          { id: 3, name: 'Mid B', value: 55.0 },
          { id: 4, name: 'Mid C', value: 55.0 },
        ],
      });

      const result2 = evaluateTrade({
        leagueType: 'DYN_SF_PPR_TEP',
        team1: [
          { id: 2, name: 'Mid A', value: 55.0 },
          { id: 3, name: 'Mid B', value: 55.0 },
          { id: 4, name: 'Mid C', value: 55.0 },
        ],
        team2: [{ id: 1, name: 'Star', value: 95.0 }],
      });

      expect(result2.scale).toBe(-result1.scale);
    });

    // Invariant 4: Adding a 10-value throw-in to a landslide barely moves the scale
    it('invariant 4: throw-in barely moves a landslide', () => {
      const base = evaluateTrade({
        leagueType: 'DYN_SF_PPR_TEP',
        team1: [{ id: 1, name: 'Elite', value: 98.0 }],
        team2: [{ id: 2, name: 'Bench', value: 30.0 }],
      });

      const withThrowIn = evaluateTrade({
        leagueType: 'DYN_SF_PPR_TEP',
        team1: [{ id: 1, name: 'Elite', value: 98.0 }],
        team2: [
          { id: 2, name: 'Bench', value: 30.0 },
          { id: 3, name: 'Throw-in', value: 10.0 },
        ],
      });

      // The throw-in should barely move the scale (< 5 points)
      expect(Math.abs(withThrowIn.scale - base.scale)).toBeLessThan(5);
    });

    // Invariant 5: trueValue monotone and weights monotone non-increasing
    // (Tested individually above in trueValue and getWeight tests)

    it('returns correct structure', () => {
      const result = evaluateTrade({
        leagueType: 'RED_1QB_HALF_STD',
        team1: [{ id: 1, name: 'Player A', value: 70.0 }],
        team2: [{ id: 2, name: 'Player B', value: 60.0 }],
      });

      expect(result.leagueType).toBe('RED_1QB_HALF_STD');
      expect(result.team1.assets).toHaveLength(1);
      expect(result.team2.assets).toHaveLength(1);
      expect(result.team1.assets[0].weight).toBe(1.0);
      expect(typeof result.scale).toBe('number');
      expect(typeof result.verdict).toBe('string');
      expect(typeof result.differencePct).toBe('number');
    });

    it('scale is clamped to [-100, 100]', () => {
      const result = evaluateTrade({
        leagueType: 'DYN_SF_PPR_TEP',
        team1: [{ id: 1, name: 'Star', value: 100.0 }],
        team2: [{ id: 2, name: 'Scrub', value: 1.0 }],
      });
      expect(result.scale).toBeLessThanOrEqual(100);
      expect(result.scale).toBeGreaterThanOrEqual(-100);
    });

    it('depth weighting penalizes additional assets', () => {
      // Two 70s should not equal one 70 on the other side value-wise
      const result = evaluateTrade({
        leagueType: 'DYN_SF_PPR_TEP',
        team1: [
          { id: 1, name: 'A', value: 70.0 },
          { id: 2, name: 'B', value: 70.0 },
        ],
        team2: [{ id: 3, name: 'C', value: 70.0 }],
      });
      // Team 1 gives more total value → favors Team 2
      expect(result.scale).toBeGreaterThan(0);
    });

    it('provides adviceGap for uneven trades', () => {
      const result = evaluateTrade({
        leagueType: 'DYN_SF_PPR_TEP',
        team1: [{ id: 1, name: 'Star', value: 90.0 }],
        team2: [{ id: 2, name: 'Mid', value: 60.0 }],
      });
      expect(result.adviceGap).not.toBeNull();
      expect(result.adviceGap!).toBeGreaterThan(1);
      expect(result.adviceGap!).toBeLessThanOrEqual(100);
    });

    it('adviceGap is null for fair trades', () => {
      const result = evaluateTrade({
        leagueType: 'DYN_SF_PPR_TEP',
        team1: [{ id: 1, name: 'A', value: 75.0 }],
        team2: [{ id: 2, name: 'B', value: 75.0 }],
      });
      expect(result.adviceGap).toBeNull();
    });

    // =====================================================
    // New Value Adjustment tests
    // =====================================================

    it('equal piece counts => valueAdjustment is null on both sides', () => {
      // 1-for-1: equal penalties (both 0)
      const result1 = evaluateTrade({
        leagueType: 'DYN_SF_PPR_TEP',
        team1: [{ id: 1, name: 'A', value: 75.0 }],
        team2: [{ id: 2, name: 'B', value: 75.0 }],
      });
      expect(result1.valueAdjustment).toBeNull();
      expect(result1.valueAdjustmentSide).toBeNull();
      expect(result1.team1.adjustment).toBe(0);
      expect(result1.team2.adjustment).toBe(0);

      // 2-for-2: equal penalties when values are identically distributed
      const result2 = evaluateTrade({
        leagueType: 'DYN_SF_PPR_TEP',
        team1: [
          { id: 1, name: 'A', value: 70.0 },
          { id: 2, name: 'B', value: 60.0 },
        ],
        team2: [
          { id: 3, name: 'C', value: 70.0 },
          { id: 4, name: 'D', value: 60.0 },
        ],
      });
      expect(result2.valueAdjustment).toBeNull();
      expect(result2.valueAdjustmentSide).toBeNull();
      expect(result2.team1.adjustment).toBe(0);
      expect(result2.team2.adjustment).toBe(0);
    });

    it('1-for-2 => adjustment goes to the one-player side, equals depth-penalty shortfall', () => {
      // Team 1: one 70-value player (penalty 0)
      // Team 2: two players worth 40 each (penalty = 80 - (40 + 40*0.9) = 80 - 76 = 4)
      const result = evaluateTrade({
        leagueType: 'DYN_SF_PPR_TEP',
        team1: [{ id: 1, name: 'Star', value: 70.0 }],
        team2: [
          { id: 2, name: 'Mid A', value: 40.0 },
          { id: 3, name: 'Mid B', value: 40.0 },
        ],
      });

      // Team 1 has smaller penalty (0), so gets the adjustment
      expect(result.valueAdjustmentSide).toBe(1);
      expect(result.valueAdjustment).toBe(4.0); // penalty diff = 4.0
      expect(result.team1.adjustment).toBe(4.0);
      expect(result.team2.adjustment).toBe(0);
      
      // Team 1 total = rawSum (70) + adjustment (4) = 74
      // Team 2 total = rawSum (80) + 0 = 80
      expect(result.team1.sideValue).toBe(74.0);
      expect(result.team2.sideValue).toBe(80.0);
    });

    it('McMillan / Harrison + Stowers example => Fair trade with valueAdjustment ~2.4 to Team 1', () => {
      // Team 1 receives: Tetairoa McMillan 73.7
      // Team 2 receives: Marvin Harrison 51.8, Eli Stowers 23.7
      const result = evaluateTrade({
        leagueType: 'DYN_SF_PPR_TEP',
        team1: [{ id: 1, name: 'Tetairoa McMillan', value: 73.7 }],
        team2: [
          { id: 2, name: 'Marvin Harrison Jr.', value: 51.8 },
          { id: 3, name: 'Eli Stowers', value: 23.7 },
        ],
      });

      // Team 1: rawSum 73.7, weighted 73.7, penalty 0.0
      // Team 2: rawSum 75.5, weighted 51.8 + 23.7*0.9 = 73.13, penalty 2.37
      // valueAdjustment = 2.37 → rounded to 2.4 to Team 1
      expect(result.valueAdjustmentSide).toBe(1);
      expect(result.valueAdjustment).toBeCloseTo(2.4, 1);
      expect(result.team1.adjustment).toBeCloseTo(2.4, 1);
      expect(result.team2.adjustment).toBe(0);

      // Team 1 total = 73.7 + 2.4 = 76.1
      // Team 2 total = 75.5
      expect(result.team1.sideValue).toBe(76.1);
      expect(result.team2.sideValue).toBe(75.5);

      // diff = 0.6 → Fair trade (same as old weighted math: 73.7 vs 73.13)
      expect(result.verdict).toBe('Fair trade');
    });

    it('adding a piece to either side changes the adjustment (not static)', () => {
      const base = evaluateTrade({
        leagueType: 'DYN_SF_PPR_TEP',
        team1: [{ id: 1, name: 'A', value: 70.0 }],
        team2: [
          { id: 2, name: 'B', value: 40.0 },
          { id: 3, name: 'C', value: 40.0 },
        ],
      });

      // Add a small piece to Team 1
      const withExtraOnTeam1 = evaluateTrade({
        leagueType: 'DYN_SF_PPR_TEP',
        team1: [
          { id: 1, name: 'A', value: 70.0 },
          { id: 4, name: 'D', value: 10.0 },
        ],
        team2: [
          { id: 2, name: 'B', value: 40.0 },
          { id: 3, name: 'C', value: 40.0 },
        ],
      });

      // Add a small piece to Team 2
      const withExtraOnTeam2 = evaluateTrade({
        leagueType: 'DYN_SF_PPR_TEP',
        team1: [{ id: 1, name: 'A', value: 70.0 }],
        team2: [
          { id: 2, name: 'B', value: 40.0 },
          { id: 3, name: 'C', value: 40.0 },
          { id: 4, name: 'D', value: 10.0 },
        ],
      });

      expect(withExtraOnTeam1.valueAdjustment).not.toBe(base.valueAdjustment);
      expect(withExtraOnTeam2.valueAdjustment).not.toBe(base.valueAdjustment);
    });

    it('adjusted totals produce identical verdict as old weighted-sum math (regression guard)', () => {
      // Test a variety of trade shapes to ensure the refactor preserves verdicts.
      // Note: old math used Math.round() (integer sideValues), new math uses round1() (1 decimal).
      // The exact scale may differ by ±1 due to different total (rawSum vs weightedSum for non-credit side),
      // but the VERDICT band must be identical. If any verdict changes, there's a bug.
      const fixtures = [
        // 1-for-1
        { team1: [{ value: 80 }], team2: [{ value: 78 }] },
        // 1-for-2
        { team1: [{ value: 90 }], team2: [{ value: 50 }, { value: 45 }] },
        // 2-for-2
        { team1: [{ value: 75 }, { value: 65 }], team2: [{ value: 70 }, { value: 70 }] },
        // 1-for-3
        { team1: [{ value: 95 }], team2: [{ value: 55 }, { value: 55 }, { value: 55 }] },
        // 2-for-3
        { team1: [{ value: 85 }, { value: 75 }], team2: [{ value: 60 }, { value: 60 }, { value: 50 }] },
        // 3-for-3
        { team1: [{ value: 70 }, { value: 65 }, { value: 60 }], team2: [{ value: 68 }, { value: 63 }, { value: 58 }] },
        // Unbalanced: 1-for-4
        { team1: [{ value: 90 }], team2: [{ value: 40 }, { value: 35 }, { value: 30 }, { value: 25 }] },
      ];

      for (const fixture of fixtures) {
        const team1Assets = fixture.team1.map((v, i) => ({ id: i + 1, name: `T1-${i}`, value: v.value }));
        const team2Assets = fixture.team2.map((v, i) => ({ id: i + 100, name: `T2-${i}`, value: v.value }));

        const result = evaluateTrade({
          leagueType: 'DYN_SF_PPR_TEP',
          team1: team1Assets,
          team2: team2Assets,
        });

        // Manually compute old-style weighted sums with Math.round (integer) as original code did
        const computeOldSideValue = (values: number[]) => {
          const sorted = [...values].sort((a, b) => b - a);
          let total = 0;
          for (let i = 0; i < sorted.length; i++) {
            const w = i < TRADE_CONSTANTS.DEPTH_WEIGHTS.length ? TRADE_CONSTANTS.DEPTH_WEIGHTS[i] : TRADE_CONSTANTS.DEPTH_FLOOR;
            total += sorted[i] * w;
          }
          return Math.round(total); // Original code used Math.round (integer)
        };

        const oldSide1 = computeOldSideValue(fixture.team1.map(v => v.value));
        const oldSide2 = computeOldSideValue(fixture.team2.map(v => v.value));
        const oldDiff = oldSide1 - oldSide2;
        const oldTotal = oldSide1 + oldSide2;
        const oldLean = oldDiff / Math.max(oldTotal, 1);
        const oldVerdict = oldLean === 0 ? 'Fair trade' :
          Math.abs(oldLean) < 0.03 ? 'Fair trade' :
          Math.abs(oldLean) < 0.08 ? 'Slight edge' :
          Math.abs(oldLean) < 0.18 ? 'Clear win' : 'Landslide';

        // New math must produce identical VERDICT
        const newVerdictBase = result.verdict.split(' — ')[0]; // Remove " — Team X" suffix
        expect(newVerdictBase).toBe(oldVerdict);
      }
    });
  });

  describe('computePairwiseDelta', () => {
    it('returns positive delta (winner gains)', () => {
      const d = computePairwiseDelta(60, 55);
      expect(d).toBeGreaterThan(0);
    });

    it('upset (lower-valued wins) produces larger delta', () => {
      const chalk = computePairwiseDelta(60, 55);   // expected winner wins
      const upset = computePairwiseDelta(55, 60);   // underdog wins
      expect(upset).toBeGreaterThan(chalk);
    });

    it('equal values produce delta of K/2', () => {
      const d = computePairwiseDelta(50, 50);
      expect(d).toBeCloseTo(VOTE_CONSTANTS.K / 2, 6);
    });

    it('delta is always between 0 and K', () => {
      for (let w = 10; w <= 90; w += 10) {
        for (let l = 10; l <= 90; l += 10) {
          const d = computePairwiseDelta(w, l);
          expect(d).toBeGreaterThanOrEqual(0);
          expect(d).toBeLessThanOrEqual(VOTE_CONSTANTS.K);
        }
      }
    });
  });

  describe('computeVoteDeltas', () => {
    it('keep gains, cut loses, trade is in between', () => {
      const { keepDelta, tradeDelta, cutDelta } = computeVoteDeltas(60, 55, 50);
      expect(keepDelta).toBeGreaterThan(0);
      expect(cutDelta).toBeLessThan(0);
      // trade: loses to keep but beats cut — could be positive or negative
      expect(tradeDelta).toBeGreaterThan(cutDelta);
      expect(tradeDelta).toBeLessThan(keepDelta);
    });

    it('net deltas sum to approximately zero (zero-sum)', () => {
      const { keepDelta, tradeDelta, cutDelta } = computeVoteDeltas(70, 65, 60);
      expect(keepDelta + tradeDelta + cutDelta).toBeCloseTo(0, 10);
    });

    it('max movement per asset ≤ 0.4 at standard K', () => {
      // Test across a range of value spreads
      for (let anchor = 20; anchor <= 90; anchor += 10) {
        for (let spread = 0; spread <= 6; spread += 2) {
          const { keepDelta, cutDelta } = computeVoteDeltas(
            anchor + spread, anchor, anchor - spread,
          );
          // keep and cut have the largest absolute movement (2 pairwise)
          expect(Math.abs(keepDelta)).toBeLessThanOrEqual(0.4);
          expect(Math.abs(cutDelta)).toBeLessThanOrEqual(0.4);
        }
      }
    });

    it('dampened K produces smaller deltas', () => {
      const normal = computeVoteDeltas(60, 55, 50);
      const dampened = computeVoteDeltas(
        60, 55, 50,
        VOTE_CONSTANTS.K_DAMPENED,
        VOTE_CONSTANTS.K_DAMPENED,
        VOTE_CONSTANTS.K_DAMPENED,
      );
      expect(Math.abs(dampened.keepDelta)).toBeLessThan(Math.abs(normal.keepDelta));
      expect(Math.abs(dampened.cutDelta)).toBeLessThan(Math.abs(normal.cutDelta));
    });

    it('partial dampening (one asset dampened) still limits that asset', () => {
      // Only keep is dampened
      const { keepDelta } = computeVoteDeltas(
        60, 55, 50,
        VOTE_CONSTANTS.K_DAMPENED, // keep dampened
        VOTE_CONSTANTS.K,
        VOTE_CONSTANTS.K,
      );
      // keep's delta should be smaller than with full K
      const full = computeVoteDeltas(60, 55, 50);
      expect(Math.abs(keepDelta)).toBeLessThan(Math.abs(full.keepDelta));
    });
  });

  // =====================================================
  // Stat Ingestion Math
  // =====================================================

  describe('computeFantasyPoints', () => {
    const monsterQB = {
      pass_yd: 412, pass_td: 4, pass_int: 0,
      rush_yd: 38, rush_td: 1, rec: 0, rec_yd: 0, rec_td: 0, fum_lost: 0,
    };

    it('computes QB points correctly (PPR STD)', () => {
      // 412/25=16.48, 4*4=16, 38/10=3.8, 1*6=6 → 42.28
      const pts = computeFantasyPoints(monsterQB, 'PPR', 'STD', 'QB');
      expect(pts).toBeCloseTo(42.28, 1);
    });

    it('QB points are identical across PPR/HALF/ZERO (no receptions)', () => {
      const ppr = computeFantasyPoints(monsterQB, 'PPR', 'STD', 'QB');
      const half = computeFantasyPoints(monsterQB, 'HALF', 'STD', 'QB');
      const zero = computeFantasyPoints(monsterQB, 'ZERO', 'STD', 'QB');
      expect(ppr).toBe(half);
      expect(half).toBe(zero);
    });

    it('computes RB PPR points with receptions', () => {
      const rb = { pass_yd: 0, pass_td: 0, pass_int: 0,
        rush_yd: 112, rush_td: 2, rec: 3, rec_yd: 28, rec_td: 0, fum_lost: 0 };
      // 112/10=11.2, 2*6=12, 3*1=3, 28/10=2.8 → 29.0
      const pts = computeFantasyPoints(rb, 'PPR', 'STD', 'RB');
      expect(pts).toBeCloseTo(29.0, 1);
    });

    it('HALF scoring gives 0.5 per reception', () => {
      const rb = { rec: 6, rec_yd: 55, rec_td: 1, rush_yd: 68, rush_td: 0,
        pass_yd: 0, pass_td: 0, pass_int: 0, fum_lost: 0 };
      const ppr = computeFantasyPoints(rb, 'PPR', 'STD', 'RB');
      const half = computeFantasyPoints(rb, 'HALF', 'STD', 'RB');
      expect(ppr - half).toBeCloseTo(3.0, 5); // 6 rec * 0.5 difference
    });

    it('ZERO scoring gives no reception bonus', () => {
      const rb = { rec: 6, rec_yd: 55, rec_td: 1, rush_yd: 68, rush_td: 0,
        pass_yd: 0, pass_td: 0, pass_int: 0, fum_lost: 0 };
      const ppr = computeFantasyPoints(rb, 'PPR', 'STD', 'RB');
      const zero = computeFantasyPoints(rb, 'ZERO', 'STD', 'RB');
      expect(ppr - zero).toBeCloseTo(6.0, 5); // 6 rec * 1.0 difference
    });

    it('TEP gives TEs extra 0.5 per reception', () => {
      const te = { rec: 9, rec_yd: 112, rec_td: 1,
        rush_yd: 0, rush_td: 0, pass_yd: 0, pass_td: 0, pass_int: 0, fum_lost: 0 };
      const std = computeFantasyPoints(te, 'PPR', 'STD', 'TE');
      const tep = computeFantasyPoints(te, 'PPR', 'TEP', 'TE');
      expect(tep - std).toBeCloseTo(4.5, 5); // 9 rec * 0.5
    });

    it('TEP does NOT give extra bonus to non-TEs', () => {
      const wr = { rec: 7, rec_yd: 132, rec_td: 2,
        rush_yd: 0, rush_td: 0, pass_yd: 0, pass_td: 0, pass_int: 0, fum_lost: 0 };
      const std = computeFantasyPoints(wr, 'PPR', 'STD', 'WR');
      const tep = computeFantasyPoints(wr, 'PPR', 'TEP', 'WR');
      expect(tep).toBe(std);
    });

    it('negative scoring: INTs and fumbles subtract', () => {
      const badQB = { pass_yd: 178, pass_td: 1, pass_int: 2,
        rush_yd: 55, rush_td: 0, rec: 0, rec_yd: 0, rec_td: 0, fum_lost: 1 };
      // 178/25=7.12, 1*4=4, 2*-2=-4, 55/10=5.5, 1*-2=-2 → 10.62
      const pts = computeFantasyPoints(badQB, 'PPR', 'STD', 'QB');
      expect(pts).toBeCloseTo(10.62, 1);
    });

    it('handles missing stat fields gracefully', () => {
      const pts = computeFantasyPoints({}, 'PPR', 'STD', 'RB');
      expect(pts).toBe(0);
    });
  });

  describe('computeStatDelta', () => {
    it('positive surprise in RED format', () => {
      // z=1, raw = 1*0.35 = 0.35
      const delta = computeStatDelta(5, 5, 'RED');
      expect(delta).toBeCloseTo(0.35, 5);
    });

    it('positive surprise in DYN format', () => {
      // z=1, raw = 1*0.15 = 0.15
      const delta = computeStatDelta(5, 5, 'DYN');
      expect(delta).toBeCloseTo(0.15, 5);
    });

    it('caps at +0.8 for RED', () => {
      const delta = computeStatDelta(100, 5, 'RED');
      expect(delta).toBe(0.8);
    });

    it('caps at -0.8 for RED', () => {
      const delta = computeStatDelta(-100, 5, 'RED');
      expect(delta).toBe(-0.8);
    });

    it('caps at ±0.4 for DYN', () => {
      expect(computeStatDelta(100, 5, 'DYN')).toBe(0.4);
      expect(computeStatDelta(-100, 5, 'DYN')).toBe(-0.4);
    });

    it('returns 0 for zero surprise', () => {
      expect(computeStatDelta(0, 5, 'RED')).toBe(0);
    });

    it('returns 0 for zero stddev', () => {
      expect(computeStatDelta(10, 0, 'RED')).toBe(0);
    });

    it('season sanity: 1 stddev over for 17 weeks in RED ≈ 6 pts', () => {
      // z=1 each week → delta = 0.35 per week → 17 * 0.35 = 5.95
      const perWeek = computeStatDelta(5, 5, 'RED'); // z=1
      expect(perWeek * 17).toBeCloseTo(5.95, 0);
    });
  });

  describe('computeAgeNudge', () => {
    it('RB age 27+ gets -0.05', () => {
      expect(computeAgeNudge('RB', 27)).toBe(-0.05);
      expect(computeAgeNudge('RB', 30)).toBe(-0.05);
    });

    it('RB age 26 gets 0', () => {
      expect(computeAgeNudge('RB', 26)).toBe(0);
    });

    it('WR age 30+ gets -0.03', () => {
      expect(computeAgeNudge('WR', 30)).toBe(-0.03);
      expect(computeAgeNudge('WR', 33)).toBe(-0.03);
    });

    it('TE age 30+ gets -0.03', () => {
      expect(computeAgeNudge('TE', 30)).toBe(-0.03);
      expect(computeAgeNudge('TE', 32)).toBe(-0.03);
    });

    it('QB age 36+ gets -0.03', () => {
      expect(computeAgeNudge('QB', 36)).toBe(-0.03);
    });

    it('QB age 35 gets 0', () => {
      expect(computeAgeNudge('QB', 35)).toBe(0);
    });

    it('null age returns 0', () => {
      expect(computeAgeNudge('RB', null)).toBe(0);
    });
  });

  describe('computeExpectations', () => {
    it('maps by quantile: highest value expects highest score', () => {
      const players = [
        { assetId: 1, value: 90, actualPoints: 10 },
        { assetId: 2, value: 70, actualPoints: 30 },
        { assetId: 3, value: 50, actualPoints: 20 },
      ];
      const result = computeExpectations(players);

      // Value rank: 1(90), 2(70), 3(50)
      // Sorted scores: 30, 20, 10
      // Expected: assetId=1 expects 30, assetId=2 expects 20, assetId=3 expects 10
      const byId = (id: number) => result.find(r => r.assetId === id)!;

      expect(byId(1).expected).toBe(30);
      expect(byId(1).surprise).toBe(10 - 30); // -20

      expect(byId(2).expected).toBe(20);
      expect(byId(2).surprise).toBe(30 - 20); // +10

      expect(byId(3).expected).toBe(10);
      expect(byId(3).surprise).toBe(20 - 10); // +10
    });

    it('player who scores as expected has surprise 0', () => {
      // All score in exact value order
      const players = [
        { assetId: 1, value: 90, actualPoints: 30 },
        { assetId: 2, value: 70, actualPoints: 20 },
        { assetId: 3, value: 50, actualPoints: 10 },
      ];
      const result = computeExpectations(players);
      for (const r of result) {
        expect(r.surprise).toBe(0);
      }
    });

    it('returns empty for empty input', () => {
      expect(computeExpectations([])).toEqual([]);
    });
  });

  describe('populationStddev', () => {
    it('computes correctly for known values', () => {
      // [2, 4, 4, 4, 5, 5, 7, 9] → mean=5, var=4, stddev=2
      expect(populationStddev([2, 4, 4, 4, 5, 5, 7, 9])).toBe(2);
    });

    it('returns 1 for single value (prevent division by zero)', () => {
      expect(populationStddev([5])).toBe(1);
    });

    it('returns 1 for empty array', () => {
      expect(populationStddev([])).toBe(1);
    });

    it('returns 1 for identical values', () => {
      expect(populationStddev([10, 10, 10])).toBe(1);
    });
  });
});

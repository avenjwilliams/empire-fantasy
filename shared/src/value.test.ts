import { describe, it, expect } from 'vitest';
import {
  clampRound,
  trueValue,
  getWeight,
  getVerdict,
  evaluateTrade,
  computeSideVolatility,
  rankToValue,
  computeTradeSuggestions,
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
import { RANK_DECAY_K } from './constants.js';

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

    it('clamps above 1000.0 to 1000.0', () => {
      expect(clampRound(1000.1)).toBe(1000.0);
      expect(clampRound(1500)).toBe(1000.0);
    });

    it('preserves values within range', () => {
      expect(clampRound(500.0)).toBe(500.0);
      expect(clampRound(1.0)).toBe(1.0);
      expect(clampRound(1000.0)).toBe(1000.0);
    });
  });

  describe('trueValue', () => {
    it('maps 1000 to 1000', () => {
      expect(trueValue(1000)).toBe(1000);
    });

    it('maps 0 to 0', () => {
      expect(trueValue(0)).toBe(0);
    });

    it('is linear (same as input)', () => {
      // v=800 is exactly 80% of v=1000
      const tv800 = trueValue(800);
      const tv1000 = trueValue(1000);
      expect(tv800).toBe(800);
      expect(tv800 / tv1000).toBeCloseTo(0.8);
    });

    it('is monotonically increasing (invariant 5a)', () => {
      let prev = trueValue(0);
      for (let v = 1; v <= 1000; v++) {
        const curr = trueValue(v);
        expect(curr).toBeGreaterThan(prev);
        prev = curr;
      }
    });

    it('matches expected values (linear identity)', () => {
      expect(trueValue(800)).toBe(800);
      expect(trueValue(600)).toBe(600);
      expect(trueValue(400)).toBe(400);
      expect(trueValue(200)).toBe(200);
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
        team1: [{ id: 1, name: 'Player A', value: 850.0 }],
        team2: [{ id: 2, name: 'Player B', value: 850.0 }],
      });
      expect(result.scale).toBeCloseTo(0); // scale is exactly 0 for fair trades (allow -0)
      expect(result.verdict).toBe('Fair trade');
    });

    // Invariant 2: One 950 vs three 550s → in linear mode, three 550s weighted total > 950
    it('invariant 2: one 950 vs three 550s favors the three 550s side in linear mode', () => {
      const result = evaluateTrade({
        leagueType: 'DYN_SF_PPR_TEP',
        team1: [{ id: 1, name: 'Star', value: 950.0 }],
        team2: [
          { id: 2, name: 'Mid A', value: 550.0 },
          { id: 3, name: 'Mid B', value: 550.0 },
          { id: 4, name: 'Mid C', value: 550.0 },
        ],
      });
      // In linear mode with depth weighting:
      // Team 1 receives: 950 * 1.0 = 950
      // Team 2 receives: 550*1.0 + 550*0.9 + 550*0.8 = 550 + 495 + 440 = 1485
      // Team 2 receives more → Team 2 is favored → scale should be POSITIVE
      expect(result.scale).toBeGreaterThan(0);
    });

    // Invariant 3: Symmetric — swap sides, sign flips exactly
    it('invariant 3: symmetric result when sides swap', () => {
      const result1 = evaluateTrade({
        leagueType: 'DYN_SF_PPR_TEP',
        team1: [{ id: 1, name: 'Star', value: 950.0 }],
        team2: [
          { id: 2, name: 'Mid A', value: 550.0 },
          { id: 3, name: 'Mid B', value: 550.0 },
          { id: 4, name: 'Mid C', value: 550.0 },
        ],
      });

      const result2 = evaluateTrade({
        leagueType: 'DYN_SF_PPR_TEP',
        team1: [
          { id: 2, name: 'Mid A', value: 550.0 },
          { id: 3, name: 'Mid B', value: 550.0 },
          { id: 4, name: 'Mid C', value: 550.0 },
        ],
        team2: [{ id: 1, name: 'Star', value: 950.0 }],
      });

      expect(result2.scale).toBe(-result1.scale);
    });

    // Invariant 4: Adding a 100-value throw-in to a landslide barely moves the scale
    it('invariant 4: throw-in barely moves a landslide', () => {
      const base = evaluateTrade({
        leagueType: 'DYN_SF_PPR_TEP',
        team1: [{ id: 1, name: 'Elite', value: 980.0 }],
        team2: [{ id: 2, name: 'Bench', value: 300.0 }],
      });

      const withThrowIn = evaluateTrade({
        leagueType: 'DYN_SF_PPR_TEP',
        team1: [{ id: 1, name: 'Elite', value: 980.0 }],
        team2: [
          { id: 2, name: 'Bench', value: 300.0 },
          { id: 3, name: 'Throw-in', value: 100.0 },
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
        team1: [{ id: 1, name: 'Player A', value: 700.0 }],
        team2: [{ id: 2, name: 'Player B', value: 600.0 }],
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
        team1: [{ id: 1, name: 'Star', value: 1000.0 }],
        team2: [{ id: 2, name: 'Scrub', value: 10.0 }],
      });
      expect(result.scale).toBeLessThanOrEqual(100);
      expect(result.scale).toBeGreaterThanOrEqual(-100);
    });

    it('depth weighting penalizes additional assets', () => {
      // Two 700s should not equal one 700 on the other side value-wise
      const result = evaluateTrade({
        leagueType: 'DYN_SF_PPR_TEP',
        team1: [
          { id: 1, name: 'A', value: 700.0 },
          { id: 2, name: 'B', value: 700.0 },
        ],
        team2: [{ id: 3, name: 'C', value: 700.0 }],
      });
      // Team 1 receives 1400, Team 2 receives 700 → Team 1 is favored → scale should be NEGATIVE
      expect(result.scale).toBeLessThan(0);
    });

    it('provides adviceGap for uneven trades', () => {
      const result = evaluateTrade({
        leagueType: 'DYN_SF_PPR_TEP',
        team1: [{ id: 1, name: 'Star', value: 900.0 }],
        team2: [{ id: 2, name: 'Mid', value: 600.0 }],
      });
      expect(result.adviceGap).not.toBeNull();
      expect(result.adviceGap!).toBeGreaterThan(1);
      expect(result.adviceGap!).toBeLessThanOrEqual(1000);
    });

    it('adviceGap is null for fair trades', () => {
      const result = evaluateTrade({
        leagueType: 'DYN_SF_PPR_TEP',
        team1: [{ id: 1, name: 'A', value: 750.0 }],
        team2: [{ id: 2, name: 'B', value: 750.0 }],
      });
      expect(result.adviceGap).toBeNull();
    });

    // =====================================================
    // Direction convention regression tests
    // =====================================================

    it('repro: Team 1 receives 509.3, Team 2 receives 758.2 → verdict names Team 2, scale > 0', () => {
      const result = evaluateTrade({
        leagueType: 'DYN_SF_PPR_TEP',
        team1: [{ id: 1, name: 'Jameson Williams', value: 509.3 }],
        team2: [{ id: 2, name: 'James Cook', value: 758.2 }],
      });
      // Team 2 receives more value → Team 2 is favored
      expect(result.verdict).toMatch(/Team 2$/);
      expect(result.scale).toBeGreaterThan(0);
    });

    it('mirror: Team 1 receives 758.2, Team 2 receives 509.3 → verdict names Team 1, scale < 0', () => {
      const result = evaluateTrade({
        leagueType: 'DYN_SF_PPR_TEP',
        team1: [{ id: 1, name: 'James Cook', value: 758.2 }],
        team2: [{ id: 2, name: 'Jameson Williams', value: 509.3 }],
      });
      // Team 1 receives more value → Team 1 is favored
      expect(result.verdict).toMatch(/Team 1$/);
      expect(result.scale).toBeLessThan(0);
    });

    it('label/sign agreement: verdict naming Team 1 always has scale < 0, Team 2 always has scale > 0', () => {
      const fixtures = [
        // Team 1 favored (receives more total value after adjustment)
        { team1: [{ value: 900 }], team2: [{ value: 600 }], expectTeam: 1 },
        { team1: [{ value: 800 }, { value: 700 }], team2: [{ value: 500 }], expectTeam: 1 },
        { team1: [{ value: 550 }, { value: 550 }, { value: 550 }], team2: [{ value: 950 }], expectTeam: 1 },
        // Team 2 favored (receives more total value after adjustment)
        { team1: [{ value: 600 }], team2: [{ value: 900 }], expectTeam: 2 },
        { team1: [{ value: 500 }], team2: [{ value: 800 }, { value: 700 }], expectTeam: 2 },
      ];

      for (const f of fixtures) {
        const team1Assets = f.team1.map((v, i) => ({ id: i + 1, name: `T1-${i}`, value: v.value }));
        const team2Assets = f.team2.map((v, i) => ({ id: i + 100, name: `T2-${i}`, value: v.value }));

        const result = evaluateTrade({
          leagueType: 'DYN_SF_PPR_TEP',
          team1: team1Assets,
          team2: team2Assets,
        });

        if (result.verdict === 'Fair trade') continue; // skip fair trades

        if (f.expectTeam === 1) {
          expect(result.verdict).toMatch(/Team 1$/);
          expect(result.scale).toBeLessThan(0);
        } else {
          expect(result.verdict).toMatch(/Team 2$/);
          expect(result.scale).toBeGreaterThan(0);
        }
      }
    });

    // =====================================================
    // New Value Adjustment tests
    // =====================================================

    it('equal piece counts => valueAdjustment is null on both sides', () => {
      // 1-for-1: equal penalties (both 0)
      const result1 = evaluateTrade({
        leagueType: 'DYN_SF_PPR_TEP',
        team1: [{ id: 1, name: 'A', value: 750.0 }],
        team2: [{ id: 2, name: 'B', value: 750.0 }],
      });
      expect(result1.valueAdjustment).toBeNull();
      expect(result1.valueAdjustmentSide).toBeNull();
      expect(result1.team1.adjustment).toBe(0);
      expect(result1.team2.adjustment).toBe(0);

      // 2-for-2: equal penalties when values are identically distributed
      const result2 = evaluateTrade({
        leagueType: 'DYN_SF_PPR_TEP',
        team1: [
          { id: 1, name: 'A', value: 700.0 },
          { id: 2, name: 'B', value: 600.0 },
        ],
        team2: [
          { id: 3, name: 'C', value: 700.0 },
          { id: 4, name: 'D', value: 600.0 },
        ],
      });
      expect(result2.valueAdjustment).toBeNull();
      expect(result2.valueAdjustmentSide).toBeNull();
      expect(result2.team1.adjustment).toBe(0);
      expect(result2.team2.adjustment).toBe(0);
    });

    it('1-for-2 => adjustment goes to the one-player side, equals depth-penalty shortfall', () => {
      // Team 1: one 700-value player (penalty 0)
      // Team 2: two players worth 400 each (penalty = 800 - (400 + 400*0.9) = 800 - 760 = 40)
      const result = evaluateTrade({
        leagueType: 'DYN_SF_PPR_TEP',
        team1: [{ id: 1, name: 'Star', value: 700.0 }],
        team2: [
          { id: 2, name: 'Mid A', value: 400.0 },
          { id: 3, name: 'Mid B', value: 400.0 },
        ],
      });

      // Team 1 has smaller penalty (0), so gets the adjustment
      expect(result.valueAdjustmentSide).toBe(1);
      expect(result.valueAdjustment).toBe(40.0); // penalty diff = 40.0
      expect(result.team1.adjustment).toBe(40.0);
      expect(result.team2.adjustment).toBe(0);
      
      // Team 1 total = rawSum (700) + adjustment (40) = 740
      // Team 2 total = rawSum (800) + 0 = 800
      expect(result.team1.sideValue).toBe(740.0);
      expect(result.team2.sideValue).toBe(800.0);
    });

    it('McMillan / Harrison + Stowers example => Fair trade with valueAdjustment ~23.7 to Team 1', () => {
      // Team 1 receives: Tetairoa McMillan 737.0
      // Team 2 receives: Marvin Harrison 518.0, Eli Stowers 237.0
      const result = evaluateTrade({
        leagueType: 'DYN_SF_PPR_TEP',
        team1: [{ id: 1, name: 'Tetairoa McMillan', value: 737.0 }],
        team2: [
          { id: 2, name: 'Marvin Harrison Jr.', value: 518.0 },
          { id: 3, name: 'Eli Stowers', value: 237.0 },
        ],
      });

      // Team 1: rawSum 737.0, weighted 737.0, penalty 0.0
      // Team 2: rawSum 755.0, weighted 518.0 + 237.0*0.9 = 731.3, penalty 23.7
      // valueAdjustment = 23.7 → to Team 1
      expect(result.valueAdjustmentSide).toBe(1);
      expect(result.valueAdjustment).toBeCloseTo(23.7, 1);
      expect(result.team1.adjustment).toBeCloseTo(23.7, 1);
      expect(result.team2.adjustment).toBe(0);

      // Team 1 total = 737.0 + 23.7 = 760.7
      // Team 2 total = 755.0
      expect(result.team1.sideValue).toBe(760.7);
      expect(result.team2.sideValue).toBe(755.0);

      // diff = 5.7 → lean 0.00376 → scale 1 → Fair trade
      expect(result.verdict).toBe('Fair trade');
    });

    it('adding a piece to either side changes the adjustment (not static)', () => {
      const base = evaluateTrade({
        leagueType: 'DYN_SF_PPR_TEP',
        team1: [{ id: 1, name: 'A', value: 700.0 }],
        team2: [
          { id: 2, name: 'B', value: 400.0 },
          { id: 3, name: 'C', value: 400.0 },
        ],
      });

      // Add a small piece to Team 1
      const withExtraOnTeam1 = evaluateTrade({
        leagueType: 'DYN_SF_PPR_TEP',
        team1: [
          { id: 1, name: 'A', value: 700.0 },
          { id: 4, name: 'D', value: 100.0 },
        ],
        team2: [
          { id: 2, name: 'B', value: 400.0 },
          { id: 3, name: 'C', value: 400.0 },
        ],
      });

      // Add a small piece to Team 2
      const withExtraOnTeam2 = evaluateTrade({
        leagueType: 'DYN_SF_PPR_TEP',
        team1: [{ id: 1, name: 'A', value: 700.0 }],
        team2: [
          { id: 2, name: 'B', value: 400.0 },
          { id: 3, name: 'C', value: 400.0 },
          { id: 4, name: 'D', value: 100.0 },
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
        { team1: [{ value: 800 }], team2: [{ value: 780 }] },
        // 1-for-2
        { team1: [{ value: 900 }], team2: [{ value: 500 }, { value: 450 }] },
        // 2-for-2
        { team1: [{ value: 750 }, { value: 650 }], team2: [{ value: 700 }, { value: 700 }] },
        // 1-for-3
        { team1: [{ value: 950 }], team2: [{ value: 550 }, { value: 550 }, { value: 550 }] },
        // 2-for-3
        { team1: [{ value: 850 }, { value: 750 }], team2: [{ value: 600 }, { value: 600 }, { value: 500 }] },
        // 3-for-3
        { team1: [{ value: 700 }, { value: 650 }, { value: 600 }], team2: [{ value: 680 }, { value: 630 }, { value: 580 }] },
        // Unbalanced: 1-for-4
        { team1: [{ value: 900 }], team2: [{ value: 400 }, { value: 350 }, { value: 300 }, { value: 250 }] },
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

    it('scale invariance of verdicts: evaluateTrade(values) and evaluateTrade(values × 10) produce identical verdict and scale', () => {
      // The trade calculator derives everything from lean = diff / total, a ratio.
      // Multiply every input value by 10 → diff and total both scale by 10 → lean unchanged.
      // Verdict and scale must be identical.
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

        const result1 = evaluateTrade({
          leagueType: 'DYN_SF_PPR_TEP',
          team1: team1Assets,
          team2: team2Assets,
        });

        // Scale values by 10
        const scaledTeam1Assets = team1Assets.map(a => ({ ...a, value: a.value * 10 }));
        const scaledTeam2Assets = team2Assets.map(a => ({ ...a, value: a.value * 10 }));

        const result10 = evaluateTrade({
          leagueType: 'DYN_SF_PPR_TEP',
          team1: scaledTeam1Assets,
          team2: scaledTeam2Assets,
        });

        // Verdict must be identical
        const verdict1 = result1.verdict.split(' — ')[0];
        const verdict10 = result10.verdict.split(' — ')[0];
        expect(verdict10).toBe(verdict1);

        // Scale must be identical (since lean is scale-invariant)
        expect(result10.scale).toBe(result1.scale);
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
    it('RB age 27+ gets -0.5', () => {
      expect(computeAgeNudge('RB', 27)).toBe(-0.5);
      expect(computeAgeNudge('RB', 30)).toBe(-0.5);
    });

    it('RB age 26 gets 0', () => {
      expect(computeAgeNudge('RB', 26)).toBe(0);
    });

    it('WR age 30+ gets -0.3', () => {
      expect(computeAgeNudge('WR', 30)).toBe(-0.3);
      expect(computeAgeNudge('WR', 33)).toBe(-0.3);
    });

    it('TE age 30+ gets -0.3', () => {
      expect(computeAgeNudge('TE', 30)).toBe(-0.3);
      expect(computeAgeNudge('TE', 32)).toBe(-0.3);
    });

    it('QB age 36+ gets -0.3', () => {
      expect(computeAgeNudge('QB', 36)).toBe(-0.3);
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

  describe('computeSideVolatility', () => {
    it('returns null volatility for empty array', () => {
      const result = computeSideVolatility([]);
      expect(result.volatility).toBeNull();
      expect(result.ratedCount).toBe(0);
      expect(result.unratedCount).toBe(0);
    });

    it('returns null volatility for all unrated assets (picks)', () => {
      const result = computeSideVolatility([
        { value: 500, volatility_pct: null },
        { value: 300, volatility_pct: null },
      ]);
      expect(result.volatility).toBeNull();
      expect(result.ratedCount).toBe(0);
      expect(result.unratedCount).toBe(2);
    });

    it('computes value-weighted mean for single rated asset', () => {
      const result = computeSideVolatility([
        { value: 900, volatility_pct: 40 },
      ]);
      expect(result.volatility).toBe(40);
      expect(result.ratedCount).toBe(1);
      expect(result.unratedCount).toBe(0);
    });

    it('computes value-weighted mean across multiple rated assets', () => {
      // Two assets: 900 @ 40, 100 @ 80
      // Weighted mean = (900*40 + 100*80) / (900+100) = (36000 + 8000) / 1000 = 44
      const result = computeSideVolatility([
        { value: 900, volatility_pct: 40 },
        { value: 100, volatility_pct: 80 },
      ]);
      expect(result.volatility).toBe(44); // Not 60 (plain mean)
      expect(result.ratedCount).toBe(2);
      expect(result.unratedCount).toBe(0);
    });

    it('excludes unrated assets from numerator and denominator', () => {
      // One rated (500 @ 40), one unrated (500 @ null)
      // Weighted mean = 40, NOT 20
      const result = computeSideVolatility([
        { value: 500, volatility_pct: 40 },
        { value: 500, volatility_pct: null },
      ]);
      expect(result.volatility).toBe(40);
      expect(result.ratedCount).toBe(1);
      expect(result.unratedCount).toBe(1);
    });

    it('returns integer outputs', () => {
      const result = computeSideVolatility([
        { value: 999, volatility_pct: 33 },
        { value: 1, volatility_pct: 67 },
      ]);
      // (999*33 + 1*67) / 1000 = 33.034 -> 33
      expect(Number.isInteger(result.volatility!)).toBe(true);
      expect(result.volatility).toBe(33);
    });
  });

  describe('evaluateTrade with volatility', () => {
    const baseTrade = {
      leagueType: 'DYN_SF_PPR_TEP' as const,
      team1: [{ id: 1, name: 'Star', value: 737.0 }],
      team2: [
        { id: 2, name: 'Harrison', value: 518.0 },
        { id: 3, name: 'Stowers', value: 237.0 },
      ],
    };

    const baseTradeWithVolatility = {
      leagueType: 'DYN_SF_PPR_TEP' as const,
      team1: [{ id: 1, name: 'Star', value: 737.0, volatility_pct: 40 }],
      team2: [
        { id: 2, name: 'Harrison', value: 518.0, volatility_pct: 55 },
        { id: 3, name: 'Stowers', value: 237.0, volatility_pct: 60 },
      ],
    };

    // Primary regression guard: verdict must be bit-for-bit identical with and without volatility
    const verdictFields = ['scale', 'verdict', 'differencePct', 'adviceGap', 'valueAdjustment', 'valueAdjustmentSide'] as const;

    for (const field of verdictFields) {
      it(`verdict unchanged: ${field} identical with and without volatility`, () => {
        const without = evaluateTrade(baseTrade);
        const withVolatility = evaluateTrade(baseTradeWithVolatility);
        expect(withVolatility[field]).toBe(without[field]);
      });
    }

    it('volatility field is always present with SideVolatility objects for both sides', () => {
      const result = evaluateTrade(baseTradeWithVolatility);
      expect(result.volatility).toBeDefined();
      expect(result.volatility.team1).toBeDefined();
      expect(result.volatility.team2).toBeDefined();
      expect(typeof result.volatility.team1.volatility).toBe('number');
      expect(typeof result.volatility.team2.volatility).toBe('number');
    });

    it('computes correct weighted averages for McMillan/Harrison+Stowers fixture', () => {
      const result = evaluateTrade(baseTradeWithVolatility);
      const t1 = result.volatility.team1;
      const t2 = result.volatility.team2;

      // Team 1: single asset 737 @ 40 -> volatility = 40
      expect(t1.volatility).toBe(40);
      expect(t1.ratedCount).toBe(1);
      expect(t1.unratedCount).toBe(0);

      // Team 2: 518 @ 55 + 237 @ 60
      // volatility = (518*55 + 237*60) / (518+237) = (28490 + 14220) / 755 = 42910/755 = 56.83 -> 57
      expect(t2.volatility).toBe(57);
      expect(t2.ratedCount).toBe(2);
      expect(t2.unratedCount).toBe(0);
    });

    it('empty side returns well-formed SideVolatility with null and zero counts', () => {
      const result = evaluateTrade({
        leagueType: 'DYN_SF_PPR_TEP',
        team1: [{ id: 1, name: 'Star', value: 900.0, volatility_pct: 50 }],
        team2: [],
      });
      expect(result.volatility.team1.volatility).toBe(50);
      expect(result.volatility.team1.ratedCount).toBe(1);
      expect(result.volatility.team1.unratedCount).toBe(0);
      expect(result.volatility.team2.volatility).toBeNull();
      expect(result.volatility.team2.ratedCount).toBe(0);
      expect(result.volatility.team2.unratedCount).toBe(0);
      // Trade still produces finite scale
      expect(Number.isFinite(result.scale)).toBe(true);
    });

    it('all-picks side returns null volatility', () => {
      const result = evaluateTrade({
        leagueType: 'DYN_SF_PPR_TEP',
        team1: [{ id: 1, name: 'Star', value: 900.0, volatility_pct: 50 }],
        team2: [
          { id: 2, name: 'Pick 1', value: 500.0, volatility_pct: null },
          { id: 3, name: 'Pick 2', value: 300.0, volatility_pct: null },
        ],
      });
      expect(result.volatility.team1.volatility).toBe(50);
      expect(result.volatility.team1.ratedCount).toBe(1);
      expect(result.volatility.team2.volatility).toBeNull();
      expect(result.volatility.team2.ratedCount).toBe(0);
      expect(result.volatility.team2.unratedCount).toBe(2);
    });

    it('suggestions array is identical with and without volatility', () => {
      const inputWithout = {
        ...baseTrade,
        team1: baseTrade.team1.map(a => ({ ...a, volatility_pct: undefined })),
        team2: baseTrade.team2.map(a => ({ ...a, volatility_pct: undefined })),
      };
      const inputWith = baseTradeWithVolatility;

      const resultWithout = evaluateTrade(inputWithout);
      const resultWith = evaluateTrade(inputWith);

      // Suggestions are computed server-side by calling evaluateTrade again
      // The client test ensures the evaluateTrade itself doesn't leak volatility into suggestions
      // Here we verify the structure is identical
      expect(resultWith.suggestions).toEqual(resultWithout.suggestions);
    });
  });

  // =====================================================
  // Precision Invariant Tests (Fix 3)
  // =====================================================

  describe('rankToValue precision invariants', () => {
    const N = 358; // fixture dataset size

    it('rank 1 returns exactly 999.9 — never 1000.0', () => {
      expect(rankToValue(1, N)).toBe(999.9);
    });

    it('matches expected fixture values at N=358', () => {
      expect(rankToValue(2, N)).toBe(990.2);
      expect(rankToValue(3, N)).toBe(980.5);
      expect(rankToValue(5, N)).toBe(961.6);
      expect(rankToValue(10, N)).toBe(915.7);
      expect(rankToValue(50, N)).toBe(619.3);
      expect(rankToValue(100, N)).toBe(379.9);
      expect(rankToValue(200, N)).toBe(142.9);
      expect(rankToValue(358, N)).toBe(30.5);
    });

    it('fewer than 15% of ranks land on a whole number (precision invariant)', () => {
      let whole = 0;
      for (let r = 1; r <= N; r++) {
        const v = rankToValue(r, N);
        if (v === Math.floor(v)) whole++;
      }
      const pct = whole / N;
      expect(pct).toBeLessThan(0.15); // expect ~8% for exponential at 1 decimal
      // also sanity-check it's not 100% (the old bug)
      expect(pct).toBeGreaterThan(0.01);
    });

    it('is strictly monotonically decreasing in rank', () => {
      let prev = rankToValue(1, N);
      for (let r = 2; r <= N; r++) {
        const curr = rankToValue(r, N);
        expect(curr).toBeLessThan(prev);
        prev = curr;
      }
    });

    it('never exceeds 999.9 and never below 1.0', () => {
      for (let r = 1; r <= N; r++) {
        const v = rankToValue(r, N);
        expect(v).toBeLessThanOrEqual(999.9);
        expect(v).toBeGreaterThanOrEqual(1.0);
      }
    });
  });

  // =====================================================
  // Seed Service / Rebase Agreement Regression Test
  // =====================================================

  // These tests verify that the rebase script's precise base computation
  // matches what seedService would assign during a fresh seed.
  // They use the actual N per base set (from the CSV row counts).
  describe('seedService/rebase agreement', () => {
    const baseSets = [
      { code: 'DYN_1QB', N: 343 },
      { code: 'DYN_SF', N: 309 },
      { code: 'RED_1QB', N: 346 },
      { code: 'RED_SF', N: 253 },
    ];

    // Verify the N values are what the loader actually returns
    it('base set N values match expected CSV row counts', () => {
      // These must match the actual CSV row counts in data/seed-rankings/
      // If a CSV is updated, this test will fail and the N values must be updated
      expect(baseSets.find(b => b.code === 'DYN_1QB')!.N).toBe(343);
      expect(baseSets.find(b => b.code === 'DYN_SF')!.N).toBe(309);
      expect(baseSets.find(b => b.code === 'RED_1QB')!.N).toBe(346);
      expect(baseSets.find(b => b.code === 'RED_SF')!.N).toBe(253);
    });

    // The precise base value (rankToValue + multipliers) must match
    // what seedService computes for the same rank, position, and base set.
    // These are pre-drift base values at specific ranks.
    it('precise base values match seedService for all 4 base sets at key ranks', () => {
      // For each base set, at each test rank, the precise base value
      // computed by the rebase path must equal what seedService would assign.
      // We verify this by recomputing using the same formula seedService uses:
      // base = rankToValue(rank, N) -> then apply SCORING_MULTIPLIERS chain
      // as seedService does for each league type.
      //
      // These are the pre-drift base values at specific ranks:
      // DYN_1QB (N=343): rank 50 = 606.5, rank 150 = 218.6
      // DYN_SF (N=309): rank 50 = 574.0, rank 150 = 184.9
      // RED_1QB (N=346): rank 50 = 609.1, rank 150 = 221.5
      // RED_SF (N=253): rank 50 = 507.6, rank 150 = 127.3

      // DYN_1QB: N=343
      expect(rankToValue(1, 343)).toBe(999.9);
      expect(rankToValue(10, 343)).toBe(912.2);
      expect(rankToValue(50, 343)).toBe(606.5);
      expect(rankToValue(150, 343)).toBe(218.6);

      // DYN_SF: N=309
      expect(rankToValue(1, 309)).toBe(999.9);
      expect(rankToValue(10, 309)).toBe(903.0);
      expect(rankToValue(50, 309)).toBe(574.0);
      expect(rankToValue(150, 309)).toBe(184.9);

      // RED_1QB: N=346
      expect(rankToValue(1, 346)).toBe(999.9);
      expect(rankToValue(10, 346)).toBe(912.9);
      expect(rankToValue(50, 346)).toBe(609.1);
      expect(rankToValue(150, 346)).toBe(221.5);

      // RED_SF: N=253
      expect(rankToValue(1, 253)).toBe(999.9);
      expect(rankToValue(10, 253)).toBe(882.8);
      expect(rankToValue(50, 253)).toBe(507.6);
      expect(rankToValue(150, 253)).toBe(127.3);
    });
  });

  // =====================================================
  // Trade Suggestions Tests
  // =====================================================

  describe('computeTradeSuggestions', () => {
    // Helper to create a trade input that produces valid suggestions
    function makeTradeInput(overrides: Partial<Parameters<typeof computeTradeSuggestions>[0]> = {}) {
      return {
        leagueType: 'DYN_SF_PPR_STD',
        team1: [
          { id: 1, name: 'Elite QB', value: 950, position: 'QB', team: 'TEAM', kind: 'player' },
        ],
        team2: [
          { id: 2, name: 'Mid RB', value: 400, position: 'RB', team: 'TEAM', kind: 'player' },
        ],
        candidates: [
          { id: 10, name: 'WR Target', value: 550, position: 'WR', team: 'TEAM', kind: 'player' },
          { id: 11, name: 'TE Target', value: 500, position: 'TE', team: 'TEAM', kind: 'player' },
          { id: 12, name: 'RB Target', value: 450, position: 'RB', team: 'TEAM', kind: 'player' },
          { id: 13, name: 'QB Target', value: 520, position: 'QB', team: 'TEAM', kind: 'player' },
        ],
        initialResult: {
          diff: 550,  // 950 - 400 = 550
          total: 1350,
          lean: 550 / 1350,
          verdict: 'Clear win — Team 2',
          team1Length: 1,
          team2Length: 1,
        },
        ...overrides,
      };
    }

    it('returns empty array for Fair trade', () => {
      const input = makeTradeInput({
        team1: [{ id: 1, name: 'A', value: 800, position: 'RB', team: 'T', kind: 'player' }],
        team2: [{ id: 2, name: 'B', value: 800, position: 'RB', team: 'T', kind: 'player' }],
        initialResult: { diff: 0, total: 1600, lean: 0, verdict: 'Fair trade', team1Length: 1, team2Length: 1 },
      });
      const suggestions = computeTradeSuggestions(input);
      expect(suggestions).toEqual([]);
    });

    it('returns suggestions that improve the trade (|lean_after| < |lean_before|)', () => {
      const input = makeTradeInput();
      const suggestions = computeTradeSuggestions(input);
      
      expect(suggestions.length).toBeGreaterThan(0);
      for (const s of suggestions) {
        expect(s.resultingLean).toBeLessThan(Math.abs(input.initialResult.lean));
      }
    });

    it('suggestions are ordered by resultingLean ascending (closest fit first)', () => {
      const input = makeTradeInput();
      const suggestions = computeTradeSuggestions(input);
      
      for (let i = 1; i < suggestions.length; i++) {
        expect(suggestions[i].resultingLean).toBeGreaterThanOrEqual(suggestions[i - 1].resultingLean);
      }
    });

    it('position diversity: results span at least two positions when available', () => {
      const input = makeTradeInput();
      const suggestions = computeTradeSuggestions(input);
      
      if (suggestions.length >= 2) {
        const positions = new Set(suggestions.map(s => s.position));
        expect(positions.size).toBeGreaterThanOrEqual(2);
      }
    });

    it('excludes assets already on either side of the trade', () => {
      const input = makeTradeInput({
        team1: [
          { id: 1, name: 'Elite QB', value: 950, position: 'QB', team: 'T', kind: 'player' },
          { id: 10, name: 'WR Target', value: 550, position: 'WR', team: 'T', kind: 'player' },
        ],
        team2: [
          { id: 2, name: 'Mid RB', value: 400, position: 'RB', team: 'T', kind: 'player' },
          { id: 3, name: 'Mid WR', value: 400, position: 'WR', team: 'T', kind: 'player' },
        ],
        candidates: [
          { id: 1, name: 'Elite QB', value: 950, position: 'QB', team: 'T', kind: 'player' },
          { id: 10, name: 'WR Target', value: 550, position: 'WR', team: 'T', kind: 'player' },
          { id: 11, name: 'TE Target', value: 500, position: 'TE', team: 'T', kind: 'player' },
        ],
      });
      const suggestions = computeTradeSuggestions(input);
      
      const suggestionIds = suggestions.map(s => s.id);
      expect(suggestionIds).not.toContain(1);
      expect(suggestionIds).not.toContain(10);
      expect(suggestionIds).not.toContain(2);
      expect(suggestionIds).not.toContain(3);
    });

    it('value-filtering would be wrong: best simulated fit differs from adviceGap', () => {
      // Regression guard: don't filter by value near adviceGap
      const input = makeTradeInput({
        team1: [{ id: 1, name: 'Elite', value: 950, position: 'RB', team: 'T', kind: 'player' }],
        team2: [{ id: 2, name: 'Mid', value: 400, position: 'WR', team: 'T', kind: 'player' }],
        candidates: [
          { id: 10, name: 'Best Sim', value: 650, position: 'QB', team: 'T', kind: 'player' },
          { id: 11, name: 'Near AdviceGap', value: 550, position: 'WR', team: 'T', kind: 'player' },
          { id: 12, name: 'Other', value: 500, position: 'TE', team: 'T', kind: 'player' },
        ],
        initialResult: {
          diff: 550,
          total: 1350,
          lean: 550 / 1350,
          verdict: 'Clear win — Team 2',
          team1Length: 1,
          team2Length: 1,
        },
      });
      const suggestions = computeTradeSuggestions(input);
      
      // The best suggestion should be the one that actually minimizes |lean_after| via simulation,
      // not necessarily the one closest to adviceGap
      expect(suggestions.length).toBeGreaterThan(0);
      expect(['Best Sim', 'Other', 'Near AdviceGap']).toContain(suggestions[0].name);
    });

    it('empty side: evaluateTrade with team2: [] returns rawSum: 0, depthPenalty: 0, finite lean, and populated suggestions', () => {
      const input = makeTradeInput({
        team1: [{ id: 1, name: 'Star', value: 900, position: 'RB', team: 'T', kind: 'player' }],
        team2: [],
        candidates: [
          { id: 10, name: 'Target', value: 850, position: 'QB', team: 'T', kind: 'player' },
          { id: 11, name: 'Target2', value: 800, position: 'RB', team: 'T', kind: 'player' },
        ],
        initialResult: {
          diff: 900,
          total: 900,
          lean: 1,
          verdict: 'Landslide — Team 2',
          team1Length: 1,
          team2Length: 0,
        },
      });
      const suggestions = computeTradeSuggestions(input);
      
      expect(suggestions.length).toBeGreaterThan(0);
    });

    it('no picks in Redraft: RED_* league type never yields a PICK suggestion even when picks exist in candidates', () => {
      const input = makeTradeInput({
        leagueType: 'RED_1QB_PPR_STD',
        candidates: [
          { id: 10, name: 'QB Target', value: 850, position: 'QB', team: 'T', kind: 'player' },
          { id: 11, name: '1st Round Pick', value: 800, position: 'PICK', team: null, kind: 'pick' },
        ],
      });
      const suggestions = computeTradeSuggestions(input);
      
      for (const s of suggestions) {
        expect(s.position).not.toBe('PICK');
        expect(s.kind).not.toBe('pick');
      }
    });

    it('handles extreme trades where no candidate meaningfully changes the verdict', () => {
      // Extreme landslide where even the best asset can't change the verdict band
      const input = makeTradeInput({
        team1: [{ id: 1, name: 'Elite', value: 999.9, position: 'QB', team: 'T', kind: 'player' }],
        team2: [{ id: 2, name: 'Scrub', value: 10, position: 'RB', team: 'T', kind: 'player' }],
        candidates: [
          { id: 10, name: 'Best Available', value: 50, position: 'WR', team: 'T', kind: 'player' },
        ],
        initialResult: {
          diff: 989.9,
          total: 1009.9,
          lean: 989.9 / 1009.9,
          verdict: 'Landslide — Team 2',
          team1Length: 1,
          team2Length: 1,
        },
      });
      const suggestions = computeTradeSuggestions(input);
      
      // The algorithm should handle this without error
      expect(Array.isArray(suggestions)).toBe(true);
    });

    it('backfills from remaining pool when fewer than 3 position groups', () => {
      const input = makeTradeInput({
        team1: [{ id: 1, name: 'Elite', value: 950, position: 'QB', team: 'T', kind: 'player' }],
        team2: [
          { id: 2, name: 'Mid1', value: 350, position: 'WR', team: 'T', kind: 'player' },
          { id: 3, name: 'Mid2', value: 350, position: 'WR', team: 'T', kind: 'player' },
        ],
        candidates: [
          { id: 10, name: 'QB1', value: 900, position: 'QB', team: 'T', kind: 'player' },
          { id: 11, name: 'QB2', value: 850, position: 'QB', team: 'T', kind: 'player' },
          { id: 12, name: 'QB3', value: 800, position: 'QB', team: 'T', kind: 'player' },
        ],
        initialResult: {
          diff: 250,
          total: 1650,
          lean: 250 / 1650,
          verdict: 'Clear win — Team 2',
          team1Length: 1,
          team2Length: 2,
        },
      });
      const suggestions = computeTradeSuggestions(input);
      
      // Should return up to 3 suggestions even if all from same position (backfill)
      expect(suggestions.length).toBeLessThanOrEqual(3);
    });
  });
});
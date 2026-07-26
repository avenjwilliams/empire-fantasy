import { describe, it, expect } from 'vitest';
import {
  clampRound,
  trueValue,
  getWeight,
  getVerdict,
  evaluateTrade,
  TRADE_CONSTANTS,
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
    it('maps 100 to 10000', () => {
      expect(trueValue(100)).toBe(10000);
    });

    it('maps 0 to 0', () => {
      expect(trueValue(0)).toBe(0);
    });

    it('is convex (higher values disproportionately larger)', () => {
      // v=80 should be much more than 80% of v=100
      const tv80 = trueValue(80);
      const tv100 = trueValue(100);
      expect(tv80 / tv100).toBeLessThan(0.8);
      expect(tv80 / tv100).toBeGreaterThan(0.4);
    });

    it('is monotonically increasing (invariant 5a)', () => {
      let prev = trueValue(0);
      for (let v = 1; v <= 100; v++) {
        const curr = trueValue(v);
        expect(curr).toBeGreaterThan(prev);
        prev = curr;
      }
    });

    it('matches expected approximate values from spec', () => {
      expect(trueValue(80)).toBeCloseTo(5600, -2);
      expect(trueValue(60)).toBeCloseTo(2650, -2);
      expect(trueValue(40)).toBeCloseTo(925, -2);
      expect(trueValue(20)).toBeCloseTo(152, -2);
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

    // Invariant 2: One 95 vs three 55s → favors the 95 side
    it('invariant 2: one 95 vs three 55s favors the 95 side', () => {
      const result = evaluateTrade({
        leagueType: 'DYN_SF_PPR_TEP',
        team1: [{ id: 1, name: 'Star', value: 95.0 }],
        team2: [
          { id: 2, name: 'Mid A', value: 55.0 },
          { id: 3, name: 'Mid B', value: 55.0 },
          { id: 4, name: 'Mid C', value: 55.0 },
        ],
      });
      // Team 2 is giving more total quantity but getting the star
      // diff = side1 - side2. If side1 (star) > side2 (three 55s after weighting)
      // then diff > 0 → scale > 0 → favors Team 2 (they get the star)
      // "favors the 95 side" means the side RECEIVING the 95 wins
      // Team 2 receives the 95 → scale > 0 (favors Team 2)
      expect(result.scale).toBeGreaterThan(0);
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
  });
});

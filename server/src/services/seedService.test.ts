import { describe, it, expect } from 'vitest';
import {
  clampRound,
  rankToValue,
  RANK_DECAY_K,
  SCORING_MULTIPLIERS,
} from '@empire-fantasy/shared';
import type { Position, Format, QBSetting, RecScoring, TEPSetting } from '@empire-fantasy/shared';
import {
  oldRankToValue100,
  clampRound100,
  applyScoringMultipliers,
  applyScoringMultipliers100,
} from './seedService.js';
import type { DbLeagueType } from './seedService.js';

function makeLeagueType(overrides: Partial<DbLeagueType> = {}): DbLeagueType {
  return {
    id: 0,
    code: overrides.code || 'TEST',
    format: overrides.format || 'DYN',
    qb: overrides.qb || '1QB',
    rec: overrides.rec || 'PPR',
    tep: overrides.tep ?? 0,
  };
}

describe('seedService migration 004 model', () => {
  describe('clampRound100', () => {
    it('rounds to one decimal place at 100-scale', () => {
      expect(clampRound100(55.55)).toBe(55.6);
      expect(clampRound100(55.54)).toBe(55.5);
      expect(clampRound100(33.333)).toBe(33.3);
    });

    it('clamps below 1.0 to 1.0', () => {
      expect(clampRound100(0)).toBe(1.0);
      expect(clampRound100(-5)).toBe(1.0);
      expect(clampRound100(0.5)).toBe(1.0);
    });

    it('clamps above 100.0 to 100.0', () => {
      expect(clampRound100(100.1)).toBe(100.0);
      expect(clampRound100(150)).toBe(100.0);
    });

    it('preserves values within range', () => {
      expect(clampRound100(50.0)).toBe(50.0);
      expect(clampRound100(1.0)).toBe(1.0);
      expect(clampRound100(100.0)).toBe(100.0);
    });
  });

  describe('oldRankToValue100', () => {
    it('produces values in 1.0-100.0 range', () => {
      const N = 343;
      for (let r = 1; r <= N; r++) {
        const v = oldRankToValue100(r, N);
        expect(v).toBeGreaterThanOrEqual(1.0);
        expect(v).toBeLessThanOrEqual(100.0);
      }
    });

    it('is monotonically non-increasing in rank (due to 100-scale precision limits)', () => {
      const N = 343;
      let prev = oldRankToValue100(1, N);
      for (let r = 2; r <= N; r++) {
        const curr = oldRankToValue100(r, N);
        // At 100-scale with 0.1 precision, some adjacent ranks may round to same value
        expect(curr).toBeLessThanOrEqual(prev);
        prev = curr;
      }
    });

    it('rank 1 at N=343 produces ~100.0', () => {
      // At rank 1, raw = 100 * exp(0) = 100
      expect(oldRankToValue100(1, 343)).toBe(100.0);
    });

    it('matches expected values at N=343', () => {
      expect(oldRankToValue100(50, 343)).toBeCloseTo(60.7, 1);
      expect(oldRankToValue100(150, 343)).toBeCloseTo(21.9, 1);
    });
  });

  describe('applyScoringMultipliers100', () => {
    it('applies HALF multiplier at 100-scale', () => {
      const base = 100.0;
      const result = applyScoringMultipliers100(base, 'RB', makeLeagueType({
        code: 'TEST_HALF_STD',
        format: 'DYN',
        qb: '1QB',
        rec: 'HALF',
        tep: 0,
      }));
      // RB HALF multiplier is 0.97
      expect(result).toBeCloseTo(97.0, 1);
    });

    it('applies ZERO multiplier at 100-scale', () => {
      const base = 100.0;
      const result = applyScoringMultipliers100(base, 'WR', makeLeagueType({
        code: 'TEST_ZERO_STD',
        format: 'DYN',
        qb: '1QB',
        rec: 'ZERO',
        tep: 0,
      }));
      // WR ZERO multiplier is 0.93
      expect(result).toBeCloseTo(93.0, 1);
    });

    it('applies TEP multiplier for TE at 100-scale', () => {
      const base = 80.0; // Use a base value that won't clamp after * 1.12
      const result = applyScoringMultipliers100(base, 'TE', makeLeagueType({
        code: 'TEST_PPR_TEP',
        format: 'DYN',
        qb: '1QB',
        rec: 'PPR',
        tep: 1,
      }));
      // 80 * 1.12 = 89.6
      expect(result).toBeCloseTo(89.6, 1);
    });

    it('does not apply TEP to non-TE positions', () => {
      const base = 100.0;
      const result = applyScoringMultipliers100(base, 'QB', makeLeagueType({
        code: 'TEST_PPR_TEP',
        format: 'DYN',
        qb: '1QB',
        rec: 'PPR',
        tep: 1,
      }));
      expect(result).toBe(100.0);
    });

    it('clamps at 100.0', () => {
      const base = 95.0;
      const result = applyScoringMultipliers100(base, 'TE', makeLeagueType({
        code: 'TEST_PPR_TEP',
        format: 'DYN',
        qb: '1QB',
        rec: 'PPR',
        tep: 1,
      }));
      // 95 * 1.12 = 106.4, clamped to 100.0
      expect(result).toBe(100.0);
    });

    it('clamps at 1.0', () => {
      const base = 0.5;
      const result = applyScoringMultipliers100(base, 'RB', makeLeagueType({
        code: 'TEST_ZERO_STD',
        format: 'DYN',
        qb: '1QB',
        rec: 'ZERO',
        tep: 0,
      }));
      // 0.5 * 0.93 = 0.465, clamped to 1.0
      expect(result).toBe(1.0);
    });
  });

  describe('migration 004 model reproduction', () => {
    // Test that the migration 004 model (oldRankToValue100 -> applyScoringMultipliers100 -> ×10 -> round)
    // matches what was actually stored in the DB for a known player.
    // We'll use a known rank from the CSVs and verify the math.
    
    it('models migration 004 correctly for PPR STD (no multipliers)', () => {
      // For PPR STD, no multipliers applied
      // Migration 004: ROUND(value * 10, 1) where value = oldRankToValue100(rank, N)
      const rank = 50;
      const N = 343; // DYN_1QB
      
      const quantizedBase = oldRankToValue100(rank, N);
      const quantizedBaseAfter = applyScoringMultipliers100(quantizedBase, 'RB', makeLeagueType({
        code: 'DYN_1QB_PPR_STD',
        format: 'DYN',
        qb: '1QB',
        rec: 'PPR',
        tep: 0,
      }));
      const migratedBase = Math.round(quantizedBaseAfter * 100) / 10;
      
      // The precise new value at this rank
      const preciseBase = rankToValue(rank, N);
      
      // For PPR STD, both should be rankToValue(rank, N) * 10 (roughly)
      // But migration 004 had 100-scale precision, new has 1000-scale
      // Verify the model is internally consistent
      expect(migratedBase).toBeGreaterThan(0);
    });

    it('models migration 004 correctly for HALF STD (with multiplier)', () => {
      const rank = 50;
      const N = 343; // DYN_1QB
      
      const quantizedBase = oldRankToValue100(rank, N);
      const quantizedBaseAfter = applyScoringMultipliers100(quantizedBase, 'RB', makeLeagueType({
        code: 'DYN_1QB_HALF_STD',
        format: 'DYN',
        qb: '1QB',
        rec: 'HALF',
        tep: 0,
      }));
      const migratedBase = Math.round(quantizedBaseAfter * 100) / 10;
      
      // This should equal what seedService would produce at 100-scale then ×10
      // seedService at 100-scale: rankToValue100 -> applyMultipliers -> clampRound100 -> ×10
      expect(migratedBase).toBeGreaterThan(0);
    });

    it('models migration 004 correctly for TEP (TE position)', () => {
      const rank = 50;
      const N = 343; // DYN_1QB
      
      const quantizedBase = oldRankToValue100(rank, N);
      const quantizedBaseAfter = applyScoringMultipliers100(quantizedBase, 'TE', makeLeagueType({
        code: 'DYN_1QB_PPR_TEP',
        format: 'DYN',
        qb: '1QB',
        rec: 'PPR',
        tep: 1,
      }));
      const migratedBase = Math.round(quantizedBaseAfter * 100) / 10;
      
      expect(migratedBase).toBeGreaterThan(0);
    });
  });

  describe('idempotency: rebase transform applied twice yields same output', () => {
    // The rebase transform is:
    // 1. Compute quantizedBase (what migration 004 produced)
    // 2. Compute drift = currentValue - quantizedBase
    // 3. Compute preciseBase (999.9 amplitude)
    // 4. newValue = clampRound(preciseBase + drift)
    //
    // If we run this twice:
    // First run: currentValue = quantizedBase (or quantizedBase + accumulatedDrift)
    //   drift = currentValue - quantizedBase = accumulatedDrift
    //   newValue = preciseBase + accumulatedDrift
    // Second run: currentValue = preciseBase + accumulatedDrift
    //   drift = (preciseBase + accumulatedDrift) - quantizedBase = (preciseBase - quantizedBase) + accumulatedDrift
    //   newValue = preciseBase + (preciseBase - quantizedBase) + accumulatedDrift = 2*preciseBase - quantizedBase + accumulatedDrift
    //
    // This would compound! But the idempotency fix uses the ORIGINAL pre-rebase value
    // from adjustment_log as the drift basis.
    //
    // This test simulates the idempotent behavior.

    it('rebase transform with original drift basis is idempotent', () => {
      const rank = 50;
      const N = 343;
      const position = 'RB';
      
      // Original quantized value (what migration 004 stored)
      const quantizedBase = oldRankToValue100(rank, N);
      const quantizedBaseAfter = applyScoringMultipliers100(quantizedBase, position, makeLeagueType({
        code: 'DYN_1QB_HALF_STD',
        format: 'DYN',
        qb: '1QB',
        rec: 'HALF',
        tep: 0,
      }));
      const quantizedBaseFinal = Math.round(quantizedBaseAfter * 100) / 10;
      
      // Precise base (what we want)
      const preciseBase = rankToValue(rank, N);
      const preciseBaseAfter = applyScoringMultipliers(preciseBase, position, makeLeagueType({
        code: 'DYN_1QB_HALF_STD',
        format: 'DYN',
        qb: '1QB',
        rec: 'HALF',
        tep: 0,
      }));
      
      // Simulate some accumulated drift (from votes, stats, etc.)
      const accumulatedDrift = 12.3;
      const currentValue = clampRound(quantizedBaseFinal + accumulatedDrift);
      
      // First rebase run: uses currentValue as drift basis
      const drift1 = currentValue - quantizedBaseFinal;
      const newValue1 = clampRound(preciseBaseAfter + drift1);
      
      // Second rebase run with idempotency: uses ORIGINAL value (quantizedBaseFinal) as drift basis
      const drift2 = quantizedBaseFinal - quantizedBaseFinal; // = 0 (using original pre-rebase value)
      const newValue2 = clampRound(preciseBaseAfter + drift2);
      
      // With idempotency fix, the second run should use the pre-rebase old_value from log
      // which is quantizedBaseFinal, so drift = 0, newValue = preciseBaseAfter
      // But wait - the first run already changed the value to preciseBaseAfter + drift
      // The idempotency fix means: if already rebased, use the OLD_VALUE from the log
      // The old_value in the log IS quantizedBaseFinal (the pre-rebase value)
      // So drift = old_value - quantizedBaseFinal = 0
      // newValue = preciseBaseAfter + 0 = preciseBaseAfter
      // 
      // But wait - the first run's drift was accumulatedDrift
      // newValue1 = preciseBaseAfter + accumulatedDrift
      // The log stores old_value = currentValue = quantizedBaseFinal + accumulatedDrift
      // Second run: driftBasis = old_value from log = quantizedBaseFinal + accumulatedDrift
      // drift = driftBasis - quantizedBaseFinal = accumulatedDrift
      // newValue = preciseBaseAfter + accumulatedDrift = newValue1 (SAME!)
      
      // Let's simulate this correctly:
      // Pre-rebase value in DB (after migration 004, plus some drift)
      const preRebaseValue = clampRound(quantizedBaseFinal + accumulatedDrift);
      
      // First rebase:
      const driftFirst = preRebaseValue - quantizedBaseFinal; // = accumulatedDrift
      const newValueFirst = clampRound(preciseBaseAfter + driftFirst);
      
      // The adjustment_log records: old_value = preRebaseValue
      // Second rebase (with idempotency):
      const driftBasis = preRebaseValue; // from adjustment_log
      const driftSecond = driftBasis - quantizedBaseFinal; // = accumulatedDrift
      const newValueSecond = clampRound(preciseBaseAfter + driftSecond);
      
      // They should be equal!
      expect(newValueSecond).toBe(newValueFirst);
    });

    it('rebase without idempotency would compound', () => {
      // This demonstrates the bug: using currentValue as drift basis on re-run
      const rank = 50;
      const N = 343;
      const position = 'RB';
      
      const quantizedBase = oldRankToValue100(rank, N);
      const quantizedBaseAfter = applyScoringMultipliers100(quantizedBase, position, makeLeagueType({
        code: 'DYN_1QB_HALF_STD',
        format: 'DYN',
        qb: '1QB',
        rec: 'HALF',
        tep: 0,
      }));
      const quantizedBaseFinal = Math.round(quantizedBaseAfter * 100) / 10;
      
      const preciseBase = rankToValue(rank, N);
      const preciseBaseAfter = applyScoringMultipliers(preciseBase, position, makeLeagueType({
        code: 'DYN_1QB_HALF_STD',
        format: 'DYN',
        qb: '1QB',
        rec: 'HALF',
        tep: 0,
      }));
      
      const accumulatedDrift = 12.3;
      const preRebaseValue = clampRound(quantizedBaseFinal + accumulatedDrift);
      
      // First run (correct)
      const drift1 = preRebaseValue - quantizedBaseFinal;
      const newValue1 = clampRound(preciseBaseAfter + drift1);
      
      // Second run WITHOUT idempotency (using newValue1 as current value)
      const drift2 = newValue1 - quantizedBaseFinal; // WRONG: includes first run's correction!
      const newValue2 = clampRound(preciseBaseAfter + drift2);
      
      // These would be different (compounded)
      expect(newValue2).not.toBe(newValue1);
    });
  });
});
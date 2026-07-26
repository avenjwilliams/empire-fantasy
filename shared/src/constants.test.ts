import { describe, it, expect } from 'vitest';
import { RANK_DECAY_K } from './constants.js';

// Test the rank-to-value curve that uses RANK_DECAY_K
// value = 100 * exp(-k * (rank-1) / N)
function rankToValue(rank: number, N: number): number {
  const raw = 100 * Math.exp(-RANK_DECAY_K * (rank - 1) / N);
  return Math.round(Math.max(1, Math.min(100, raw)) * 10) / 10;
}

describe('rank-to-value curve', () => {
  const N = 60; // fixture player count

  it('rank 1 maps to ~100', () => {
    expect(rankToValue(1, N)).toBe(100);
  });

  it('is monotonically decreasing', () => {
    let prev = rankToValue(1, N);
    for (let r = 2; r <= N; r++) {
      const curr = rankToValue(r, N);
      expect(curr).toBeLessThanOrEqual(prev);
      prev = curr;
    }
  });

  it('top 5 players are valued above 70 (with 60 total)', () => {
    for (let r = 1; r <= 5; r++) {
      expect(rankToValue(r, N)).toBeGreaterThan(70);
    }
  });

  it('bottom quartile players have meaningful but low values', () => {
    const bottomStart = Math.floor(N * 0.75);
    for (let r = bottomStart; r <= N; r++) {
      const v = rankToValue(r, N);
      expect(v).toBeGreaterThanOrEqual(1.0);
      expect(v).toBeLessThan(30);
    }
  });

  it('with 400 players, rank 50 ≈ 65, rank 200 ≈ 15', () => {
    const v50 = rankToValue(50, 400);
    const v200 = rankToValue(200, 400);
    expect(v50).toBeGreaterThan(55);
    expect(v50).toBeLessThan(75);
    expect(v200).toBeGreaterThan(10);
    expect(v200).toBeLessThan(25);
  });
});

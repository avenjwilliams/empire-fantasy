/** Rank-to-value decay constant. Tuned so rank 1 ≈ 1000, rank ~50 ≈ 650, rank ~200 ≈ 150 */
export const RANK_DECAY_K = 3.5;

/** Scoring multipliers applied at seed time to expand 4 base sets → 24 */
export const SCORING_MULTIPLIERS = {
  HALF: { QB: 1.0, RB: 0.97, WR: 0.97, TE: 0.97 },
  ZERO: { QB: 1.0, RB: 0.93, WR: 0.93, TE: 0.93 },
  TEP: { QB: 1.0, RB: 1.0, WR: 1.0, TE: 1.12 },
} as const;

/** Default pick values for dynasty seeding (1QB baseline) — ×10 for 1–1000 scale */
export const PICK_VALUES: Record<string, number> = {
  // next-year (year offset 1)
  '1_1_EARLY': 650, '1_1_MID': 550, '1_1_LATE': 450,
  '1_2_EARLY': 320, '1_2_MID': 270, '1_2_LATE': 230,
  '1_3_EARLY': 150, '1_3_MID': 120, '1_3_LATE': 100,
  '1_4_EARLY': 60,  '1_4_MID': 50,  '1_4_LATE': 40,
};

/** Per-year-further-out decay for picks */
export const PICK_YEAR_DECAY = 0.95;

/** SF multiplier for round 1 picks (QBs go earlier) */
export const PICK_SF_FIRST_ROUND_MULTIPLIER = 1.05;

/** Current year for pick generation */
export const CURRENT_YEAR = 2026;

/** Pick years to seed: current+1 through current+3 */
export const PICK_YEARS = [
  CURRENT_YEAR + 1,
  CURRENT_YEAR + 2,
  CURRENT_YEAR + 3,
];

// =====================================================
// Stat Ingestion Constants
// =====================================================

/** Fantasy points scoring weights (base scoring) */
export const SCORING = {
  PASS_YD: 1 / 25,   // 0.04 per yard
  PASS_TD: 4,
  PASS_INT: -2,
  RUSH_YD: 1 / 10,   // 0.1 per yard
  RUSH_TD: 6,
  REC_YD: 1 / 10,    // 0.1 per yard
  REC_TD: 6,
  FUM_LOST: -2,
} as const;

/** Per-reception bonus by scoring type */
export const REC_BONUS: Record<string, number> = {
  PPR: 1.0,
  HALF: 0.5,
  ZERO: 0,
};

/** Additional per-reception bonus for TEs in TEP leagues */
export const TEP_BONUS = 0.5;

/** Sensitivity (z-score multiplier) by format */
export const STAT_SENSITIVITY: Record<string, number> = {
  RED: 0.35,
  DYN: 0.15,
};

/** Max absolute delta per stat adjustment by format */
export const STAT_CAP: Record<string, number> = {
  RED: 0.8,
  DYN: 0.4,
};

/** Age nudges for dynasty sets (per week, DYN only) — ×10 for 1–1000 scale */
export const AGE_NUDGE: Record<string, { minAge: number; nudge: number }> = {
  RB: { minAge: 27, nudge: -0.5 },
  WR: { minAge: 30, nudge: -0.3 },
  TE: { minAge: 30, nudge: -0.3 },
  QB: { minAge: 36, nudge: -0.3 },
};

/** Minimum value to include in the expectation model */
export const MIN_VALUE_FOR_EXPECTATION = 50;

/** Inactive decay: weeks without stats before decay starts */
export const INACTIVE_THRESHOLD_WEEKS = 8;

/** Inactive decay: multiplicative decay rate per week after threshold (15%, scale-invariant) */
export const INACTIVE_DECAY_RATE = 0.15;

/** Inactive decay: floor value (minimum) — matches clampRound floor */
export const INACTIVE_FLOOR = 1.0;

/** Inactive decay: only decay players above this value */
export const INACTIVE_MIN_VALUE = 50;

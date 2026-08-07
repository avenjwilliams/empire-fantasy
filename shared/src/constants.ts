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

// =====================================================
// NFL Team identity (shared so server can validate team codes)
// =====================================================

export interface NflTeam {
  code: string;      // 'DAL' — matches the players.team convention
  city: string;      // 'Dallas'
  nickname: string;  // 'Cowboys' — this is what appears in the author name
}

export const NFL_TEAMS: readonly NflTeam[] = [
  { code: 'ARI', city: 'Arizona', nickname: 'Cardinals' },
  { code: 'ATL', city: 'Atlanta', nickname: 'Falcons' },
  { code: 'BAL', city: 'Baltimore', nickname: 'Ravens' },
  { code: 'BUF', city: 'Buffalo', nickname: 'Bills' },
  { code: 'CAR', city: 'Carolina', nickname: 'Panthers' },
  { code: 'CHI', city: 'Chicago', nickname: 'Bears' },
  { code: 'CIN', city: 'Cincinnati', nickname: 'Bengals' },
  { code: 'CLE', city: 'Cleveland', nickname: 'Browns' },
  { code: 'DAL', city: 'Dallas', nickname: 'Cowboys' },
  { code: 'DEN', city: 'Denver', nickname: 'Broncos' },
  { code: 'DET', city: 'Detroit', nickname: 'Lions' },
  { code: 'GB', city: 'Green Bay', nickname: 'Packers' },
  { code: 'HOU', city: 'Houston', nickname: 'Texans' },
  { code: 'IND', city: 'Indianapolis', nickname: 'Colts' },
  { code: 'JAX', city: 'Jacksonville', nickname: 'Jaguars' },
  { code: 'KC', city: 'Kansas City', nickname: 'Chiefs' },
  { code: 'LAC', city: 'Los Angeles', nickname: 'Chargers' },
  { code: 'LAR', city: 'Los Angeles', nickname: 'Rams' },
  { code: 'LV', city: 'Las Vegas', nickname: 'Raiders' },
  { code: 'MIA', city: 'Miami', nickname: 'Dolphins' },
  { code: 'MIN', city: 'Minnesota', nickname: 'Vikings' },
  { code: 'NE', city: 'New England', nickname: 'Patriots' },
  { code: 'NO', city: 'New Orleans', nickname: 'Saints' },
  { code: 'NYG', city: 'New York', nickname: 'Giants' },
  { code: 'NYJ', city: 'New York', nickname: 'Jets' },
  { code: 'PHI', city: 'Philadelphia', nickname: 'Eagles' },
  { code: 'PIT', city: 'Pittsburgh', nickname: 'Steelers' },
  { code: 'SEA', city: 'Seattle', nickname: 'Seahawks' },
  { code: 'SF', city: 'San Francisco', nickname: '49ers' },
  { code: 'TB', city: 'Tampa Bay', nickname: 'Buccaneers' },
  { code: 'TEN', city: 'Tennessee', nickname: 'Titans' },
  { code: 'WAS', city: 'Washington', nickname: 'Commanders' },
] as const;

export const NFL_TEAM_CODES: readonly string[] = NFL_TEAMS.map(t => t.code);

/** Returns the nickname for a team code, or null if unknown or null. */
export function teamNickname(code: string | null): string | null {
  if (!code) return null;
  const team = NFL_TEAMS.find(t => t.code === code);
  return team?.nickname ?? null;
}

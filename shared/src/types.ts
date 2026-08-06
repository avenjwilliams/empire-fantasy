export type Position = 'QB' | 'RB' | 'WR' | 'TE';
export type Format = 'DYN' | 'RED';
export type QBSetting = '1QB' | 'SF';
export type RecScoring = 'PPR' | 'HALF' | 'ZERO';
export type TEPSetting = 'TEP' | 'STD';
export type AssetKind = 'player' | 'pick';
export type AdjustmentReason = 'seed' | 'vote' | 'stat' | 'manual' | 'decay';
export type PlayerStatus = 'active' | 'injured' | 'inactive';
export type PickTier = 'EARLY' | 'MID' | 'LATE';

export interface LeagueType {
  id?: number;
  code: string;
  format: Format;
  qb: QBSetting;
  rec: RecScoring;
  tep: TEPSetting;
}

export interface Player {
  id: number;
  sleeper_id: string;
  name: string;
  position: Position;
  team: string | null;
  age: number | null;
  status: PlayerStatus;
  created_at: string;
  updated_at: string | null;
  /** Share of weeks that qualify as a boom outcome, 0–100. Null until generated.
   *  Independent of bust_pct — the two are not shares of the same whole. */
  boom_pct: number | null;
  /** Share of weeks that qualify as a bust outcome, 0–100. Null until generated.
   *  Independent of boom_pct. */
  bust_pct: number | null;
}

export interface Pick {
  id: number;
  season: number;
  round: number;
  tier: PickTier;
}

export interface Asset {
  id: number;
  kind: AssetKind;
  player_id: number | null;
  pick_id: number | null;
}

export interface AssetValue {
  asset_id: number;
  league_type_id: number;
  value: number;
  updated_at: string;
}

export interface AdjustmentLogEntry {
  id: number;
  asset_id: number;
  league_type_id: number;
  old_value: number;
  new_value: number;
  delta: number;
  reason: AdjustmentReason;
  detail: string | null;
  created_at: string;
}

export interface TradeAsset {
  id: number;
  name: string;
  value: number;
  trueValue: number;
  weight: number;
}

export interface TradeSide {
  assets: TradeAsset[];
  sideValue: number;
  rawSum: number;
  adjustment: number;
}

export interface TradeInput {
  leagueType: string;
  team1: number[];
  team2: number[];
}

export type Verdict = 'Fair trade' | 'Slight edge' | 'Clear win' | 'Landslide';

export interface TradeSuggestion {
  id: number;
  name: string;
  position: Position | 'PICK';
  team: string | null;
  value: number;
  /** Which side this asset should be added to. */
  side: 1 | 2;
  /** |lean| after adding this asset — lower is a closer fit. */
  resultingLean: number;
  /** Verdict this asset would produce. */
  resultingVerdict: string;
}

/** Value-weighted average boom/bust for a trade side. Descriptive only —
 *  never an input to scale, verdict, lean, or suggestions. */
export interface SideBoomBust {
  /** Value-weighted mean boom %, 0–100, integer. Null when no rated asset on this side. */
  boom: number | null;
  /** Value-weighted mean bust %, 0–100, integer. Null when no rated asset on this side. */
  bust: number | null;
  /** How many assets on this side contributed to the average. */
  ratedCount: number;
  /** How many assets on this side were excluded for having no rating (picks, ungenerated players). */
  unratedCount: number;
}

export interface TradeResult {
  leagueType: string;
  team1: TradeSide;
  team2: TradeSide;
  scale: number;
  verdict: string;
  differencePct: number;
  adviceGap: number | null;
  /** Roster-spot credit: absolute difference in depth penalties between sides.
   *  Added to the side with the SMALLER depth penalty (fewer/more concentrated pieces).
   *  Reported whenever depth penalties differ, including on Fair trades. */
  valueAdjustment: number | null;
  /** Side receiving the valueAdjustment (1 or 2), or null if zero. */
  valueAdjustmentSide: 1 | 2 | null;
  /** Up to 3 assets that would move the trade toward Fair, closest fit first.
   *  Empty when the verdict is already Fair trade. */
  suggestions: TradeSuggestion[];
  /** Value-weighted average boom/bust for each side. Descriptive only —
   *  never an input to scale, verdict, lean, or suggestions. */
  boomBust: {
    team1: SideBoomBust;
    team2: SideBoomBust;
  };
}

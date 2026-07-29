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
}

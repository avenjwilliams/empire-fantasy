// ============================================================================
// EMPIRE FANTASY — Team color themes
//
// Pure presentation data + derivation. No DOM access, no server consumer:
// the per-team accent is computed here in a testable, node-safe way instead of
// shipping 33 hand-tuned `[data-team]` blocks in theme.css (which would let the
// palette drift between the two places and duplicate it).
//
// Only the ACCENT group (--accent, --accent-dim, --accent-alt) and the SURFACE
// group (--bg, --bg-raised, --bg-hover, --border) vary per team. The SEMANTIC
// group (--ink, --ink-muted, --positive, --negative) and --severity-mid are
// global and must NEVER be themed — see docs/05-ui-spec.md "Coloring".
// ============================================================================

export interface TeamTheme {
  /** Two-letter franchise code, matching the DB convention (GB, KC, LV, SF, TB,
      NE, NO, JAX, WAS, LAR, LAC, CLE, TEN, ...). 'NONE' = Classic. */
  code: string;
  name: string;
  primary: string;   // official primary, hex
  secondary: string; // official secondary, hex
  tertiary: string;  // official tertiary, hex
}

// Base (default / "classic") surface values — today's plain :root theme.
// NONE must reproduce these exactly so "skipping changes nothing".
export const BASE_SURFACES = {
  '--bg': '#0a0e14',
  '--bg-raised': '#111720',
  '--bg-hover': '#1a2030',
  '--border': '#2a3545',
};

// The fixed middle step of the verdict + KEEP/TRADE/CUT ramps. Never themed.
// Hardcoded amber on purpose: no team theme is allowed to touch it, because a
// red or green accent in the middle of an ordered severity scale would collapse
// the ramp. No resolveTeam() output ever contains this key.
export const SEVERITY_MID = '#e8a525';

// ----------------------------------------------------------------------------
// Color math (WCAG 2.1): pure functions, unit-testable in node.
// ----------------------------------------------------------------------------

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ];
}

function rgbToHex(r: number, g: number, b: number): string {
  const c = (v: number) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
  return `#${c(r)}${c(g)}${c(b)}`;
}

/** WCAG 2.1 relative luminance of a hex color. */
export function luminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map(ch => ch / 255);
  const lin = (c: number) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** WCAG 2.1 contrast ratio (range ~1..21). */
export function contrast(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  const [hi, lo] = la >= lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

/** Per-channel sRGB linear interpolation at weight w toward a, rounded to ints. */
export function mix(a: string, b: string, w: number): string {
  const [ar, ag, ab] = hexToRgb(a);
  const [br, bg, bb] = hexToRgb(b);
  return rgbToHex(ar * w + br * (1 - w), ag * w + bg * (1 - w), ab * w + bb * (1 - w));
}

/** Lighten a hex by adding n to each channel (equal steps), clamped at 255. */
function lighten(hex: string, n: number): string {
  const [r, g, b] = hexToRgb(hex);
  return rgbToHex(r + n, g + n, b + n);
}

// ----------------------------------------------------------------------------
// The fixed team list. Do not derive from the DB/API: the players.team column
// currently holds only 29 distinct codes (CLE/LAC/TEN have no rostered players),
// so a DB-derived list would silently ship a 29-team picker. Franchise hexes are
// official, best-effort; a wrong shade is a one-line cosmetic fix. Each entry's
// accent comment marks which slot the RULES pick (a chain, not taste) — e.g.
// Baltimore accents its secondary because the dark primary cannot pass 4.5:1.
// ----------------------------------------------------------------------------
export const TEAMS: TeamTheme[] = [
  { code: 'NONE', name: 'Classic', primary: '#e8a525', secondary: '#b07c15', tertiary: '#0a0e14' },
  { code: 'ARI', name: 'Arizona Cardinals', primary: '#97233f', secondary: '#000000', tertiary: '#ffb612' }, // accent: tertiary (gold)
  { code: 'ATL', name: 'Atlanta Falcons', primary: '#a71930', secondary: '#000000', tertiary: '#a5acaf' }, // accent: tertiary (silver)
  { code: 'BAL', name: 'Baltimore Ravens', primary: '#241773', secondary: '#9e7c0c', tertiary: '#000000' }, // accent: secondary (gold)
  { code: 'BUF', name: 'Buffalo Bills', primary: '#00338d', secondary: '#c60c30', tertiary: '#b1b3b4' }, // accent: tertiary (nickel)
  { code: 'CAR', name: 'Carolina Panthers', primary: '#0085ca', secondary: '#000000', tertiary: '#a5acaf' }, // accent: primary (blue)
  { code: 'CHI', name: 'Chicago Bears', primary: '#0b162a', secondary: '#c83803', tertiary: '#ffffff' }, // accent: tertiary (white)
  { code: 'CIN', name: 'Cincinnati Bengals', primary: '#fb4f19', secondary: '#000000', tertiary: '#ffffff' }, // accent: primary (orange)
  { code: 'CLE', name: 'Cleveland Browns', primary: '#311d00', secondary: '#ff3c00', tertiary: '#ffffff' }, // accent: tertiary (white)
  { code: 'DAL', name: 'Dallas Cowboys', primary: '#002244', secondary: '#003594', tertiary: '#869397' }, // accent: tertiary (silver)
  { code: 'DEN', name: 'Denver Broncos', primary: '#fb4f14', secondary: '#002244', tertiary: '#ffffff' }, // accent: primary (orange)
  { code: 'DET', name: 'Detroit Lions', primary: '#0076b6', secondary: '#b0b0b0', tertiary: '#000000' }, // accent: tertiary (silver)
  { code: 'GB', name: 'Green Bay Packers', primary: '#203731', secondary: '#ffb612', tertiary: '#ffffff' }, // accent: secondary (gold)
  { code: 'HOU', name: 'Houston Texans', primary: '#03202f', secondary: '#a71930', tertiary: '#ffffff' }, // accent: tertiary (white)
  { code: 'IND', name: 'Indianapolis Colts', primary: '#00327b', secondary: '#ffffff', tertiary: '#737373' }, // accent: secondary (white)
  { code: 'JAX', name: 'Jacksonville Jaguars', primary: '#006778', secondary: '#000000', tertiary: '#d8a936' }, // accent: tertiary (gold)
  { code: 'KC', name: 'Kansas City Chiefs', primary: '#e31837', secondary: '#ffc517', tertiary: '#101820' }, // accent: secondary (gold)
  { code: 'LAC', name: 'Los Angeles Chargers', primary: '#0080c6', secondary: '#ffc20e', tertiary: '#002a5e' }, // accent: secondary (gold)
  { code: 'LAR', name: 'Los Angeles Rams', primary: '#003594', secondary: '#ffd200', tertiary: '#ffffff' }, // accent: secondary (gold)
  { code: 'LV', name: 'Las Vegas Raiders', primary: '#000000', secondary: '#a5acac', tertiary: '#cf8b2c' }, // accent: secondary (silver)
  { code: 'MIA', name: 'Miami Dolphins', primary: '#008e97', secondary: '#fa4c02', tertiary: '#005778' }, // accent: lightened primary (aqua)
  { code: 'MIN', name: 'Minnesota Vikings', primary: '#4f2e84', secondary: '#ffc62f', tertiary: '#b0b3b8' }, // accent: secondary (gold)
  { code: 'NE', name: 'New England Patriots', primary: '#002e51', secondary: '#c60c30', tertiary: '#0095d9' }, // accent: lightened primary (navy)
  { code: 'NO', name: 'New Orleans Saints', primary: '#101820', secondary: '#d3bc8d', tertiary: '#ffffff' }, // accent: secondary (gold)
  { code: 'NYG', name: 'New York Giants', primary: '#001e5e', secondary: '#c8102e', tertiary: '#a66a21' }, // accent: lightened primary (navy)
  { code: 'NYJ', name: 'New York Jets', primary: '#125740', secondary: '#5b8a3e', tertiary: '#0f0f0f' }, // accent: lightened primary (green)
  { code: 'PHI', name: 'Philadelphia Eagles', primary: '#004c54', secondary: '#a5acaf', tertiary: '#000000' }, // accent: secondary (silver)
  { code: 'PIT', name: 'Pittsburgh Steelers', primary: '#000000', secondary: '#ffb81c', tertiary: '#a5abab' }, // accent: secondary (gold)
  { code: 'SEA', name: 'Seattle Seahawks', primary: '#0c2340', secondary: '#69be28', tertiary: '#acabab' }, // accent: secondary (green)
  { code: 'SF', name: 'San Francisco 49ers', primary: '#aa0000', secondary: '#b3995d', tertiary: '#ffe400' }, // accent: tertiary (gold)
  { code: 'TB', name: 'Tampa Bay Buccaneers', primary: '#d50a13', secondary: '#161736', tertiary: '#a5a5a5' }, // accent: tertiary (silver)
  { code: 'TEN', name: 'Tennessee Titans', primary: '#0b1b2b', secondary: '#4b92db', tertiary: '#ffffff' }, // accent: tertiary (white)
  { code: 'WAS', name: 'Washington Commanders', primary: '#5a1414', secondary: '#9e8c44', tertiary: '#ffd700' }, // accent: tertiary (gold)
];

// ----------------------------------------------------------------------------
// Derivation
// ----------------------------------------------------------------------------

/** The darkest of the team's three colors by relative luminance. */
function darkestOf(t: TeamTheme): string {
  return [t.primary, t.secondary, t.tertiary].sort((a, b) => luminance(a) - luminance(b))[0];
}

/** Blend `accent` toward `bg` in small steps until contrast is <= 3.0, then
 *  back off if it overshot below 2.0. */
function dimToRange(accent: string, bg: string): string {
  let dim = accent;
  let t = 0;
  // t walks 0 → 1, blending from accent toward bg.
  while (t < 1 && contrast(dim, bg) > 3.0) {
    t += 0.02;
    dim = mix(bg, accent, t);
  }
  // Back off if the 0.02 step jumped past the 2.0 floor.
  while (t > 0 && contrast(dim, bg) < 2.0) {
    t -= 0.01;
    dim = mix(bg, accent, t);
  }
  return dim;
}

/**
 * Resolve a team to a full CSS-variable → hex map.
 * NONE is special-cased to reproduce the current plain :root theme exactly.
 */
export function resolveTeam(t: TeamTheme): Record<string, string> {
  if (t.code === 'NONE') {
    return {
      '--bg': BASE_SURFACES['--bg'],
      '--bg-raised': BASE_SURFACES['--bg-raised'],
      '--bg-hover': BASE_SURFACES['--bg-hover'],
      '--border': BASE_SURFACES['--border'],
      '--accent': '#e8a525',
      '--accent-dim': '#b07c15',
      '--accent-alt': '#b07c15',
    };
  }

  // --- surface tinting: never a raw team color as background. ---
  const tint = darkestOf(t);
  const bg = mix(tint, BASE_SURFACES['--bg'], 0.12);
  const bgRaised = mix(tint, BASE_SURFACES['--bg-raised'], 0.12);
  const bgHover = mix(tint, BASE_SURFACES['--bg-hover'], 0.14);
  const border = mix(tint, BASE_SURFACES['--border'], 0.2);

  // --- accent with a contrast fallback chain (a rule, not taste) ---
  const candidates = [t.primary, t.secondary, t.tertiary];
  let accent = candidates.find(c => contrast(c, bg) >= 4.5) ?? null;
  if (!accent) {
    // Lighten the primary in equal steps until it crosses 4.5:1 vs bg.
    accent = t.primary;
    for (let n = 24; n <= 255 && contrast(accent, bg) < 4.5; n += 24) {
      accent = lighten(t.primary, n);
    }
  }

  // accent-dim: darkened accent, contrast vs --bg within [2.0, 3.0].
  const accentDim = dimToRange(accent, bg);

  // accent-alt: highest-contrast of the two colors not chosen as accent.
  const notChosen = candidates.filter(c => c !== accent);
  const accentAlt = notChosen.reduce(
    (top, c) => (contrast(c, bg) >= contrast(top, bg) ? c : top),
    accent,
  );

  return {
    '--bg': bg,
    '--bg-raised': bgRaised,
    '--bg-hover': bgHover,
    '--border': border,
    '--accent': accent,
    '--accent-dim': accentDim,
    '--accent-alt': accentAlt,
  };
}
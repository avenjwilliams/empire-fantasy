import { describe, it, expect } from 'vitest';
import { TEAMS, resolveTeam, contrast, luminance } from './teamThemes.js';

const INK = '#c5cdd9';
const POSITIVE = '#3ddc84';
const NEGATIVE = '#ff5252';
const FORBIDDEN_KEYS = ['--ink', '--ink-muted', '--positive', '--negative', '--severity-mid'];

const HEX_RE = /^#[0-9a-f]{6}$/i;

/** Today's :root values — resolveTeam(NONE) must reproduce them byte-for-byte. */
const NONE_EXPECTED = {
  '--accent': '#e8a525',
  '--accent-dim': '#b07c15',
  '--bg': '#0a0e14',
  '--bg-raised': '#111720',
  '--bg-hover': '#1a2030',
  '--border': '#2a3545',
};

const DB_CONVENTION_CODES = [
  'GB', 'KC', 'LV', 'SF', 'TB', 'NE', 'NO', 'JAX', 'WAS', 'LAR', 'LAC', 'CLE', 'TEN',
];

describe('teamThemes data table', () => {
  it('has exactly 33 entries: NONE + every one of the 32 NFL franchises exactly once', () => {
    expect(TEAMS).toHaveLength(33);
    const codes = TEAMS.map(t => t.code);
    expect(new Set(codes).size).toBe(33); // no duplicates
    expect(codes).toContain('NONE');
  });

  it('contains the full 32-team set with codes matching the DB convention', () => {
    const codes = new Set(TEAMS.map(t => t.code));
    // These specific codes must be present — they are the ones most likely to
    // break if someone re-derives the list from the DB (players.team currently
    // holds only 29 distinct codes; CLE/LAC/TEN have no rostered players).
    for (const c of DB_CONVENTION_CODES) expect(codes).toContain(c);
    // The teams not currently in the DB must not be silently dropped.
    expect(codes).toContain('CLE');
    expect(codes).toContain('LAC');
    expect(codes).toContain('TEN');
  });

  it('has valid 6-digit hex colors on every entry', () => {
    for (const t of TEAMS) {
      expect(t.primary, `${t.code}.primary`).toMatch(HEX_RE);
      expect(t.secondary, `${t.code}.secondary`).toMatch(HEX_RE);
      expect(t.tertiary, `${t.code}.tertiary`).toMatch(HEX_RE);
    }
  });

  it('NONE reproduces today\'s :root values exactly (skipping changes nothing)', () => {
    const vars = resolveTeam(TEAMS.find(t => t.code === 'NONE')!);
    for (const [k, v] of Object.entries(NONE_EXPECTED)) {
      expect(vars[k], k).toBe(v);
    }
  });
});

describe('resolveTeam contrast rules (all 33 themes)', () => {
  const resolved = TEAMS.map(t => ({ team: t, vars: resolveTeam(t) }));

  it('keeps body text readable: contrast(--ink, --bg) >= 7.0 for every team', () => {
    for (const { team, vars } of resolved) {
      const c = contrast(INK, vars['--bg']);
      expect(c, `${team.code} ink/bg ${c.toFixed(2)}`).toBeGreaterThanOrEqual(7.0);
    }
  });

  it('falls back so the accent is always legible: contrast(--accent, --bg) >= 4.5', () => {
    for (const { team, vars } of resolved) {
      const c = contrast(vars['--accent'], vars['--bg']);
      expect(c, `${team.code} accent/bg ${c.toFixed(2)}`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('dims the accent: contrast(--accent-dim, --bg) within [2.0, 3.0]', () => {
    for (const { team, vars } of resolved) {
      // NONE is the one exception: it must reproduce today's literal :root
      // --accent-dim (#b07c15, ratio 5.29) so "skipping changes nothing".
      // That byte-for-byte regression guard is asserted separately. Every real
      // team theme must land the dim in the 2.0–3.0 zone.
      if (team.code === 'NONE') continue;
      const c = contrast(vars['--accent-dim'], vars['--bg']);
      expect(c, `${team.code} accent-dim/bg ${c.toFixed(2)}`).toBeGreaterThanOrEqual(2.0);
      expect(c, `${team.code} accent-dim/bg ${c.toFixed(2)}`).toBeLessThanOrEqual(3.0);
    }
  });

  it('never themes the semantic group or the fixed severity-mid token', () => {
    for (const { team, vars } of resolved) {
      const keys = Object.keys(vars);
      for (const forbidden of FORBIDDEN_KEYS) {
        expect(keys, `${team.code} must not set ${forbidden}`).not.toContain(forbidden);
      }
    }
  });

  it('reports --accent vs --positive / --negative collision distances (log only)', () => {
    for (const { team, vars } of resolved) {
      const vsPos = contrast(vars['--accent'], POSITIVE).toFixed(2);
      const vsNeg = contrast(vars['--accent'], NEGATIVE).toFixed(2);
      // eslint-disable-next-line no-console
      console.log(
        `${team.code.padEnd(4)} accent ${vars['--accent']} vs positive ${vsPos} vs negative ${vsNeg}`,
      );
    }
  });
});

describe('luminance / contrast helpers', () => {
  it('computes WCAG 2.1 relative luminance', () => {
    expect(luminance('#000000')).toBeCloseTo(0, 3);
    expect(luminance('#ffffff')).toBeCloseTo(1, 3);
    expect(luminance('#e8a525')).toBeGreaterThan(0.4); // gold-ish
    expect(luminance('#e31837')).toBeLessThan(0.2); // KC red, darker than amber
  });

  it('contrast(a,a) === 1 and black/white maxes out', () => {
    expect(contrast('#123456', '#123456')).toBeCloseTo(1, 6);
    expect(contrast('#ffffff', '#000000')).toBeGreaterThan(20);
  });
});

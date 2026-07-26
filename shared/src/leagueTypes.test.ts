import { describe, it, expect } from 'vitest';
import { buildCode, parseCode, generateAllLeagueTypes, ALL_LEAGUE_TYPES } from './leagueTypes.js';

describe('leagueTypes', () => {
  describe('buildCode', () => {
    it('builds a valid code from components', () => {
      expect(buildCode('DYN', 'SF', 'PPR', 'TEP')).toBe('DYN_SF_PPR_TEP');
      expect(buildCode('RED', '1QB', 'HALF', 'STD')).toBe('RED_1QB_HALF_STD');
    });
  });

  describe('parseCode', () => {
    it('parses a valid code into components', () => {
      const result = parseCode('DYN_SF_PPR_TEP');
      expect(result).toEqual({
        code: 'DYN_SF_PPR_TEP',
        format: 'DYN',
        qb: 'SF',
        rec: 'PPR',
        tep: 'TEP',
      });
    });

    it('parses all valid codes correctly', () => {
      for (const lt of ALL_LEAGUE_TYPES) {
        const parsed = parseCode(lt.code);
        expect(parsed).toEqual(lt);
      }
    });

    it('returns null for invalid codes', () => {
      expect(parseCode('INVALID')).toBeNull();
      expect(parseCode('DYN_SF_PPR')).toBeNull(); // too few parts
      expect(parseCode('DYN_SF_PPR_TEP_EXTRA')).toBeNull(); // too many parts
      expect(parseCode('FOO_SF_PPR_TEP')).toBeNull(); // invalid format
      expect(parseCode('DYN_2QB_PPR_TEP')).toBeNull(); // invalid qb
      expect(parseCode('DYN_SF_FULL_TEP')).toBeNull(); // invalid rec
      expect(parseCode('DYN_SF_PPR_YES')).toBeNull(); // invalid tep
    });
  });

  describe('generateAllLeagueTypes', () => {
    it('produces exactly 24 league types', () => {
      const types = generateAllLeagueTypes();
      expect(types).toHaveLength(24);
    });

    it('produces unique codes', () => {
      const codes = ALL_LEAGUE_TYPES.map(lt => lt.code);
      expect(new Set(codes).size).toBe(24);
    });

    it('includes both formats', () => {
      const formats = new Set(ALL_LEAGUE_TYPES.map(lt => lt.format));
      expect(formats).toEqual(new Set(['DYN', 'RED']));
    });

    it('includes both QB settings', () => {
      const qbs = new Set(ALL_LEAGUE_TYPES.map(lt => lt.qb));
      expect(qbs).toEqual(new Set(['1QB', 'SF']));
    });

    it('includes all three rec scorings', () => {
      const recs = new Set(ALL_LEAGUE_TYPES.map(lt => lt.rec));
      expect(recs).toEqual(new Set(['PPR', 'HALF', 'ZERO']));
    });

    it('includes both TEP settings', () => {
      const teps = new Set(ALL_LEAGUE_TYPES.map(lt => lt.tep));
      expect(teps).toEqual(new Set(['TEP', 'STD']));
    });

    it('every code is round-trippable through parseCode', () => {
      for (const lt of ALL_LEAGUE_TYPES) {
        expect(parseCode(lt.code)).toEqual(lt);
      }
    });
  });
});

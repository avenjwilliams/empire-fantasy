import type { Format, QBSetting, RecScoring, TEPSetting, LeagueType } from './types.js';

const FORMATS: Format[] = ['DYN', 'RED'];
const QB_SETTINGS: QBSetting[] = ['1QB', 'SF'];
const REC_SCORINGS: RecScoring[] = ['PPR', 'HALF', 'ZERO'];
const TEP_SETTINGS: TEPSetting[] = ['TEP', 'STD'];

export function buildCode(format: Format, qb: QBSetting, rec: RecScoring, tep: TEPSetting): string {
  return `${format}_${qb}_${rec}_${tep}`;
}

export function parseCode(code: string): LeagueType | null {
  const parts = code.split('_');
  if (parts.length !== 4) return null;

  const [format, qb, rec, tep] = parts;

  if (!FORMATS.includes(format as Format)) return null;
  if (!QB_SETTINGS.includes(qb as QBSetting)) return null;
  if (!REC_SCORINGS.includes(rec as RecScoring)) return null;
  if (!TEP_SETTINGS.includes(tep as TEPSetting)) return null;

  return {
    code,
    format: format as Format,
    qb: qb as QBSetting,
    rec: rec as RecScoring,
    tep: tep as TEPSetting,
  };
}

export function formatLeagueLabel(code: string): string {
  const parsed = parseCode(code);
  if (!parsed) return code; // fallback: render raw code if parse fails

  const parts: string[] = [];

  // format
  parts.push(parsed.format === 'DYN' ? 'DYNASTY' : 'REDRAFT');

  // rec (PPR/HALF/ZERO)
  if (parsed.rec === 'PPR') parts.push('PPR');
  else if (parsed.rec === 'HALF') parts.push('.5 PPR');
  else if (parsed.rec === 'ZERO') parts.push('NON-PPR');

  // qb
  if (parsed.qb === 'SF') parts.push('SUPERFLEX');
  else parts.push('1QB');

  // tep (only if TEP)
  if (parsed.tep === 'TEP') parts.push('TE PREMIUM');

  return parts.join(', ');
}

export function generateAllLeagueTypes(): LeagueType[] {
  const types: LeagueType[] = [];
  for (const format of FORMATS) {
    for (const qb of QB_SETTINGS) {
      for (const rec of REC_SCORINGS) {
        for (const tep of TEP_SETTINGS) {
          types.push({
            code: buildCode(format, qb, rec, tep),
            format,
            qb,
            rec,
            tep,
          });
        }
      }
    }
  }
  return types;
}

export const ALL_LEAGUE_TYPES: LeagueType[] = generateAllLeagueTypes();

#!/usr/bin/env npx tsx
/**
 * Convert the 4 Sleeper ADP CSVs into seed-ranking format.
 *
 * Input format:  rank,Name+TEAM  (or with extra ADP columns)
 * Output format: rank,name,position,team
 *
 * Usage: npx tsx scripts/convert-adp-csvs.ts
 */

import fs from 'fs';
import path from 'path';

const PROJECT_ROOT = path.join(__dirname, '..');
const DATA_DIR = path.join(PROJECT_ROOT, 'data');
const SLEEPER_CACHE = path.join(DATA_DIR, 'raw', 'sleeper-players.json');
const OUTPUT_DIR = path.join(DATA_DIR, 'seed-rankings');

const TEAMS = new Set([
  'ARI','ATL','BAL','BUF','CAR','CHI','CIN','CLE','DAL','DEN','DET','GB',
  'HOU','IND','JAX','KC','LAC','LAR','LV','MIA','MIN','NE','NO','NYG',
  'NYJ','PHI','PIT','SEA','SF','TB','TEN','WSH','WAS',
]);

// Map WSH ↔ WAS (Washington changed abbreviation)
const TEAM_ALIAS: Record<string, string> = { WSH: 'WAS', WAS: 'WSH' };

const NAME_SUFFIXES = /\b(Jr\.?|Sr\.?|II|III|IV|V)\b/gi;

function normalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z ]/g, '').replace(NAME_SUFFIXES, '').replace(/\s+/g, ' ').trim();
}

interface CsvFile {
  inputPath: string;
  outputPath: string;
  label: string;
  hasHeader: boolean;
}

const CSV_FILES: CsvFile[] = [
  {
    inputPath: 'PPR Dynasty 1QB - Sheet1.csv',
    outputPath: 'DYN_1QB.csv',
    label: 'DYN_1QB',
    hasHeader: false,
  },
  {
    inputPath: 'Redraft 1QB - Sheet1.csv',
    outputPath: 'RED_1QB.csv',
    label: 'RED_1QB',
    hasHeader: false,
  },
  {
    inputPath: 'Half PPR Dynasty 2QB - Sheet1.csv',
    outputPath: 'DYN_SF.csv',
    label: 'DYN_SF',
    hasHeader: false,
  },
  {
    inputPath: 'Half PPR Redraft 2QB - Sheet1.csv',
    outputPath: 'RED_SF.csv',
    label: 'RED_SF',
    hasHeader: true,
  },
];

function splitNameTeam(raw: string): { name: string; team: string } | null {
  // Try matching team abbreviation at end (2-3 chars)
  for (const len of [3, 2]) {
    const candidate = raw.slice(-len);
    if (TEAMS.has(candidate)) {
      const name = raw.slice(0, -len).trim();
      if (name.length > 0) return { name, team: candidate };
    }
  }
  return null;
}

function main() {
  // Load Sleeper player data for position lookup
  if (!fs.existsSync(SLEEPER_CACHE)) {
    console.error('Sleeper cache not found. Run seed first or fetch from API.');
    process.exit(1);
  }
  const raw: Record<string, any> = JSON.parse(fs.readFileSync(SLEEPER_CACHE, 'utf-8'));

  // Build lookup: "normalized_name|team" -> position
  // Handles suffixes (Jr, III) and team aliases (WSH/WAS)
  const playerLookup = new Map<string, string>();
  for (const [, p] of Object.entries(raw)) {
    if (!p.full_name || !p.position || !p.team) continue;
    const normName = normalize(p.full_name);
    // Index under actual team
    playerLookup.set(`${normName}|${p.team}`, p.position);
    // Also index under alias (so WAS matches WSH and vice versa)
    const alias = TEAM_ALIAS[p.team];
    if (alias) playerLookup.set(`${normName}|${alias}`, p.position);
  }

  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  let totalPlayers = 0;
  let totalMatched = 0;
  let totalUnmatched = 0;

  for (const csv of CSV_FILES) {
    const inputPath = path.join(PROJECT_ROOT, csv.inputPath);
    const content = fs.readFileSync(inputPath, 'utf-8');
    const lines = content.trim().split('\n');

    const outputLines: string[] = ['rank,name,position,team'];
    const unmatched: string[] = [];
    let rank = 0;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;

      // Skip header row if present
      if (csv.hasHeader && i === 0) continue;

      // Parse: first field is rank (before first comma)
      const firstComma = line.indexOf(',');
      if (firstComma === -1) continue;

      const rankStr = line.slice(0, firstComma).trim();
      const r = parseInt(rankStr, 10);
      if (isNaN(r)) continue;

      // Rest is "NameTEAM" possibly with extra comma-separated columns
      const rest = line.slice(firstComma + 1).trim();
      // For Half PPR Redraft 2QB: "Josh AllenBUF,1.2,1.2,..."
      // For others: "Ja'Marr ChaseCIN" or "Ja'Marr ChaseCIN,1.5"
      const nameTeamRaw = rest.split(',')[0].trim();

      const split = splitNameTeam(nameTeamRaw);
      if (!split) {
        unmatched.push(`Rank ${r}: ${nameTeamRaw}`);
        continue;
      }

      // Look up position (try exact, then normalized, then with team alias)
      const normName = normalize(split.name);
      let position = playerLookup.get(`${normName}|${split.team}`);
      if (!position) {
        const alias = TEAM_ALIAS[split.team];
        if (alias) position = playerLookup.get(`${normName}|${alias}`);
      }

      if (!position) {
        unmatched.push(`Rank ${r}: ${split.name} (${split.team}) - position unknown`);
        continue;
      }

      rank++;
      outputLines.push(`${rank},${split.name},${position},${split.team}`);
      totalMatched++;
    }

    const outputPath = path.join(OUTPUT_DIR, csv.outputPath);
    fs.writeFileSync(outputPath, outputLines.join('\n') + '\n');

    console.log(`[${csv.label}] Wrote ${rank} players to ${csv.outputPath}`);
    if (unmatched.length > 0) {
      console.log(`  WARNING: ${unmatched.length} unmatched:`);
      unmatched.slice(0, 5).forEach(u => console.log(`    ${u}`));
      if (unmatched.length > 5) console.log(`    ... and ${unmatched.length - 5} more`);
    }
    totalPlayers += rank;
    totalUnmatched += unmatched.length;
  }

  console.log(`\nDone! ${totalMatched} players written, ${totalUnmatched} unmatched across all files.`);
}

main();

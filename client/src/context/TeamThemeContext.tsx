import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';
import { TEAMS, resolveTeam } from '../teamThemes.js';

interface TeamThemeState {
  /** raw ef_team value: null = never asked, 'NONE' = explicitly Classic/skipped,
   *  otherwise a team code. */
  team: string | null;
  setTeam: (code: string | null) => void;
  hasChosen: boolean;
}

const TeamThemeContext = createContext<TeamThemeState | null>(null);

export const TEAM_STORAGE_KEY = 'ef_team';

/** The CSS variables a team theme may set — the only ones that ever vary. */
const THEME_VARS = [
  '--bg',
  '--bg-raised',
  '--bg-hover',
  '--border',
  '--accent',
  '--accent-dim',
  '--accent-alt',
] as const;

/**
 * Apply (or clear) a team theme on document.documentElement via inline styles.
 * Pure side-effect function so it can be called at module scope in main.tsx
 * BEFORE React's first paint (avoids a flash of the default theme) and from
 * hover-preview without touching storage.
 * code === null | 'NONE' → clear everything, fall back to the :root defaults.
 */
export function applyTeamTheme(code: string | null): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  root.dataset.team = code ?? 'NONE';

  const team = code === null || code === 'NONE' ? null : TEAMS.find(t => t.code === code);
  if (!team) {
    for (const v of THEME_VARS) root.style.removeProperty(v);
    return;
  }
  const vars = resolveTeam(team);
  for (const [k, v] of Object.entries(vars)) {
    root.style.setProperty(k, v);
  }
}

function loadStoredTeam(): string | null {
  try {
    return localStorage.getItem(TEAM_STORAGE_KEY);
  } catch {
    return null;
  }
}

export function TeamThemeProvider({ children }: { children: React.ReactNode }) {
  // Read localStorage synchronously in the initializer (like LeagueTypeContext).
  const initial = loadStoredTeam();
  const [team, setTeamState] = useState<string | null>(initial);

  const setTeam = useCallback((code: string | null) => {
    // Store null as 'NONE' so "skipped" is distinguishable from "never asked":
    // once the picker is dismissed it must NEVER come back on a later load.
    setTeamState(code === null ? 'NONE' : code);
  }, []);

  // Write back + apply on change. Guard on null: a first visit must stay absent
  // in storage, otherwise the picker would be suppressed forever.
  useEffect(() => {
    if (team === null) return;
    try {
      localStorage.setItem(TEAM_STORAGE_KEY, team);
    } catch { /* storage unavailable — still applied for this session */ }
    applyTeamTheme(team);
  }, [team]);

  const value: TeamThemeState = {
    team,
    setTeam,
    hasChosen: team !== null, // 'NONE' and team codes both count as chosen
  };

  return <TeamThemeContext.Provider value={value}>{children}</TeamThemeContext.Provider>;
}

export function useTeamTheme(): TeamThemeState {
  const ctx = useContext(TeamThemeContext);
  if (!ctx) throw new Error('useTeamTheme must be inside TeamThemeProvider');
  return ctx;
}

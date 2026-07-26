import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import type { Format, QBSetting, RecScoring, TEPSetting } from '@empire-fantasy/shared';
import { buildCode } from '@empire-fantasy/shared';

interface LeagueTypeState {
  format: Format;
  qb: QBSetting;
  rec: RecScoring;
  tep: TEPSetting;
  code: string;
  setFormat: (v: Format) => void;
  setQb: (v: QBSetting) => void;
  setRec: (v: RecScoring) => void;
  setTep: (v: TEPSetting) => void;
}

const LeagueTypeContext = createContext<LeagueTypeState | null>(null);

const STORAGE_KEY = 'ef_league_type';

function loadFromStorage(): { format: Format; qb: QBSetting; rec: RecScoring; tep: TEPSetting } {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      return {
        format: parsed.format || 'DYN',
        qb: parsed.qb || 'SF',
        rec: parsed.rec || 'PPR',
        tep: parsed.tep || 'STD',
      };
    }
  } catch { /* ignore */ }
  return { format: 'DYN', qb: 'SF', rec: 'PPR', tep: 'STD' };
}

export function LeagueTypeProvider({ children }: { children: React.ReactNode }) {
  const initial = loadFromStorage();
  const [format, setFormat] = useState<Format>(initial.format);
  const [qb, setQb] = useState<QBSetting>(initial.qb);
  const [rec, setRec] = useState<RecScoring>(initial.rec);
  const [tep, setTep] = useState<TEPSetting>(initial.tep);

  const code = buildCode(format, qb, rec, tep);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ format, qb, rec, tep }));
  }, [format, qb, rec, tep]);

  const value: LeagueTypeState = {
    format, qb, rec, tep, code,
    setFormat: useCallback((v: Format) => setFormat(v), []),
    setQb: useCallback((v: QBSetting) => setQb(v), []),
    setRec: useCallback((v: RecScoring) => setRec(v), []),
    setTep: useCallback((v: TEPSetting) => setTep(v), []),
  };

  return (
    <LeagueTypeContext.Provider value={value}>
      {children}
    </LeagueTypeContext.Provider>
  );
}

export function useLeagueType(): LeagueTypeState {
  const ctx = useContext(LeagueTypeContext);
  if (!ctx) throw new Error('useLeagueType must be inside LeagueTypeProvider');
  return ctx;
}

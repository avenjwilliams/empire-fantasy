import { useState, useRef, useEffect } from 'react';
import { TEAMS } from '../teamThemes.js';
import { useTeamTheme } from '../context/TeamThemeContext.js';
import TeamGrid from './TeamGrid.js';

function currentSwatches(code: string | null) {
  const team = TEAMS.find(t => t.code === (code ?? 'NONE'));
  return team ? [team.primary, team.secondary, team.tertiary] : ['#e8a525', '#b07c15', '#0a0e14'];
}

/**
 * Persistent team-color selector in the top bar. Collapsed into a small button
 * showing the current code + swatches; opens the shared 33-tile grid. On desktop
 * it's a dropdown panel; below 768px it reuses the modal presentation because a
 * 33-item grid in a wrapping topbar would be unusable otherwise.
 */
export default function TeamSelector() {
  const { team, setTeam } = useTeamTheme();
  const [open, setOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(() =>
    typeof window !== 'undefined' && window.matchMedia('(max-width: 768px)').matches,
  );
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const mq = window.matchMedia('(max-width: 768px)');
    const onChange = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  // Close on outside click and on Escape.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const teamLabel = team === null || team === 'NONE' ? 'CLASSIC' : team;
  const swatches = currentSwatches(team);

  const handleSelect = (code: string) => {
    setTeam(code);
    setOpen(false);
  };

  return (
    <div className="team-selector" ref={rootRef}>
      <button
        type="button"
        className="team-selector__toggle"
        onClick={() => setOpen(o => !o)}
        aria-haspopup={isMobile ? 'dialog' : 'menu'}
        aria-expanded={open}
      >
        <span className="team-selector__swatches" aria-hidden="true">
          {swatches.map((c, i) => (
            <span key={i} className="team-swatch" style={{ background: c }} />
          ))}
        </span>
        <span className="team-selector__label">{teamLabel}</span>
      </button>

      {open && (
        isMobile ? (
          // Modal presentation on small screens (a 33-item dropdown is unusable).
          <div className="ktc-popup-overlay team-selector__overlay" onClick={() => setOpen(false)}>
            <div
              className="ktc-popup team-picker-popup"
              onClick={e => e.stopPropagation()}
              role="dialog"
              aria-modal="true"
              aria-label="Pick your team"
            >
              <button className="ktc-popup__close" onClick={() => setOpen(false)} aria-label="Close">
                ✕
              </button>
              <h2 className="ktc-popup__title">Pick your team</h2>
              <p className="ktc-popup__subtitle">Just changes the colors.</p>
              <TeamGrid currentCode={team} onSelect={handleSelect} />
            </div>
          </div>
        ) : (
          <div className="team-selector__dropdown">
            <div className="team-selector__dropdown-label">Pick your team</div>
            <TeamGrid currentCode={team} onSelect={handleSelect} />
          </div>
        )
      )}
    </div>
  );
}
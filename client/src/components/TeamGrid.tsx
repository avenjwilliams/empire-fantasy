import { TEAMS } from '../teamThemes.js';
import { useTeamTheme, applyTeamTheme } from '../context/TeamThemeContext.js';

interface TeamGridProps {
  /** Currently selected code (for the active-tile highlight). */
  currentCode: string | null;
  onSelect: (code: string) => void;
}

/**
 * The 33-tile team grid (32 teams + Classic), shared by the first-visit picker
 * and the persistent topbar selector. Hover / keyboard-focus live-previews the
 * theme via applyTeamTheme and reverts to the current selection on leave.
 * Committing happens only on click.
 */
export default function TeamGrid({ currentCode, onSelect }: TeamGridProps) {
  const { team } = useTeamTheme();

  const preview = (code: string) => applyTeamTheme(code);
  const revert = () => applyTeamTheme(team);

  return (
    <div className="team-grid">
      {TEAMS.map(t => (
        <button
          key={t.code}
          type="button"
          className={[
            'team-tile',
            t.code === currentCode ? 'team-tile--active' : '',
          ].filter(Boolean).join(' ')}
          onClick={() => onSelect(t.code)}
          onMouseEnter={() => preview(t.code)}
          onMouseLeave={revert}
          onFocus={() => preview(t.code)}
          onBlur={revert}
        >
          <span className="team-tile__code">{t.code === 'NONE' ? 'CLS' : t.code}</span>
          <span className="team-tile__name">{t.name}</span>
          <span className="team-tile__swatches" aria-hidden="true">
            <span className="team-swatch" style={{ background: t.primary }} />
            <span className="team-swatch" style={{ background: t.secondary }} />
            <span className="team-swatch" style={{ background: t.tertiary }} />
          </span>
        </button>
      ))}
    </div>
  );
}
import TeamGrid from './TeamGrid.js';

interface TeamPickerProps {
  onSelect: (code: string) => void;
}

/**
 * First-visit team picker. Reuses the .ktc-popup-overlay / .ktc-popup visual
 * language (same border, radius, backdrop, close affordance). Mounted in App.tsx
 * ONLY while hasChosen is false, so there is no internal visibility state.
 *
 * There is deliberately NO way to dismiss without recording a decision: the
 * overlay click, ✕, and Skip all write 'NONE' so the picker never reappears on
 * the next load (a dismiss that recorded nothing would re-show it forever).
 */
export default function TeamPicker({ onSelect }: TeamPickerProps) {
  const skip = () => onSelect('NONE');

  return (
    <div className="ktc-popup-overlay" onClick={skip}>
      <div
        className="ktc-popup team-picker-popup"
        onClick={e => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Pick your team"
      >
        <button className="ktc-popup__close" onClick={skip} aria-label="Skip">
          ✕
        </button>
        <h2 className="ktc-popup__title">Pick your team</h2>
        <p className="ktc-popup__subtitle">
          Just changes the colors. You can switch teams anytime from the top bar.
        </p>
        <TeamGrid currentCode={null} onSelect={onSelect} />
        <div className="team-picker__actions">
          <button type="button" className="ktc-btn ktc-btn--primary" onClick={skip}>
            Skip — keep Classic
          </button>
        </div>
      </div>
    </div>
  );
}
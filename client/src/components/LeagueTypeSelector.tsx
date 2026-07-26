import { useLeagueType } from '../context/LeagueTypeContext.js';
import type { Format, QBSetting, RecScoring, TEPSetting } from '@empire-fantasy/shared';

function SegmentGroup<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div className="lt-group">
      {options.map(opt => (
        <button
          key={opt.value}
          className={value === opt.value ? 'active' : ''}
          onClick={() => onChange(opt.value)}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

export default function LeagueTypeSelector() {
  const { format, qb, rec, tep, setFormat, setQb, setRec, setTep } = useLeagueType();

  return (
    <div className="lt-selector">
      <SegmentGroup<Format>
        options={[
          { value: 'DYN', label: 'DYN' },
          { value: 'RED', label: 'RED' },
        ]}
        value={format}
        onChange={setFormat}
      />
      <SegmentGroup<QBSetting>
        options={[
          { value: '1QB', label: '1QB' },
          { value: 'SF', label: 'SF' },
        ]}
        value={qb}
        onChange={setQb}
      />
      <SegmentGroup<RecScoring>
        options={[
          { value: 'PPR', label: 'PPR' },
          { value: 'HALF', label: '1/2' },
          { value: 'ZERO', label: '0' },
        ]}
        value={rec}
        onChange={setRec}
      />
      <SegmentGroup<TEPSetting>
        options={[
          { value: 'TEP', label: 'TEP' },
          { value: 'STD', label: 'STD' },
        ]}
        value={tep}
        onChange={setTep}
      />
    </div>
  );
}

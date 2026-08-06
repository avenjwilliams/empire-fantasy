import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useLeagueType } from '../context/LeagueTypeContext.js';
import ValueChart from '../components/ValueChart.js';
import { formatLeagueLabel } from '@empire-fantasy/shared';

interface ValueEntry {
  leagueType: string;
  format: string;
  qb: string;
  rec: string;
  tep: string;
  value: number;
}

interface LogEntry {
  id: number;
  old_value: number;
  new_value: number;
  delta: number;
  reason: string;
  detail: string | null;
  created_at: string;
  leagueType: string;
}

interface AssetDetail {
  asset_id: number;
  kind: string;
  name: string;
  position: string;
  team: string | null;
  age: number | null;
  status: string | null;
  boom_pct: number | null;
  bust_pct: number | null;
  overallRank: number | null;
  positionalRank: number | null;
  positionalLabel: string | null;
  values: ValueEntry[];
  history: { date: string; value: number; leagueType: string }[];
  logs: LogEntry[];
}

interface RingProps {
  pct: number | null;
  color: string;
  label: string;
}

const CIRCUMFERENCE = 213.6; // circumference of the r=34 ring used by the donut gauges

function Ring({ pct, color, label }: RingProps) {
  const frac = pct !== null ? Math.max(0, Math.min(100, pct)) / 100 : 0;
  const arcLen = frac * CIRCUMFERENCE;
  const gap = CIRCUMFERENCE - arcLen;

  return (
    <div className="ring">
      <svg viewBox="0 0 86 86">
        <circle className="ring__track" cx="43" cy="43" r="34" strokeWidth="9" fill="none" />
        {pct !== null && (
          <circle
            cx="43"
            cy="43"
            r="34"
            strokeWidth="9"
            fill="none"
            stroke={color}
            strokeDasharray={`${arcLen.toFixed(1)} ${gap.toFixed(1)}`}
            transform="rotate(-90 43 43)"
          />
        )}
      </svg>
      <div className="ring__pct" style={{ color: pct !== null ? color : 'var(--ink-muted)' }}>
        {pct !== null ? `${pct}%` : '—'}
      </div>
      <div className="ring__label">{label}</div>
    </div>
  );
}

interface RangeOption {
  label: string;
  days: number | null;
}

const RANGE_OPTIONS: RangeOption[] = [
  { label: '30D', days: 30 },
  { label: '90D', days: 90 },
  { label: 'ALL', days: null },
];

export default function PlayerDetail() {
  const { assetId } = useParams();
  const navigate = useNavigate();
  const { code } = useLeagueType();
  const [data, setData] = useState<AssetDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [showFormats, setShowFormats] = useState(false);
  const [showLogs, setShowLogs] = useState(false);
  const [rangeDays, setRangeDays] = useState<number | null>(null);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/assets/${assetId}?leagueType=${code}`)
      .then(r => {
        if (!r.ok) throw new Error('Not found');
        return r.json();
      })
      .then(d => { setData(d); setLoading(false); })
      .catch(() => { setData(null); setLoading(false); });
  }, [assetId, code]);

  if (loading) return <div className="page"><p className="text-muted">Loading...</p></div>;
  if (!data) return <div className="page"><div className="empty-state">Asset not found.</div></div>;

  const currentValue = data.values.find(v => v.leagueType === code);
  const isPick = data.kind === 'pick';

  return (
    <div className="page">
      <button className="back-link" onClick={() => navigate(-1)}>
        &larr; Back
      </button>

      {/* Identity row */}
      <div className="detail-header">
        <span className={`pos-badge pos-badge--${data.position}`}>{data.position}</span>
        <span className="detail-header__name">{data.name}</span>
        <span className="detail-header__meta">
          {data.team || 'FA'} {data.age ? `· ${data.age} yrs` : ''}
          {data.status && data.status !== 'active' ? ` · ${data.status.toUpperCase()}` : ''}
        </span>
        {data.positionalLabel !== null && (
          <div className="rank-badge rank-badge--pos">
            <span className="rank-badge__label">POS</span>
            <span className="rank-badge__value">{data.positionalLabel}</span>
          </div>
        )}
        {data.overallRank !== null && (
          <div className="rank-badge rank-badge--ovr">
            <span className="rank-badge__label">OVR</span>
            <span className="rank-badge__value">#{data.overallRank}</span>
          </div>
        )}
      </div>

      {/* Hero row: value + rings (players) / value alone (picks) */}
      {currentValue && (
        <div className="player-hero">
          <div>
            <div className="player-hero__value">{currentValue.value.toFixed(1)}</div>
            <div className="player-hero__label">{formatLeagueLabel(code)}</div>
          </div>
          {!isPick && (
            <div className="player-hero__rings">
              <Ring pct={data.boom_pct} color="var(--positive)" label="BOOM" />
              <Ring pct={data.bust_pct} color="var(--negative)" label="BUST" />
            </div>
          )}
        </div>
      )}
      {!isPick && (
        <p className="text-muted player-hero__disclaimer">
          Placeholder ratings — derived from random seed. Real computation deferred.
        </p>
      )}

      {/* Value across all league types — behind a disclosure */}
      {data.values.length > 0 && (
        <div className="disclosure">
          <button className="disclosure__toggle" onClick={() => setShowFormats(s => !s)}>
            Show all 24 formats
          </button>
          {showFormats && (
            <div className="disclosure__body">
              <div className="value-grid">
                {data.values.map(v => (
                  <div
                    key={v.leagueType}
                    className="value-card"
                    style={v.leagueType === code ? { borderColor: 'var(--accent)' } : {}}
                  >
                    <span className="value-card__code">{formatLeagueLabel(v.leagueType)}</span>
                    <span className="value-card__value">{v.value.toFixed(1)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Value History Chart */}
      <h2 className="page__title page__title--sm">Value History</h2>
      <div className="chart-range">
        {RANGE_OPTIONS.map(opt => (
          <button
            key={opt.label}
            className={`chart-range__opt${rangeDays === opt.days ? ' chart-range__opt--active' : ''}`}
            onClick={() => setRangeDays(opt.days)}
          >
            {opt.label}
          </button>
        ))}
      </div>
      <ValueChart history={data.history} leagueType={code} rangeDays={rangeDays} />

      {/* Recent adjustment log — behind a disclosure */}
      <div className="disclosure">
        <button className="disclosure__toggle" onClick={() => setShowLogs(s => !s)}>
          Recent adjustments ({data.logs.length})
        </button>
        {showLogs && (
          <div className="disclosure__body">
            {data.logs.length === 0 ? (
              <div className="empty-state">No adjustments recorded yet.</div>
            ) : (
              <div className="table-scroll">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Time</th>
                      <th>League Type</th>
                      <th>Reason</th>
                      <th style={{ textAlign: 'right' }}>Old</th>
                      <th style={{ textAlign: 'right' }}>New</th>
                      <th style={{ textAlign: 'right' }}>Delta</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.logs.slice(0, 20).map(log => (
                      <tr key={log.id} style={{ cursor: 'default' }}>
                        <td className="text-muted" style={{ fontSize: '0.75rem' }}>
                          {log.created_at}
                        </td>
                        <td style={{ fontSize: '0.75rem' }}>{formatLeagueLabel(log.leagueType)}</td>
                        <td>
                          <span className={`reason-chip reason-chip--${log.reason}`}>
                            {log.reason}
                          </span>
                        </td>
                        <td style={{ textAlign: 'right', fontFamily: 'var(--font-mono)' }}>
                          {log.old_value.toFixed(1)}
                        </td>
                        <td style={{ textAlign: 'right', fontFamily: 'var(--font-mono)' }}>
                          {log.new_value.toFixed(1)}
                        </td>
                        <td
                          style={{ textAlign: 'right', fontFamily: 'var(--font-mono)' }}
                          className={log.delta > 0 ? 'delta--pos' : log.delta < 0 ? 'delta--neg' : 'delta--zero'}
                        >
                          {log.delta > 0 ? '+' : ''}{log.delta.toFixed(1)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
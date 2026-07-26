import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useLeagueType } from '../context/LeagueTypeContext.js';
import ValueChart from '../components/ValueChart.js';

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
  values: ValueEntry[];
  history: { date: string; value: number; leagueType: string }[];
  logs: LogEntry[];
}

export default function PlayerDetail() {
  const { assetId } = useParams();
  const navigate = useNavigate();
  const { code } = useLeagueType();
  const [data, setData] = useState<AssetDetail | null>(null);
  const [loading, setLoading] = useState(true);

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

  return (
    <div className="page">
      <button
        onClick={() => navigate(-1)}
        style={{
          background: 'none', border: 'none', color: 'var(--accent)',
          cursor: 'pointer', fontFamily: 'var(--font-mono)', fontSize: '0.85rem',
          marginBottom: '1rem', padding: 0,
        }}
      >
        &larr; Back
      </button>

      <div className="detail-header">
        <span className={`pos-badge pos-badge--${data.position}`}>{data.position}</span>
        <span className="detail-header__name">{data.name}</span>
        <span className="detail-header__meta">
          {data.team || 'FA'} {data.age ? `· ${data.age} yrs` : ''}
          {data.status && data.status !== 'active' ? ` · ${data.status.toUpperCase()}` : ''}
        </span>
        {currentValue && (
          <span style={{ marginLeft: 'auto', fontSize: '1.5rem', fontWeight: 700, color: 'var(--accent)', fontFamily: 'var(--font-mono)' }}>
            {currentValue.value.toFixed(1)}
          </span>
        )}
      </div>

      {/* 24-set value grid */}
      <h2 className="page__title" style={{ fontSize: '0.9rem' }}>Value Across All League Types</h2>
      <div className="value-grid">
        {data.values.map(v => (
          <div
            key={v.leagueType}
            className="value-card"
            style={v.leagueType === code ? { borderColor: 'var(--accent)' } : {}}
          >
            <span className="value-card__code">{v.leagueType}</span>
            <span className="value-card__value">{v.value.toFixed(1)}</span>
          </div>
        ))}
      </div>

      {/* Value History Chart */}
      <h2 className="page__title" style={{ fontSize: '0.9rem' }}>Value History</h2>
      <ValueChart history={data.history} leagueType={code} />

      {/* Recent log entries */}
      <h2 className="page__title" style={{ fontSize: '0.9rem' }}>Recent Adjustments</h2>
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
                <td style={{ fontSize: '0.75rem' }}>{log.leagueType}</td>
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
  );
}

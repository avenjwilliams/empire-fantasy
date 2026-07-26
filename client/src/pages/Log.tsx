import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLeagueType } from '../context/LeagueTypeContext.js';

interface LogRow {
  id: number;
  asset_id: number;
  old_value: number;
  new_value: number;
  delta: number;
  reason: string;
  detail: string | null;
  created_at: string;
  leagueType: string;
  assetName: string;
  position: string;
}

const REASONS = ['all', 'seed', 'vote', 'stat', 'manual', 'decay'];
const PAGE_SIZE = 50;

export default function Log() {
  const { code } = useLeagueType();
  const navigate = useNavigate();
  const [rows, setRows] = useState<LogRow[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [reasonFilter, setReasonFilter] = useState('all');
  const [assetSearch, setAssetSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    const params = new URLSearchParams({
      leagueType: code,
      limit: String(PAGE_SIZE),
      offset: String(offset),
    });
    if (reasonFilter !== 'all') params.set('reason', reasonFilter);

    fetch(`/api/log?${params}`)
      .then(r => {
        if (!r.ok) throw new Error('Failed to load log');
        return r.json();
      })
      .then(data => {
        setRows(data.rows);
        setTotal(data.total);
        setLoading(false);
        setError(null);
      })
      .catch(() => {
        setRows([]);
        setTotal(0);
        setLoading(false);
        setError('Failed to load adjustment log. Is the server running?');
      });
  }, [code, reasonFilter, offset]);

  // Reset offset on filter change
  useEffect(() => { setOffset(0); }, [code, reasonFilter]);

  const filtered = assetSearch
    ? rows.filter(r => r.assetName?.toLowerCase().includes(assetSearch.toLowerCase()))
    : rows;

  const pageCount = Math.ceil(total / PAGE_SIZE);
  const currentPage = Math.floor(offset / PAGE_SIZE) + 1;

  return (
    <div className="page">
      <h1 className="page__title">Adjustment Log</h1>

      <div className="filters">
        <div className="filter-tabs">
          {REASONS.map(r => (
            <button
              key={r}
              className={reasonFilter === r ? 'active' : ''}
              onClick={() => setReasonFilter(r)}
            >
              {r}
            </button>
          ))}
        </div>
        <input
          className="search-input"
          type="text"
          placeholder="Filter by name..."
          value={assetSearch}
          onChange={e => setAssetSearch(e.target.value)}
        />
        <span className="text-muted" style={{ fontSize: '0.8rem' }}>{code}</span>
      </div>

      {loading ? (
        <p className="text-muted">Loading...</p>
      ) : error ? (
        <div className="empty-state">{error}</div>
      ) : filtered.length === 0 ? (
        <div className="empty-state">
          {assetSearch ? `No log entries matching "${assetSearch}"` : 'No adjustment log entries found.'}
        </div>
      ) : (
        <>
          <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>Time</th>
                <th>Asset</th>
                <th>Pos</th>
                <th>Reason</th>
                <th style={{ textAlign: 'right' }}>Old</th>
                <th style={{ textAlign: 'right' }}>New</th>
                <th style={{ textAlign: 'right' }}>Delta</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(row => (
                <tr
                  key={row.id}
                  onClick={() => navigate(`/player/${row.asset_id}`)}
                >
                  <td className="text-muted" style={{ fontSize: '0.75rem' }}>
                    {row.created_at}
                  </td>
                  <td>{row.assetName}</td>
                  <td>
                    <span className={`pos-badge pos-badge--${row.position}`}>
                      {row.position}
                    </span>
                  </td>
                  <td>
                    <span className={`reason-chip reason-chip--${row.reason}`}>
                      {row.reason}
                    </span>
                  </td>
                  <td style={{ textAlign: 'right', fontFamily: 'var(--font-mono)' }}>
                    {row.old_value.toFixed(1)}
                  </td>
                  <td style={{ textAlign: 'right', fontFamily: 'var(--font-mono)' }}>
                    {row.new_value.toFixed(1)}
                  </td>
                  <td
                    style={{ textAlign: 'right', fontFamily: 'var(--font-mono)' }}
                    className={row.delta > 0 ? 'delta--pos' : row.delta < 0 ? 'delta--neg' : 'delta--zero'}
                  >
                    {row.delta > 0 ? '+' : ''}{row.delta.toFixed(1)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>

          <div className="pagination">
            <button disabled={offset === 0} onClick={() => setOffset(o => o - PAGE_SIZE)}>
              Prev
            </button>
            <span className="pagination__info">
              Page {currentPage} of {pageCount || 1} ({total} entries)
            </span>
            <button disabled={offset + PAGE_SIZE >= total} onClick={() => setOffset(o => o + PAGE_SIZE)}>
              Next
            </button>
          </div>
        </>
      )}
    </div>
  );
}

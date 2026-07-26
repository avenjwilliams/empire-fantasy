import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLeagueType } from '../context/LeagueTypeContext.js';

interface RankingRow {
  asset_id: number;
  kind: string;
  name: string;
  position: string;
  team: string | null;
  age: number | null;
  value: number;
  overallRank: number;
  positionalRank: number;
  positionalLabel: string;
}

const POSITION_TABS = ['ALL', 'QB', 'RB', 'WR', 'TE'];

export default function Rankings() {
  const { code, format } = useLeagueType();
  const navigate = useNavigate();
  const [rows, setRows] = useState<RankingRow[]>([]);
  const [posFilter, setPosFilter] = useState('ALL');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const tabs = format === 'DYN' ? [...POSITION_TABS, 'PICKS'] : POSITION_TABS;

  useEffect(() => {
    setLoading(true);
    const params = new URLSearchParams({ leagueType: code });
    if (posFilter !== 'ALL') params.set('position', posFilter);

    fetch(`/api/rankings?${params}`)
      .then(r => {
        if (!r.ok) throw new Error('Failed to load rankings');
        return r.json();
      })
      .then(data => {
        setRows(data);
        setLoading(false);
        setError(null);
      })
      .catch(() => {
        setRows([]);
        setLoading(false);
        setError('Failed to load rankings. Is the server running?');
      });
  }, [code, posFilter]);

  const filtered = search
    ? rows.filter(r => r.name.toLowerCase().includes(search.toLowerCase()))
    : rows;

  return (
    <div className="page">
      <h1 className="page__title">Rankings</h1>
      <div className="filters">
        <div className="filter-tabs">
          {tabs.map(tab => (
            <button
              key={tab}
              className={posFilter === tab ? 'active' : ''}
              onClick={() => setPosFilter(tab)}
            >
              {tab}
            </button>
          ))}
        </div>
        <input
          className="search-input"
          type="text"
          placeholder="Search players..."
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        <span className="text-muted" style={{ fontSize: '0.8rem' }}>{code}</span>
      </div>

      {loading ? (
        <p className="text-muted">Loading...</p>
      ) : error ? (
        <div className="empty-state">{error}</div>
      ) : filtered.length === 0 ? (
        <div className="empty-state">
          {search ? `No players matching "${search}"` : 'No rankings found for this league type.'}
        </div>
      ) : (
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th className="col-rank">#</th>
                <th className="col-pos-rank">Pos</th>
                <th>Name</th>
                <th className="col-pos">Pos</th>
                <th>Team</th>
                <th>Age</th>
                <th className="col-value">Value</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(row => (
                <tr
                  key={row.asset_id}
                  onClick={() => navigate(`/player/${row.asset_id}`)}
                >
                  <td className="col-rank">{row.overallRank}</td>
                  <td className="col-pos-rank">{row.positionalLabel}</td>
                  <td>{row.name}</td>
                  <td className="col-pos">
                    <span className={`pos-badge pos-badge--${row.position}`}>
                      {row.position}
                    </span>
                  </td>
                  <td>{row.team || '—'}</td>
                  <td>{row.age ?? '—'}</td>
                  <td className="col-value">{row.value.toFixed(1)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

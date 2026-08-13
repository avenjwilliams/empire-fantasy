import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLeagueType } from '../context/LeagueTypeContext.js';

interface RankingRow {
  asset_id: number;
  kind: string;
  name: string;
  position: string;
  team: string | null;
  age: number | null;
  volatility_pct: number | null;
  value: number;
  overallRank: number;
  positionalRank: number;
  positionalLabel: string;
}

type SortableColumn = 'value' | 'volatility_pct' | 'age';
type SortDirection = 'desc' | 'asc' | 'none';

const POSITION_TABS = ['ALL', 'QB', 'RB', 'WR', 'TE'];

const SORTABLE_COLUMNS: { key: SortableColumn; label: string }[] = [
  { key: 'value', label: 'Value' },
  { key: 'volatility_pct', label: 'Volatility' },
  { key: 'age', label: 'Age' },
];

function getSortIndicator(direction: SortDirection): string {
  if (direction === 'desc') return '▼';
  if (direction === 'asc') return '▲';
  return '';
}

function getAriaSort(direction: SortDirection): 'ascending' | 'descending' | 'none' {
  if (direction === 'desc') return 'descending';
  if (direction === 'asc') return 'ascending';
  return 'none';
}

function compareRows(a: RankingRow, b: RankingRow, column: SortableColumn, direction: 'desc' | 'asc'): number {
  const aVal = a[column];
  const bVal = b[column];

  // Nulls sort to bottom in both directions
  const aIsNull = aVal === null || aVal === undefined;
  const bIsNull = bVal === null || bVal === undefined;

  if (aIsNull && bIsNull) return 0;
  if (aIsNull) return 1;  // nulls last
  if (bIsNull) return -1; // nulls last

  // Both are non-null numbers
  const cmp = aVal - bVal;
  if (cmp !== 0) return direction === 'desc' ? -cmp : cmp;

  // Tie-break by overallRank ascending for stability
  return a.overallRank - b.overallRank;
}

export default function Rankings() {
  const { code, format } = useLeagueType();
  const navigate = useNavigate();
  const [rows, setRows] = useState<RankingRow[]>([]);
  const [posFilter, setPosFilter] = useState('ALL');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sortColumn, setSortColumn] = useState<SortableColumn | null>(null);
  const [sortDirection, setSortDirection] = useState<SortDirection>('none');

  const tabs = format === 'DYN' ? [...POSITION_TABS, 'PICKS'] : POSITION_TABS;

  useEffect(() => {
    const handler = () => {
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
          // Reset sort when league type or position tab changes
          setSortColumn(null);
          setSortDirection('none');
        })
        .catch(() => {
          setRows([]);
          setLoading(false);
          setError('Failed to load rankings. Is the server running?');
        });
    };

    handler();

    window.addEventListener('empire-refresh', handler);
    return () => window.removeEventListener('empire-refresh', handler);
  }, [code, posFilter]);

  // Handle sort cycling: none -> desc -> asc -> none
  const handleSort = (column: SortableColumn) => {
    if (sortColumn === column) {
      if (sortDirection === 'desc') {
        setSortDirection('asc');
      } else if (sortDirection === 'asc') {
        setSortColumn(null);
        setSortDirection('none');
      } else {
        setSortDirection('desc');
      }
    } else {
      setSortColumn(column);
      setSortDirection('desc');
    }
  };

  // Reset sort when search changes? No - spec says sorting and filtering compose,
  // only reset on position tab or league type change (handled in useEffect above)

  const filtered = search
    ? rows.filter(r => r.name.toLowerCase().includes(search.toLowerCase()))
    : rows;

  const sortedRows = useMemo(() => {
    if (!sortColumn || sortDirection === 'none') return filtered;
    return [...filtered].sort((a, b) => compareRows(a, b, sortColumn, sortDirection));
  }, [filtered, sortColumn, sortDirection]);

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
      ) : sortedRows.length === 0 ? (
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
                <th className="col-volatility">VOL</th>
                <th className="col-value">Value</th>
              </tr>
              <tr>
                {/*
                  Sortable header row - we put buttons inside th for accessibility.
                  The sticky header is on the thead, so this second row needs to be included.
                */}
                <th className="col-rank" aria-sort="none"></th>
                <th className="col-pos-rank" aria-sort="none"></th>
                <th aria-sort="none"></th>
                <th className="col-pos" aria-sort="none"></th>
                <th aria-sort="none"></th>
                <th>
                  <button
                    className="sortable-header"
                    onClick={() => handleSort('age')}
                    aria-sort={getAriaSort(sortColumn === 'age' ? sortDirection : 'none')}
                    aria-label="Sort by Age"
                  >
                    {sortColumn === 'age' ? getSortIndicator(sortDirection) : ''}
                  </button>
                </th>
                <th>
                  <button
                    className="sortable-header"
                    onClick={() => handleSort('volatility_pct')}
                    aria-sort={getAriaSort(sortColumn === 'volatility_pct' ? sortDirection : 'none')}
                    aria-label="Sort by Volatility"
                  >
                    {sortColumn === 'volatility_pct' ? getSortIndicator(sortDirection) : ''}
                  </button>
                </th>
                <th>
                  <button
                    className="sortable-header"
                    onClick={() => handleSort('value')}
                    aria-sort={getAriaSort(sortColumn === 'value' ? sortDirection : 'none')}
                    aria-label="Sort by Value"
                  >
                    {sortColumn === 'value' ? getSortIndicator(sortDirection) : ''}
                  </button>
                </th>
              </tr>
            </thead>
            <tbody>
              {sortedRows.map(row => (
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
                  <td className="col-volatility">{row.volatility_pct !== null ? `${row.volatility_pct}%` : '—'}</td>
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
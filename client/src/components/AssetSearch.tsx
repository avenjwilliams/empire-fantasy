import { useState, useEffect, useRef } from 'react';
import { useLeagueType } from '../context/LeagueTypeContext.js';
import { useDebounce } from '../hooks/useDebounce.js';

interface SearchResult {
  asset_id: number;
  kind: string;
  name: string;
  position: string;
  team: string | null;
  age: number | null;
  value: number;
}

interface AssetSearchProps {
  onSelect: (asset: SearchResult) => void;
  excludeIds: Set<number>;
}

export default function AssetSearch({ onSelect, excludeIds }: AssetSearchProps) {
  const { code } = useLeagueType();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [open, setOpen] = useState(false);
  const debouncedQuery = useDebounce(query, 200);
  const wrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (debouncedQuery.length < 2) {
      setResults([]);
      return;
    }
    fetch(`/api/assets/search?q=${encodeURIComponent(debouncedQuery)}&leagueType=${code}`)
      .then(r => r.json())
      .then(data => {
        setResults(data.filter((r: SearchResult) => !excludeIds.has(r.asset_id)));
        setOpen(true);
      });
  }, [debouncedQuery, code, excludeIds]);

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const handleSelect = (asset: SearchResult) => {
    onSelect(asset);
    setQuery('');
    setResults([]);
    setOpen(false);
  };

  return (
    <div ref={wrapperRef} style={{ position: 'relative' }}>
      <input
        className="search-input"
        style={{ width: '100%' }}
        type="text"
        placeholder="Search players..."
        value={query}
        onChange={e => setQuery(e.target.value)}
        onFocus={() => results.length > 0 && setOpen(true)}
      />
      {open && results.length > 0 && (
        <div className="search-dropdown">
          {results.map(r => (
            <div
              key={r.asset_id}
              className="search-dropdown__item"
              onClick={() => handleSelect(r)}
            >
              <span className={`pos-badge pos-badge--${r.position}`}>{r.position}</span>
              <span className="search-dropdown__name">{r.name}</span>
              <span className="search-dropdown__meta">
                {r.team || ''}{r.age ? ` · ${r.age}` : ''}
              </span>
              <span className="search-dropdown__value">{r.value.toFixed(1)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

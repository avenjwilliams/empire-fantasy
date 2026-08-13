import { useState, useEffect, useMemo, useRef } from 'react';
import { useLeagueType } from '../context/LeagueTypeContext.js';
import AssetSearch from '../components/AssetSearch.js';
import TradeScale from '../components/TradeScale.js';
import { getWeight, computeTradeSuggestions, type TradeSuggestion, type SideVolatility } from '@empire-fantasy/shared';

interface SelectedAsset {
  asset_id: number;
  name: string;
  position: string;
  team: string | null;
  /** Value per league type (all 24), fetched from GET /api/assets/:id at add time. */
  valuesByLeagueType: Record<string, number>;
}

interface TradeAsset {
  id: number;
  name: string;
  value: number;
  trueValue: number;
  weight: number;
}

interface TradeSide {
  assets: TradeAsset[];
  sideValue: number;
  rawSum: number;
  adjustment: number;
}

interface TradeResult {
  leagueType: string;
  team1: TradeSide;
  team2: TradeSide;
  scale: number;
  verdict: string;
  differencePct: number;
  adviceGap: number | null;
  valueAdjustment: number | null;
  valueAdjustmentSide: 1 | 2 | null;
  suggestions: TradeSuggestion[];
  volatility: {
    team1: SideVolatility;
    team2: SideVolatility;
  };
}

export default function Calculator() {
  const { code } = useLeagueType();
  const [team1, setTeam1] = useState<SelectedAsset[]>([]);
  const [team2, setTeam2] = useState<SelectedAsset[]>([]);
  const [result, setResult] = useState<TradeResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showMath, setShowMath] = useState(false);
  const [pickNotice, setPickNotice] = useState<string | null>(null);

  // Keep readable snapshots of the teams for the redraft-removal effect without
  // needing team1/team2 in its dependency array.
  const team1Ref = useRef<SelectedAsset[]>(team1);
  const team2Ref = useRef<SelectedAsset[]>(team2);
  team1Ref.current = team1;
  team2Ref.current = team2;

  const allIds = useMemo(() => {
    const set = new Set<number>();
    team1.forEach(a => set.add(a.asset_id));
    team2.forEach(a => set.add(a.asset_id));
    return set;
  }, [team1, team2]);

  // When the league type becomes a Redraft, drop any dynasty picks from both sides.
  // Picks have no Redraft value and POST /api/trade/evaluate 400s on them. This effect
  // runs before the (debounced) evaluate effect fires, so the 400 never occurs.
  useEffect(() => {
    if (!code.startsWith('RED')) return;
    const removed1 = team1Ref.current.filter(a => a.position === 'PICK').length;
    const removed2 = team2Ref.current.filter(a => a.position === 'PICK').length;
    const removed = removed1 + removed2;
    if (removed === 0) return;
    setTeam1(prev => prev.filter(a => a.position !== 'PICK'));
    setTeam2(prev => prev.filter(a => a.position !== 'PICK'));
    setPickNotice(`Removed ${removed} pick(s) — picks aren't tradeable in Redraft.`);
  }, [code]);

  // Auto-evaluate on change (debounced)
  useEffect(() => {
    if (team1.length === 0 || team2.length === 0) {
      setResult(null);
      setError(null);
      return;
    }

    const timer = setTimeout(() => {
      fetch('/api/trade/evaluate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          leagueType: code,
          team1: team1.map(a => a.asset_id),
          team2: team2.map(a => a.asset_id),
        }),
      })
        .then(r => {
          if (!r.ok) return r.json().then(d => { throw new Error(d.error); });
          return r.json();
        })
        .then(data => { setResult(data); setError(null); })
        .catch(e => { setError(e.message); setResult(null); });
    }, 300);

    return () => clearTimeout(timer);
  }, [team1, team2, code]);

  const addToTeam = (team: 1 | 2) => async (asset: any) => {
    // Seed the chip immediately with the value AssetSearch already provided, so the
    // UI doesn't wait on a network round trip. The whole league-type map replaces it
    // when the detail fetch resolves.
    const entry: SelectedAsset = {
      asset_id: asset.asset_id,
      name: asset.name,
      position: asset.position,
      team: asset.team,
      valuesByLeagueType: { [code]: asset.value },
    };

    if (team === 1) setTeam1(prev => [...prev, entry]);
    else setTeam2(prev => [...prev, entry]);

    // Fetch the asset's value in every league type once, at add time. Chips then read
    // the current `code` out of the map, so switching league types is an instant lookup.
    let map: Record<string, number> | null = null;
    try {
      const res = await fetch(`/api/assets/${asset.asset_id}?leagueType=${code}`);
      if (res.ok) {
        const data = await res.json();
        if (data && Array.isArray(data.values)) {
          map = {};
          for (const v of data.values) map[v.leagueType] = v.value;
        }
      }
    } catch {
      map = null;
    }

    // Apply the resolved map with the functional form, matching by asset_id so an in-flight
    // resolve never drops an asset added while the fetch was pending. On error, keep the
    // seeded single entry (the chip shows '—' for any other league type, which is honest).
    if (map) {
      const patch = (prev: SelectedAsset[]) =>
        prev.map(a => (a.asset_id === entry.asset_id ? { ...a, valuesByLeagueType: map! } : a));
      if (team === 1) setTeam1(prev => patch(prev));
      else setTeam2(prev => patch(prev));
    }
  };

  const removeFromTeam = (team: 1 | 2, assetId: number) => {
    if (team === 1) setTeam1(prev => prev.filter(a => a.asset_id !== assetId));
    else setTeam2(prev => prev.filter(a => a.asset_id !== assetId));
  };

  return (
    <div className="page">
      <h1 className="page__title">Trade Calculator</h1>

      {pickNotice && (
        <div className="calc-notice" role="status">
          <span>{pickNotice}</span>
          <button className="calc-notice__dismiss" onClick={() => setPickNotice(null)} aria-label="Dismiss">
            ✕
          </button>
        </div>
      )}

      <div className="calc-grid">
        {/* Team 1 */}
        <div className="calc-team">
          <div className="calc-team__header">
            <span className="calc-team__title">Team 1</span>
            {result && (
              <span className="calc-team__total">{result.team1.sideValue.toFixed(1)}</span>
            )}
          </div>
          <AssetSearch onSelect={addToTeam(1)} excludeIds={allIds} />
          <div className="calc-team__assets">
            {team1.map(a => (
              <div key={a.asset_id} className="asset-chip">
                <span className={`pos-badge pos-badge--${a.position}`}>{a.position}</span>
                <span className="asset-chip__name">{a.name}</span>
                <span className={`asset-chip__value${a.valuesByLeagueType[code] === undefined ? ' asset-chip__value--muted' : ''}`}>
                  {a.valuesByLeagueType[code] !== undefined ? a.valuesByLeagueType[code].toFixed(1) : '—'}
                </span>
                <button
                  className="asset-chip__remove"
                  onClick={() => removeFromTeam(1, a.asset_id)}
                >
                  ✕
                </button>
              </div>
            ))}
            {team1.length === 0 && (
              <p className="text-muted" style={{ padding: '0.75rem', fontSize: '0.8rem' }}>
                Search and add players above
              </p>
            )}
          </div>
          
          {/* Value Adjustment row for Team 1 */}
          {result && result.team1.adjustment > 0 && (
            <div className="calc-team__adjustment">
              <span className="adjustment-chip">
                <span className="adjustment-chip__label">Value Adjustment</span>
                <span className="adjustment-chip__value">+{result.team1.adjustment.toFixed(1)}</span>
              </span>
              <button className="adjustment-disclosure" onClick={(e) => { e.stopPropagation(); setShowMath(true); }}>
                More on value adjustment
              </button>
              <div className="adjustment-disclosure__panel">
                <p>
                  Trading is more than simple addition. We add value to the side of the trade that's giving up 
                  more when you look at roster spots, players' "stud" factor, and so on. This counters trade math 
                  that says twelve third-round picks are a fair deal for one elite player.
                </p>
                <p>
                  The adjustment is reverse-engineered from what the lighter side would need added to even the trade, 
                  which is why it updates as players are added to either side.
                </p>
              </div>
            </div>
          )}
          
          {/* Piece count summary for Team 1 */}
          {result && team1.length > 0 && (
            <div className="calc-team__summary">
              {team1.length} Total Piece{team1.length !== 1 ? 's' : ''} / 
              {team1.filter(a => a.position === 'QB').length} QB, 
              {team1.filter(a => a.position === 'RB').length} RB, 
              {team1.filter(a => a.position === 'WR').length} WR, 
              {team1.filter(a => a.position === 'TE').length} TE
            </div>
          )}
        </div>

        {/* Team 2 */}
        <div className="calc-team">
          <div className="calc-team__header">
            <span className="calc-team__title">Team 2</span>
            {result && (
              <span className="calc-team__total">{result.team2.sideValue.toFixed(1)}</span>
            )}
          </div>
          <AssetSearch onSelect={addToTeam(2)} excludeIds={allIds} />
          <div className="calc-team__assets">
            {team2.map(a => (
              <div key={a.asset_id} className="asset-chip">
                <span className={`pos-badge pos-badge--${a.position}`}>{a.position}</span>
                <span className="asset-chip__name">{a.name}</span>
                <span className={`asset-chip__value${a.valuesByLeagueType[code] === undefined ? ' asset-chip__value--muted' : ''}`}>
                  {a.valuesByLeagueType[code] !== undefined ? a.valuesByLeagueType[code].toFixed(1) : '—'}
                </span>
                <button
                  className="asset-chip__remove"
                  onClick={() => removeFromTeam(2, a.asset_id)}
                >
                  ✕
                </button>
              </div>
            ))}
            {team2.length === 0 && (
              <p className="text-muted" style={{ padding: '0.75rem', fontSize: '0.8rem' }}>
                Search and add players above
              </p>
            )}
          </div>

          {/* Value Adjustment row for Team 2 */}
          {result && result.team2.adjustment > 0 && (
            <div className="calc-team__adjustment">
              <span className="adjustment-chip">
                <span className="adjustment-chip__label">Value Adjustment</span>
                <span className="adjustment-chip__value">+{result.team2.adjustment.toFixed(1)}</span>
              </span>
              <button className="adjustment-disclosure" onClick={(e) => { e.stopPropagation(); setShowMath(true); }}>
                More on value adjustment
              </button>
              <div className="adjustment-disclosure__panel">
                <p>
                  Trading is more than simple addition. We add value to the side of the trade that's giving up 
                  more when you look at roster spots, players' "stud" factor, and so on. This counters trade math 
                  that says twelve third-round picks are a fair deal for one elite player.
                </p>
                <p>
                  The adjustment is reverse-engineered from what the lighter side would need added to even the trade, 
                  which is why it updates as players are added to either side.
                </p>
              </div>
            </div>
          )}
          
          {/* Piece count summary for Team 2 */}
          {result && team2.length > 0 && (
            <div className="calc-team__summary">
              {team2.length} Total Piece{team2.length !== 1 ? 's' : ''} / 
              {team2.filter(a => a.position === 'QB').length} QB, 
              {team2.filter(a => a.position === 'RB').length} RB, 
              {team2.filter(a => a.position === 'WR').length} WR, 
              {team2.filter(a => a.position === 'TE').length} TE
            </div>
          )}
        </div>
      </div>

      {/* Trade Scale */}
      {result && (
        <div className="calc-result">
          <TradeScale scale={result.scale} verdict={result.verdict} />
          <div className="calc-result__details">
            <span className="text-muted">
              Difference: {result.differencePct}%
            </span>
            {result.adviceGap && (
              <span className="calc-result__hint">
                To even it, add a ~{result.adviceGap.toFixed(0)}-value player to the losing side
              </span>
            )}
          </div>

          {/* Volatility Profile Panel */}
          {(() => {
            const v1 = result.volatility.team1;
            const v2 = result.volatility.team2;
            const hasAnyRated = (v1.ratedCount > 0 || v2.ratedCount > 0);
            if (!hasAnyRated) return null;

            const showVolDelta = v1.volatility !== null && v2.volatility !== null;
            const volDelta = showVolDelta ? (v2.volatility! - v1.volatility!) : null;

            return (
              <div className="volatility-compare">
                <div className="volatility-compare__header">
                  <span className="volatility-compare__label"></span>
                  <span className="volatility-compare__col">VOL</span>
                </div>
                <div className="volatility-compare__row">
                  <span className="volatility-compare__side">TEAM 1</span>
                  <span className="volatility-compare__val">
                    {v1.volatility !== null ? `${v1.volatility}%` : '—'}
                  </span>
                </div>
                {v1.unratedCount > 0 && (
                  <div className="volatility-compare__coverage">excludes {v1.unratedCount} unrated</div>
                )}
                <div className="volatility-compare__row">
                  <span className="volatility-compare__side">TEAM 2</span>
                  <span className="volatility-compare__val">
                    {v2.volatility !== null ? `${v2.volatility}%` : '—'}
                  </span>
                </div>
                {v2.unratedCount > 0 && (
                  <div className="volatility-compare__coverage">excludes {v2.unratedCount} unrated</div>
                )}
                {showVolDelta && (
                  <div className="volatility-compare__delta">
                    {/* Signed volatility difference has no good/bad direction — deliberate departure
                        from the old boom/bust panel, which used delta--pos / delta--neg here. */}
                    <span className="volatility-compare__delta-item">
                      Team 2 gets {volDelta! > 0 ? '+' : ''}{volDelta} volatility
                    </span>
                  </div>
                )}
              </div>
            );
          })()}

          {/* Trade Suggestions Panel */}
          {result.suggestions && result.suggestions.length > 0 && (
            <div className="suggestions-panel">
              <h3 className="suggestions-panel__title">Players to Even Trade</h3>
              {result.suggestions.map((suggestion, index) => (
                <div key={suggestion.id} className="suggestion-row">
                  <div className="suggestion-row__info">
                    <span className={`pos-badge pos-badge--${suggestion.position}`}>{suggestion.position}</span>
                    <span className="suggestion-row__name">{suggestion.name}</span>
                    {suggestion.team && (
                      <span className="suggestion-row__team">{suggestion.team}</span>
                    )}
                    <span className="suggestion-row__value">{suggestion.value.toFixed(1)}</span>
                    <span className="suggestion-row__target">
                      &rarr; Team {suggestion.side}
                    </span>
                  </div>
                  <button
                    className="suggestion-row__add"
                    onClick={() => addToTeam(suggestion.side)({
                      asset_id: suggestion.id,
                      name: suggestion.name,
                      position: suggestion.position,
                      team: suggestion.team,
                      value: suggestion.value,
                    })}
                    title={`Add ${suggestion.name} to Team ${suggestion.side}`}
                  >
                    +
                  </button>
                </div>
              ))}
            </div>
          )}

          {result.suggestions && result.suggestions.length === 0 && result.verdict !== 'Fair trade' && (
            <div className="suggestions-panel suggestions-panel--empty">
              <span className="text-muted">No single asset can even this trade.</span>
            </div>
          )}

          <button
            className="math-toggle"
            onClick={() => setShowMath(prev => !prev)}
          >
            {showMath ? '− Hide the math' : '+ Show the math'}
          </button>

          {showMath && (
            <div className="math-panel">
              <div className="math-panel__summary">
                <p>
                  <strong>Scale:</strong> {result.scale} ({result.verdict})
                </p>
                <p>
                  <strong>Formula:</strong> raw sum + value adjustment (roster-spot credit). 
                  Each side's raw sum = Σ player values. Depth penalty = raw sum − depth-weighted sum. 
                  Value adjustment = |penalty₁ − penalty₂|, added to the side with the SMALLER penalty 
                  (fewer/more concentrated pieces). Equal piece counts ⇒ zero adjustment.
                </p>
              </div>

              <div className="math-panel__sides">
                <div className="math-panel__side">
                  <h3 className="math-panel__heading">Team 1 — {result.team1.sideValue.toFixed(1)}</h3>
                  <table className="math-table">
                    <thead>
                      <tr>
                        <th>Player</th>
                        <th>Value</th>
                        <th>Weight</th>
                        <th>Weighted</th>
                      </tr>
                    </thead>
                    <tbody>
                      {result.team1.assets.map((a, i) => {
                        const weighted = Math.round(a.value * a.weight);
                        return (
                          <tr key={a.id}>
                            <td>{a.name}</td>
                            <td className="math-num">{a.value.toFixed(1)}</td>
                            <td className="math-num">{a.weight.toFixed(2)}</td>
                            <td className="math-num">{weighted.toLocaleString()}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                  <div className="math-panel__breakdown">
                    <p><strong>Raw sum:</strong> {result.team1.rawSum.toFixed(1)}</p>
                    <p><strong>Depth penalty:</strong> {(result.team1.rawSum - result.team1.assets.reduce((sum, a, i) => sum + a.value * a.weight, 0)).toFixed(1)}</p>
                    <p><strong>Adjustment:</strong> {result.team1.adjustment.toFixed(1)}</p>
                    <p><strong>Total:</strong> {result.team1.sideValue.toFixed(1)}</p>
                  </div>
                </div>

                <div className="math-panel__side">
                  <h3 className="math-panel__heading">Team 2 — {result.team2.sideValue.toFixed(1)}</h3>
                  <table className="math-table">
                    <thead>
                      <tr>
                        <th>Player</th>
                        <th>Value</th>
                        <th>Weight</th>
                        <th>Weighted</th>
                      </tr>
                    </thead>
                    <tbody>
                      {result.team2.assets.map((a, i) => {
                        const weighted = Math.round(a.value * a.weight);
                        return (
                          <tr key={a.id}>
                            <td>{a.name}</td>
                            <td className="math-num">{a.value.toFixed(1)}</td>
                            <td className="math-num">{a.weight.toFixed(2)}</td>
                            <td className="math-num">{weighted.toLocaleString()}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                  <div className="math-panel__breakdown">
                    <p><strong>Raw sum:</strong> {result.team2.rawSum.toFixed(1)}</p>
                    <p><strong>Depth penalty:</strong> {(result.team2.rawSum - result.team2.assets.reduce((sum, a, i) => sum + a.value * a.weight, 0)).toFixed(1)}</p>
                    <p><strong>Adjustment:</strong> {result.team2.adjustment.toFixed(1)}</p>
                    <p><strong>Total:</strong> {result.team2.sideValue.toFixed(1)}</p>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {error && (
        <div className="calc-error">{error}</div>
      )}
    </div>
  );
}

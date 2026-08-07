import { useState, useEffect, useCallback } from 'react';
import { formatLeagueLabel } from '@empire-fantasy/shared';

interface PromptAsset {
  asset_id: number;
  name: string;
  position: string;
  team: string | null;
  age: number | null;
}

interface Prompt {
  promptId: number;
  leagueType: string;
  assets: PromptAsset[];
}

type Assignment = 'KEEP' | 'TRADE' | 'CUT' | null;
const CYCLE: Assignment[] = [null, 'KEEP', 'TRADE', 'CUT'];
// sessionStorage: clears when tab/browser closes, so popup returns on next visit.
// localStorage would persist forever (old bug). In-component state only would re-show
// on every page reload/navigation, which is too aggressive.
const GATE_STORAGE: Storage = sessionStorage;
const STORAGE_KEY = 'ef_ktc_seen';

export default function KtcPopup() {
  const [visible, setVisible] = useState(false);
  const [prompt, setPrompt] = useState<Prompt | null>(null);
  const [assignments, setAssignments] = useState<Map<number, Assignment>>(new Map());
  const [status, setStatus] = useState<'loading' | 'ready' | 'submitting' | 'capped' | 'error'>('loading');
  const [flash, setFlash] = useState<string | null>(null);

  useEffect(() => {
    // Idempotent read: sessionStorage is synchronous, no flash possible
    if (!GATE_STORAGE.getItem(STORAGE_KEY)) {
      setVisible(true);
    }
  }, []);

  const fetchPrompt = useCallback(() => {
    setStatus('loading');
    setAssignments(new Map());
    setFlash(null);
    fetch('/api/ktc/prompt', { credentials: 'include' })
      .then(r => {
        if (r.status === 429) { setStatus('capped'); return null; }
        if (!r.ok) throw new Error('Failed to load prompt');
        return r.json();
      })
      .then(data => {
        if (data) { setPrompt(data); setStatus('ready'); }
      })
      .catch(() => setStatus('error'));
  }, []);

  useEffect(() => {
    if (visible) fetchPrompt();
  }, [visible, fetchPrompt]);

  const dismiss = () => {
    GATE_STORAGE.setItem(STORAGE_KEY, '1');
    setVisible(false);
  };

  const cycleAssignment = (assetId: number) => {
    setAssignments(prev => {
      const next = new Map(prev);
      const current = next.get(assetId) ?? null;
      const idx = CYCLE.indexOf(current);
      let nextAssign = CYCLE[(idx + 1) % CYCLE.length];

      const used = new Set([...next.values()].filter((v): v is Assignment => v !== null && v !== current));
      while (nextAssign && used.has(nextAssign)) {
        const nextIdx = CYCLE.indexOf(nextAssign);
        nextAssign = CYCLE[(nextIdx + 1) % CYCLE.length];
      }

      next.set(assetId, nextAssign);
      return next;
    });
  };

  const allAssigned = prompt && assignments.size === 3
    && new Set(assignments.values()).size === 3
    && !assignments.has(null as any)
    && [...assignments.values()].every(v => v !== null);

  const submit = () => {
    if (!prompt || !allAssigned) return;
    setStatus('submitting');

    let keep = 0, trade = 0, cut = 0;
    for (const [id, role] of assignments) {
      if (role === 'KEEP') keep = id;
      else if (role === 'TRADE') trade = id;
      else if (role === 'CUT') cut = id;
    }

    fetch('/api/ktc/vote', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ promptId: prompt.promptId, keep, trade, cut }),
    })
      .then(r => {
        if (!r.ok) throw new Error('Vote failed');
        return r.json();
      })
      .then(() => {
        // Notify other tabs/pages (Log, Rankings) to refresh
        window.dispatchEvent(new CustomEvent('empire-refresh'));
        setFlash('Market updated');
        setTimeout(() => dismiss(), 1200);
      })
      .catch(() => setStatus('error'));
  };

  if (!visible) return null;

  return (
    <div className="ktc-popup-overlay" onClick={dismiss}>
      <div className="ktc-popup" onClick={e => e.stopPropagation()}>
        <button className="ktc-popup__close" onClick={dismiss}>✕</button>
        <h2 className="ktc-popup__title">Keep / Trade / Cut</h2>
        <p className="ktc-popup__subtitle">Help tune the market — tap each card to assign.</p>

        {status === 'loading' && <p className="text-muted">Loading prompt...</p>}

        {status === 'capped' && (
          <div className="ktc-capped">
            <p className="text-muted">Daily vote limit reached. Come back tomorrow.</p>
          </div>
        )}

        {status === 'error' && (
          <div>
            <p className="text-muted">Something went wrong.</p>
            <button className="ktc-btn" onClick={fetchPrompt}>Try again</button>
          </div>
        )}

        {prompt && status !== 'loading' && status !== 'capped' && status !== 'error' && (
          <>
            <div className="ktc-league-badge">Rating for: {formatLeagueLabel(prompt.leagueType)}</div>

            <div className="ktc-cards">
              {prompt.assets.map(asset => {
                const role = assignments.get(asset.asset_id) ?? null;
                return (
                  <button
                    key={asset.asset_id}
                    className={`ktc-card ${role ? `ktc-card--${role.toLowerCase()}` : ''}`}
                    onClick={() => cycleAssignment(asset.asset_id)}
                    disabled={status === 'submitting'}
                  >
                    <span className={`pos-badge pos-badge--${asset.position}`}>{asset.position}</span>
                    <span className="ktc-card__name">{asset.name}</span>
                    <span className="ktc-card__meta">
                      {asset.team || 'FA'}{asset.age ? ` · ${asset.age}` : ''}
                    </span>
                    {role && <span className={`ktc-role ktc-role--${role.toLowerCase()}`}>{role}</span>}
                  </button>
                );
              })}
            </div>

            {flash && <div className="ktc-flash">{flash}</div>}

            <div className="ktc-actions">
              <button
                className="ktc-btn ktc-btn--primary"
                disabled={!allAssigned || status === 'submitting'}
                onClick={submit}
              >
                {status === 'submitting' ? 'Submitting...' : 'Submit'}
              </button>
              <button
                className="ktc-btn"
                onClick={dismiss}
              >
                Skip
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

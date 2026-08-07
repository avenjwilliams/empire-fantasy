import { useCallback, useEffect, useState } from 'react';
import { teamNickname } from '@empire-fantasy/shared';
import { useTeamTheme } from '../context/TeamThemeContext.js';
import { TEAMS, resolveTeam, contrast } from '../teamThemes.js';

// ----------------------------------------------------------------------------
// Discussion — flat, anonymous, newest-first thread per asset.
// Talks only to /api/comments/:assetId. Owns its own fetching (PlayerDetail's
// AssetDetail payload does not include comments, and never should).
//
// SECURITY: comment bodies are rendered as React text nodes only. No
// dangerouslySetInnerHTML, no markdown, no link auto-detection, no <br> via
// HTML. Line breaks are preserved purely with CSS (white-space: pre-wrap) and
// long runs are wrapped with overflow-wrap:anywhere on `.comment__body`.
// ----------------------------------------------------------------------------

// UI must match the server's cap. The authoritative value lives in
// server/src/services/commentService.ts (MAX_COMMENT_LENGTH). A shared export
// isn't available in this session, so it is mirrored here with this warning;
// keep the two values in lockstep.
const MAX_COMMENT_LENGTH = 1000;

const PAGE_SIZE = 50;

interface Comment {
  id: number;
  asset_id: number;
  team_code: string | null;
  body: string;
  created_at: string;
  deleted_at: string | null;
  authorName: string;
  isMine: boolean;
}

interface ListResponse {
  total: number;
  comments: Comment[];
}

/** "2026-08-06 14:22:03" (UTC, second resolution) -> compact "3m ago". */
function timeAgo(createdAt: string): string {
  const d = new Date(createdAt.replace(' ', 'T') + 'Z');
  if (Number.isNaN(d.getTime())) return createdAt;
  const diffMs = Date.now() - d.getTime();
  const min = Math.floor(diffMs / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day}d ago`;
  return d.toLocaleDateString();
}

/** Tint an author name with their own team color, but only when it stays
 *  legible on the current background. The same contrast rule the theme uses
 *  (>= 4.5:1 against --bg); fall back to ink rather than ship an unreadable
 *  color. Absent/unknown team renders in the fixed severity-mid (non-accent). */
function authorColor(team_code: string | null): string {
  if (!team_code) return 'var(--severity-mid)';
  const team = TEAMS.find(t => t.code === team_code);
  if (!team) return 'var(--severity-mid)';
  const bg = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim() || '#0a0e14';
  const accent = resolveTeam(team)['--accent'];
  return contrast(accent, bg) >= 4.5 ? accent : 'var(--ink)';
}

export default function Discussion({ assetId }: { assetId: number }) {
  const { team } = useTeamTheme();
  // Send null for both "never asked" (null) and Classic ('NONE') — the server
  // has no 'NONE' team and would reject it with a 400.
  const teamCode = team === null || team === 'NONE' ? null : team;

  const [comments, setComments] = useState<Comment[]>([]);
  const [total, setTotal] = useState(0);
  const [loaded, setLoaded] = useState(0); // count fetched from server so far
  const [listState, setListState] = useState<'loading' | 'ok' | 'error'>('loading');
  const [loadMoreState, setLoadMoreState] = useState<'idle' | 'loading' | 'error'>('idle');

  const [body, setBody] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const [confirmId, setConfirmId] = useState<number | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const fetchPage = useCallback(
    async (offset: number, pageSize: number): Promise<ListResponse> => {
      const res = await fetch(`/api/comments/${assetId}?limit=${pageSize}&offset=${offset}`, {
        credentials: 'include',
      });
      if (!res.ok) throw new Error(`comments fetch ${res.status}`);
      return res.json();
    },
    [assetId],
  );

  useEffect(() => {
    let cancelled = false;
    setListState('loading');
    setComments([]);
    setLoaded(0);
    setTotal(0);
    fetchPage(0, PAGE_SIZE)
      .then(d => {
        if (cancelled) return;
        setComments(d.comments);
        setTotal(d.total);
        setLoaded(d.comments.length);
        setListState('ok');
      })
      .catch(() => {
        if (!cancelled) setListState('error');
      });
    return () => {
      cancelled = true;
    };
  }, [fetchPage]);

  const trimmed = body.trim();
  const overLimit = trimmed.length > MAX_COMMENT_LENGTH;
  const canSubmit = trimmed.length > 0 && !overLimit && !submitting;

  const submit = useCallback(() => {
    if (!canSubmit) return;
    setSubmitting(true);
    setSubmitError(null);
    fetch(`/api/comments/${assetId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ body: trimmed, teamCode }),
    })
      .then(res => {
        if (res.status === 429) {
          setSubmitError('Daily comment limit reached. Come back tomorrow.');
          return null;
        }
        if (!res.ok) {
          return res.json().then(d => {
            throw new Error(d?.error || 'Could not post comment');
          });
        }
        return res.json();
      })
      .then((created: Comment | null) => {
        if (!created) return;
        setComments(prev => [created, ...prev]);
        setTotal(t => t + 1);
        setBody(''); // only clear on success so a failed submit keeps the text
      })
      .catch(e => {
        setSubmitError(e?.message || 'Could not post comment');
      })
      .finally(() => setSubmitting(false));
  }, [canSubmit, body, trimmed, teamCode, assetId]);

  const loadMore = useCallback(() => {
    if (loadMoreState === 'loading') return;
    setLoadMoreState('loading');
    fetchPage(loaded, PAGE_SIZE)
      .then(d => {
        setComments(prev => [...prev, ...d.comments]);
        setTotal(d.total);
        setLoaded(prev => prev + d.comments.length);
        setLoadMoreState('idle');
      })
      .catch(() => setLoadMoreState('error'));
  }, [fetchPage, loaded, loadMoreState]);

  const removeComment = useCallback((id: number) => {
    setConfirmId(null);
    setDeleteError(null);
    fetch(`/api/comments/${id}`, { method: 'DELETE', credentials: 'include' })
      .then(res => {
        if (!res.ok) throw new Error('delete failed');
        setComments(prev => prev.filter(c => c.id !== id));
        setTotal(t => Math.max(0, t - 1));
        setLoaded(l => Math.max(0, l - 1));
      })
      .catch(() => setDeleteError('Could not delete comment'));
  }, []);

  const nicknamePreview = teamNickname(teamCode);

  return (
    <section className="discussion">
      <h2 className="page__title page__title--sm">Discussion</h2>

      {/* Composer */}
      <div className="comment-composer">
        <div className="comment-composer__row">
          <span className="comment-composer__identity">
            Posting as {nicknamePreview ? `Anonymous ${nicknamePreview} Fan` : 'Anonymous Fan'}
          </span>
          <span className={`comment-composer__count${overLimit ? ' comment-composer__count--negative' : ''}`}>
            {trimmed.length} / {MAX_COMMENT_LENGTH}
          </span>
        </div>
        <textarea
          className="comment-composer__input"
          value={body}
          onChange={e => setBody(e.target.value)}
          placeholder="Share your take..."
          rows={3}
          aria-label="Write a comment"
        />
        <div className="comment-composer__actions">
          <button
            className="comment-composer__submit"
            onClick={submit}
            disabled={!canSubmit}
          >
            {submitting ? 'Posting…' : 'Post'}
          </button>
        </div>
        {submitError && <p className="comment-composer__error">{submitError}</p>}
        {deleteError && <p className="comment-composer__error">{deleteError}</p>}
      </div>

      {/* List */}
      {listState === 'loading' ? (
        <p className="text-muted">Loading discussion…</p>
      ) : listState === 'error' ? (
        <p className="comment-composer__error">Could not load comments.</p>
      ) : comments.length === 0 ? (
        <p className="comment__empty">No discussion yet.</p>
      ) : (
        <ul className="discussion__list">
          {comments.map(c => (
            <li key={c.id} className="comment">
              <div className="comment__meta">
                <span className="comment__author" style={{ color: authorColor(c.team_code) }}>
                  {c.authorName}
                </span>
                <span className="comment__timestamp">{timeAgo(c.created_at)}</span>
                {c.isMine && (
                  <button
                    type="button"
                    className="comment__delete"
                    onClick={() => (confirmId === c.id ? removeComment(c.id) : setConfirmId(c.id))}
                  >
                    {confirmId === c.id ? 'Sure?' : '✕'}
                  </button>
                )}
              </div>
              <p className="comment__body">{c.body}</p>
            </li>
          ))}
        </ul>
      )}

      {/* Pagination */}
      {listState === 'ok' && comments.length < total && (
        <div className="discussion__pagination">
          <button className="comment-composer__submit comment-composer__submit--ghost" onClick={loadMore} disabled={loadMoreState === 'loading'}>
            {loadMoreState === 'loading' ? 'Loading…' : 'Load more'}
          </button>
          {loadMoreState === 'error' && <p className="comment-composer__error">Could not load more.</p>}
        </div>
      )}
    </section>
  );
}
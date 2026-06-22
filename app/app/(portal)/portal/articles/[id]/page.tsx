'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';

// [C4] Full-screen client article review/edit screen + [C5] the three wired writes. The client reads
// the article comfortably (immersive prose column), edits the body in a full-height plain-text editor,
// then approves, requests changes, or saves edits — all live against the session-scoped portal API.
//
// Editor choice (rationale on the task): Article.body is plain text end-to-end (storage + the team
// editor), so this is a comfortable full-screen plain-text surface, not a rich-text/TipTap editor —
// keeping storage and editor formats identical and the change reversible.

interface ClientArticle {
  id: string;
  title: string;
  status: string;
  body: string | null;
  comments: Array<{ id: string; content: string; author_name: string | null; created_at: string }>;
  created_at: string;
  updated_at: string;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

export default function ClientArticleReviewPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();

  const [article, setArticle] = useState<ClientArticle | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Local edit state for the body — read + edit comfortably, persisted via Save / on submit.
  const [body, setBody] = useState('');

  // Which action panel is open: null | 'approve' | 'changes'
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [changesNote, setChangesNote] = useState('');

  // Write states. `submitting` names the in-flight action so every button can disable together;
  // `actionError` surfaces a failure inline; `completed` swaps the controls for a confirmation once
  // the client has approved or sent the piece back. `saveState` drives the lightweight Saved hint.
  const [submitting, setSubmitting] = useState<'approve' | 'changes' | 'save' | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [completed, setCompleted] = useState<'approved' | 'changes' | null>(null);
  const [saveState, setSaveState] = useState<'idle' | 'saved'>('idle');

  const isDirty = article !== null && body !== (article.body ?? '');

  // Persist the current body. Returns true on success; on failure sets actionError and returns false
  // so callers (approve / request-changes) can abort rather than act on unsaved edits.
  async function persistBody(): Promise<boolean> {
    const res = await fetch(`/api/portal/articles/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ body }),
    });
    if (res.status === 401) {
      router.replace('/portal/login');
      return false;
    }
    if (!res.ok) {
      const payload = await res.json().catch(() => ({}));
      setActionError(payload.error || 'We couldn’t save your edits. Please try again.');
      return false;
    }
    const payload: { article: ClientArticle } = await res.json();
    setArticle(payload.article);
    setBody(payload.article.body ?? '');
    return true;
  }

  async function handleSave() {
    if (submitting) return;
    setActionError(null);
    setSubmitting('save');
    try {
      if (await persistBody()) {
        setSaveState('saved');
      }
    } finally {
      setSubmitting(null);
    }
  }

  async function handleApprove() {
    if (submitting) return;
    setActionError(null);
    setSubmitting('approve');
    try {
      // Don't lose edits the client made before approving — save a dirty body first.
      if (isDirty && !(await persistBody())) return;

      const res = await fetch(`/api/portal/articles/${id}/approve`, { method: 'POST' });
      if (res.status === 401) {
        router.replace('/portal/login');
        return;
      }
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        setActionError(payload.error || 'We couldn’t record your approval. Please try again.');
        return;
      }
      setCompleted('approved');
    } finally {
      setSubmitting(null);
    }
  }

  async function handleRequestChanges() {
    if (submitting) return;
    setActionError(null);
    if (!changesNote.trim()) {
      setActionError('Please tell us what needs changing.');
      return;
    }
    setSubmitting('changes');
    try {
      // Save any in-editor edits alongside the note so the team sees the same text the client did.
      if (isDirty && !(await persistBody())) return;

      const res = await fetch(`/api/portal/articles/${id}/request-changes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ note: changesNote }),
      });
      if (res.status === 401) {
        router.replace('/portal/login');
        return;
      }
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        setActionError(payload.error || 'We couldn’t send your changes. Please try again.');
        return;
      }
      setCompleted('changes');
    } finally {
      setSubmitting(null);
    }
  }

  useEffect(() => {
    async function fetchArticle() {
      try {
        const res = await fetch(`/api/portal/articles/${id}`);
        if (res.status === 401) {
          router.replace('/portal/login');
          return;
        }
        if (!res.ok) {
          const payload = await res.json().catch(() => ({}));
          setError(payload.error || 'We couldn’t load this article.');
          return;
        }
        const payload: { article: ClientArticle } = await res.json();
        setArticle(payload.article);
        setBody(payload.article.body ?? '');
      } catch {
        setError('We couldn’t load this article.');
      } finally {
        setLoading(false);
      }
    }
    fetchArticle();
  }, [id, router]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <p className="text-text-tertiary">Loading…</p>
      </div>
    );
  }

  if (error || !article) {
    return (
      <div className="rounded-lg border border-border bg-surface p-8 text-center">
        <h2 className="mb-2 text-xl font-semibold text-text-main">Unable to load this article</h2>
        <p className="text-text-secondary">{error || 'This article isn’t available.'}</p>
        <Link href="/portal" className="mt-4 inline-block text-sm text-brand-primary hover:underline">
          ← Back to your articles
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Back + context */}
      <div className="flex items-center justify-between gap-4">
        <Link href="/portal" className="text-sm text-brand-primary hover:underline">
          ← Back to your articles
        </Link>
        <span className="text-xs text-text-tertiary">Updated {formatDate(article.updated_at)}</span>
      </div>

      {/* The reading + editing surface — a comfortable, full-height prose column. */}
      <div className="rounded-lg border border-border bg-surface">
        <div className="border-b border-border px-6 py-5 sm:px-10">
          <h1 className="text-2xl font-bold leading-snug text-text-main sm:text-3xl">{article.title}</h1>
          <p className="mt-2 text-sm text-text-tertiary">
            Read it through, make any edits directly in the text, then approve or send it back.
          </p>
        </div>
        <div className="px-6 py-6 sm:px-10 sm:py-8">
          <label htmlFor="article-body" className="sr-only">
            Article body
          </label>
          <textarea
            id="article-body"
            value={body}
            onChange={(e) => {
              setBody(e.target.value);
              setSaveState('idle');
            }}
            disabled={completed !== null}
            spellCheck
            className="block w-full resize-y border-0 bg-transparent p-0 text-[1.0625rem] leading-8 text-text-main focus:outline-none focus:ring-0 disabled:opacity-70"
            style={{ minHeight: '60vh', fontFamily: 'Georgia, Cambria, "Times New Roman", serif' }}
            placeholder="The article body will appear here."
          />
        </div>
        {completed === null && (
          <div className="flex items-center justify-end gap-3 border-t border-border px-6 py-3 sm:px-10">
            {saveState === 'saved' && !isDirty && (
              <span className="text-sm text-text-tertiary">Saved</span>
            )}
            <button
              type="button"
              onClick={handleSave}
              disabled={!isDirty || submitting !== null}
              className="rounded-md border border-border px-3 py-1.5 text-sm text-text-main transition-colors hover:bg-surface-secondary disabled:cursor-not-allowed disabled:opacity-60"
            >
              {submitting === 'save' ? 'Saving…' : 'Save edits'}
            </button>
          </div>
        )}
      </div>

      {/* Prior feedback, if any — client-safe comments only (internal notes never reach here). */}
      {article.comments.length > 0 && (
        <div className="rounded-lg border border-border bg-surface p-6 sm:px-10">
          <h2 className="mb-4 text-lg font-semibold text-text-main">Notes</h2>
          <ul className="space-y-4">
            {article.comments.map((c) => (
              <li key={c.id} className="border-l-2 border-border pl-4">
                <p className="whitespace-pre-line text-sm text-text-main">{c.content}</p>
                <p className="mt-1 text-xs text-text-tertiary">
                  {c.author_name ?? 'Indelible'} · {formatDate(c.created_at)}
                </p>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Review controls, or the confirmation once the client has acted. */}
      {completed ? (
        <div className="rounded-lg border border-border bg-surface p-6 text-center sm:px-10">
          <h2 className="mb-2 text-xl font-semibold text-text-main">
            {completed === 'approved' ? 'Thank you — approved' : 'Thanks — sent back for changes'}
          </h2>
          <p className="text-text-secondary">
            {completed === 'approved'
              ? 'We’ve recorded your approval. There’s nothing more you need to do.'
              : 'We’ve passed your notes to the team and we’ll take another pass.'}
          </p>
          <Link
            href="/portal"
            className="mt-4 inline-block text-sm text-brand-primary hover:underline"
          >
            ← Back to your articles
          </Link>
        </div>
      ) : (
        <div className="rounded-lg border border-border bg-surface p-6 sm:px-10">
          <h2 className="mb-4 text-lg font-semibold text-text-main">What would you like to do?</h2>
          <div className="flex flex-col gap-3 sm:flex-row">
            <button
              type="button"
              onClick={() => setPendingAction(pendingAction === 'approve' ? null : 'approve')}
              disabled={submitting !== null}
              className="rounded-md bg-brand-primary px-4 py-2 text-white transition-colors hover:bg-brand-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
            >
              Approve
            </button>
            <button
              type="button"
              onClick={() => setPendingAction(pendingAction === 'changes' ? null : 'changes')}
              disabled={submitting !== null}
              className="rounded-md border border-border px-4 py-2 text-text-main transition-colors hover:bg-surface-secondary disabled:cursor-not-allowed disabled:opacity-60"
            >
              Request changes
            </button>
          </div>

          {pendingAction === 'approve' && (
            <div className="mt-5 border-t border-border pt-5">
              <p className="mb-4 text-text-secondary">
                Approve this article? This confirms you’re happy with it, including any edits you’ve
                made.
              </p>
              <button
                type="button"
                onClick={handleApprove}
                disabled={submitting !== null}
                className="rounded-md bg-brand-primary px-4 py-2 text-white transition-colors hover:bg-brand-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {submitting === 'approve' ? 'Approving…' : 'Confirm approval'}
              </button>
            </div>
          )}

          {pendingAction === 'changes' && (
            <div className="mt-5 border-t border-border pt-5">
              <label htmlFor="changes-note" className="mb-2 block text-sm font-medium text-text-main">
                What needs changing?
              </label>
              <textarea
                id="changes-note"
                value={changesNote}
                onChange={(e) => setChangesNote(e.target.value)}
                rows={4}
                placeholder="Tell us what’s not right and we’ll take another pass."
                className="w-full rounded-md border border-border bg-surface px-3 py-2 text-text-main placeholder:text-text-tertiary focus:outline-none focus:ring-2 focus:ring-brand-primary/40"
              />
              <button
                type="button"
                onClick={handleRequestChanges}
                disabled={submitting !== null || !changesNote.trim()}
                className="mt-3 rounded-md bg-brand-primary px-4 py-2 text-white transition-colors hover:bg-brand-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {submitting === 'changes' ? 'Sending…' : 'Send back for changes'}
              </button>
            </div>
          )}

          {actionError && <p className="mt-4 text-sm text-error">{actionError}</p>}
        </div>
      )}
    </div>
  );
}

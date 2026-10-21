'use client';

import { useEffect, useState } from 'react';
import { PenLine, TriangleAlert } from 'lucide-react';
import { PageHeader } from '@/components/portal/ui/page-header';
import { Callout } from '@/components/portal/ui/callout';
import { PortalButton } from '@/components/portal/ui/button';
import { ActionLink } from '@/components/portal/ui/action-link';
import { Field } from '@/components/portal/ui/field';
import { StatusChip } from '@/components/portal/ui/status-chip';
import { Skeleton, SkeletonRegion } from '@/components/portal/ui/skeleton';
import { useParams, useRouter } from 'next/navigation';

// [C4] Full-screen client article review/edit screen + [C5] the three wired writes. The client reads
// the article comfortably (immersive prose column), edits the body in a full-height plain-text editor,
// then approves, requests changes, or saves edits, all live against the session-scoped portal API.
//
// Editor choice: Article.body is plain text end-to-end (storage + the team
// editor), so this is a comfortable full-screen plain-text surface, not a rich-text/TipTap editor,
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

  // Local edit state for the body, read + edit comfortably, persisted via Save / on submit.
  const [body, setBody] = useState('');

  // Which action panel is open: null | 'approve' | 'changes'
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [changesNote, setChangesNote] = useState('');
  // Reading column by default; Edit the text switches it to the plain-text editor.
  const [editing, setEditing] = useState(false);

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
        setEditing(false);
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
      // Don't lose edits the client made before approving, save a dirty body first.
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
      <SkeletonRegion label="Loading the article">
        <PageHeader title="Article for review" size="page" />
        <Skeleton block lines={5} />
      </SkeletonRegion>
    );
  }

  if (error || !article) {
    return (
      <>
        <Callout tone="urgent" icon={TriangleAlert} title="We could not load this article" id="article-error">
          <p className="note">{error || 'This article isn’t available.'} Please go back and try again.</p>
        </Callout>
        <div className="actions">
          <ActionLink href="/portal">Back to your articles</ActionLink>
        </div>
      </>
    );
  }

  const chip =
    completed === 'approved' ? (
      <StatusChip label="Approved" tone="done" />
    ) : completed === 'changes' ? (
      <StatusChip label="Sent back for changes" tone="quiet" />
    ) : (
      <StatusChip label="Ready for your review" tone="attention" />
    );
  const paragraphs = (article.body ?? '').split(/\n{2,}/).filter((p) => p.trim().length > 0);

  return (
    <>
      <PageHeader
        eyebrow={['Article for review', chip, `Updated ${formatDate(article.updated_at)}`]}
        title={article.title}
        size="page"
        lede="Read it through, make any edits directly in the text, then approve or send it back."
        motif={null}
      />

      <div className="card" style={{ maxWidth: '65ch' }}>
        {editing ? (
          <>
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
              style={{ minHeight: '70vh', fontSize: '1.0625rem', lineHeight: 1.7 }}
              placeholder="The article body will appear here."
            />
            <div className="actions">
              <PortalButton onClick={handleSave} disabled={!isDirty || submitting !== null} busy={submitting === 'save'} busyLabel="Saving">
                Save edits
              </PortalButton>
              <PortalButton
                variant="quiet"
                disabled={submitting !== null}
                onClick={() => {
                  setBody(article.body ?? '');
                  setSaveState('idle');
                  setEditing(false);
                }}
              >
                Cancel
              </PortalButton>
            </div>
          </>
        ) : (
          <div className="prose" style={{ fontSize: '1.0625rem' }}>
            {paragraphs.length > 0 ? (
              paragraphs.map((p, i) => (
                <p key={i} style={{ whiteSpace: 'pre-line' }}>
                  {p}
                </p>
              ))
            ) : (
              <p>The article body will appear here.</p>
            )}
            {saveState === 'saved' && !isDirty ? <p className="hint">Saved</p> : null}
          </div>
        )}
      </div>

      {/* Prior feedback, if any: client-safe comments only (internal notes never reach here). */}
      {article.comments.length > 0 && (
        <section className="sec" aria-labelledby="article-notes-h">
          <div className="sec-h">
            <h2 id="article-notes-h">Notes</h2>
          </div>
          <div style={{ display: 'grid', gap: 14 }}>
            {article.comments.map((c) => (
              <div key={c.id} className="msg us">
                <span className="av" aria-hidden="true">
                  {(c.author_name ?? 'Indelible').slice(0, 1)}
                </span>
                <span className="who">
                  {c.author_name ?? 'Indelible'} · {formatDate(c.created_at)}
                </span>
                <div className="bub" style={{ whiteSpace: 'pre-line' }}>
                  {c.content}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {completed ? (
        <section className="card" aria-live="polite">
          <h2>{completed === 'approved' ? 'Thank you, approved' : 'Thanks, sent back for changes'}</h2>
          <p>
            {completed === 'approved'
              ? 'We’ve recorded your approval. There’s nothing more you need to do.'
              : 'We’ve passed your notes to the team and we’ll take another pass.'}
          </p>
          <div className="actions">
            <ActionLink href="/portal">Back to your articles</ActionLink>
          </div>
        </section>
      ) : (
        <Callout tone="attention" icon={PenLine} title="What would you like to do?" id="article-actions">
          <div className="actions">
            <PortalButton onClick={() => setPendingAction(pendingAction === 'approve' ? null : 'approve')} disabled={submitting !== null}>
              Approve
            </PortalButton>
            <PortalButton variant="secondary" onClick={() => setPendingAction(pendingAction === 'changes' ? null : 'changes')} disabled={submitting !== null}>
              Request changes
            </PortalButton>
            {!editing && (
              <PortalButton variant="quiet" onClick={() => setEditing(true)} disabled={submitting !== null}>
                Edit the text
              </PortalButton>
            )}
          </div>

          {pendingAction === 'approve' && (
            <div className="card">
              <p>Approve this article? This confirms you’re happy with it, including any edits you’ve made.</p>
              <div className="actions">
                <PortalButton onClick={handleApprove} disabled={submitting !== null} busy={submitting === 'approve'} busyLabel="Approving">
                  Confirm approval
                </PortalButton>
              </div>
            </div>
          )}

          {pendingAction === 'changes' && (
            <div className="card">
              <Field id="changes-note" label="What needs changing?">
                <textarea
                  value={changesNote}
                  onChange={(e) => setChangesNote(e.target.value)}
                  rows={4}
                  placeholder="Tell us what’s not right and we’ll take another pass."
                />
              </Field>
              <div className="actions">
                <PortalButton onClick={handleRequestChanges} disabled={submitting !== null || !changesNote.trim()} busy={submitting === 'changes'} busyLabel="Sending">
                  Send back for changes
                </PortalButton>
              </div>
            </div>
          )}

          {actionError && (
            <p className="err" role="alert">
              <TriangleAlert className="i" aria-hidden="true" focusable="false" />
              {actionError}
            </p>
          )}
        </Callout>
      )}
    </>
  );
}

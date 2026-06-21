'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';

// [C4] Full-screen client article review/edit screen. Replaces the cramped popup: the client reads
// the article comfortably (immersive prose column) and edits the body in a full-height plain-text
// editor, with Approve / Request-changes controls in place. Per [C5] the three writes (approve,
// request-changes, save edits) are WIRED there — this screen is the read path + the editor shell.
//
// Editor choice (rationale on the task): Article.body is plain text end-to-end (storage + the team
// editor), so this is a comfortable full-screen plain-text surface, not a rich-text/TipTap editor —
// keeping storage and editor formats identical and the change reversible.

// While the review writes land in [C5], the action buttons show their full UI but don't submit yet —
// honest, not a fake success. Flip to wire approve / request-changes / save in C5.
const REVIEW_ACTIONS_ENABLED = false;

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

  // Local edit state for the body — read + edit comfortably. Persistence is wired in C5.
  const [body, setBody] = useState('');

  // Which action panel is open: null | 'approve' | 'changes'
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [changesNote, setChangesNote] = useState('');

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
            onChange={(e) => setBody(e.target.value)}
            spellCheck
            className="block w-full resize-y border-0 bg-transparent p-0 text-[1.0625rem] leading-8 text-text-main focus:outline-none focus:ring-0"
            style={{ minHeight: '60vh', fontFamily: 'Georgia, Cambria, "Times New Roman", serif' }}
            placeholder="The article body will appear here."
          />
        </div>
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

      {/* Review controls. The UI is complete here; the writes are wired in [C5]. */}
      <div className="rounded-lg border border-border bg-surface p-6 sm:px-10">
        <h2 className="mb-4 text-lg font-semibold text-text-main">What would you like to do?</h2>
        <div className="flex flex-col gap-3 sm:flex-row">
          <button
            type="button"
            onClick={() => setPendingAction(pendingAction === 'approve' ? null : 'approve')}
            className="rounded-md bg-brand-primary px-4 py-2 text-white transition-colors hover:bg-brand-primary/90"
          >
            Approve
          </button>
          <button
            type="button"
            onClick={() => setPendingAction(pendingAction === 'changes' ? null : 'changes')}
            className="rounded-md border border-border px-4 py-2 text-text-main transition-colors hover:bg-surface-secondary"
          >
            Request changes
          </button>
        </div>

        {pendingAction === 'approve' && (
          <div className="mt-5 border-t border-border pt-5">
            <p className="mb-4 text-text-secondary">
              Approve this article? This confirms you’re happy with it, including any edits you’ve made.
            </p>
            <button
              type="button"
              disabled={!REVIEW_ACTIONS_ENABLED}
              className="rounded-md bg-brand-primary px-4 py-2 text-white transition-colors hover:bg-brand-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
            >
              Confirm approval
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
              disabled={!REVIEW_ACTIONS_ENABLED}
              className="mt-3 rounded-md bg-brand-primary px-4 py-2 text-white transition-colors hover:bg-brand-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
            >
              Send back for changes
            </button>
          </div>
        )}

        {!REVIEW_ACTIONS_ENABLED && (
          <p className="mt-4 text-sm text-text-tertiary">
            Review actions are being finalised — you’ll be able to approve, request changes, and save
            your edits here shortly.
          </p>
        )}
      </div>
    </div>
  );
}

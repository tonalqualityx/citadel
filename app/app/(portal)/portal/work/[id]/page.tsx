'use client';

import { use, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { StatusChip } from '@/components/portal/ui/status-chip';
import { EngagementChip } from '@/components/portal/ui/engagement-chip';
import type { Engagement } from '@/lib/portal/engagement';
import type { ChipTone } from '@/lib/portal/status-labels';

// One piece of work in client words (portal phase B slice 1): read-only, plus the review block
// when it is staged for the client. The conversation arrives with slice 2.

interface Work {
  id: string;
  title: string;
  state: { label: string; tone: ChipTone };
  engagement: Engagement;
  site: { id: string; name: string } | null;
  requested_by: { first_name: string } | null;
  requested_at: string;
  answers: Array<{ prompt: string; value: string }>;
  staged: { preview_url: string; awaiting_approval: boolean } | null;
  can_act: boolean;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export default function WorkPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const [work, setWork] = useState<Work | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [showChanges, setShowChanges] = useState(false);
  const [note, setNote] = useState('');

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/portal/work/${id}`);
      if (res.status === 401) {
        router.replace('/portal/login');
        return;
      }
      if (res.status === 404) {
        setNotFound(true);
        return;
      }
      if (!res.ok) {
        setError('Failed to load this request');
        return;
      }
      setWork((await res.json()).work);
    } catch {
      setError('Failed to load this request');
    } finally {
      setLoading(false);
    }
  }, [id, router]);

  useEffect(() => {
    load();
  }, [load]);

  async function act(path: 'approve' | 'request-changes') {
    if (path === 'request-changes' && !note.trim()) {
      setActionError('Please describe what needs changing.');
      return;
    }
    setBusy(true);
    setActionError(null);
    try {
      const res = await fetch(`/api/portal/tasks/mine/${id}/${path}`, {
        method: 'POST',
        ...(path === 'request-changes'
          ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ note: note.trim() }) }
          : {}),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setActionError(body.error || 'Something went wrong. Please try again.');
        return;
      }
      setShowChanges(false);
      setNote('');
      await load();
    } catch {
      setActionError('Something went wrong. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <div className="py-20 text-center text-text-secondary">Loading…</div>;
  if (notFound) {
    return (
      <div className="rounded-lg border border-border bg-surface p-8 text-center">
        <h1 className="mb-2 text-xl font-semibold text-text-main">We could not find that</h1>
        <p className="text-text-secondary">It may have moved, or it may not be on your account.</p>
        <p className="mt-4">
          <Link href="/portal/requests" className="font-semibold text-brand-primary underline">
            Back to your requests
          </Link>
        </p>
      </div>
    );
  }
  if (error || !work) {
    return (
      <div className="rounded-lg border border-border bg-surface p-8 text-center">
        <p className="text-text-secondary">{error ?? 'Failed to load this request'}</p>
      </div>
    );
  }

  const meta = [
    work.requested_by ? `Requested by ${work.requested_by.first_name} on ${formatDate(work.requested_at)}` : `Added ${formatDate(work.requested_at)}`,
    work.site?.name,
  ]
    .filter(Boolean)
    .join(', ');

  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <EngagementChip engagement={work.engagement} />
        <h1 className="text-2xl font-bold text-text-main">{work.title}</h1>
        <div className="flex flex-wrap items-center gap-3">
          <StatusChip label={work.state.label} tone={work.state.tone} />
          <p className="text-sm text-text-tertiary">{meta}</p>
        </div>
      </header>

      {work.staged?.awaiting_approval && (
        <section aria-labelledby="review-heading" className="rounded-lg border border-border bg-surface p-5">
          <h2 id="review-heading" className="text-lg font-semibold text-text-main">
            Ready for your review
          </h2>
          <a
            href={work.staged.preview_url}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-1 inline-block text-sm text-brand-primary underline"
          >
            View preview
          </a>
          {work.can_act ? (
            <>
              <div className="mt-3 flex flex-col gap-3 sm:flex-row">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => act('approve')}
                  className="min-h-[44px] rounded-md bg-brand-primary px-4 py-2 text-sm font-semibold text-white hover:bg-brand-primary/90 disabled:opacity-60"
                >
                  {busy ? 'Working…' : 'Approve'}
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => setShowChanges((v) => !v)}
                  className="min-h-[44px] rounded-md border border-border bg-surface px-4 py-2 text-sm font-semibold text-text-main hover:bg-surface-secondary"
                >
                  Something&apos;s not right
                </button>
              </div>
              {showChanges && (
                <div className="mt-3 border-t border-border pt-3">
                  <label htmlFor="changes-note" className="mb-1 block text-sm font-medium text-text-main">
                    What needs changing?
                  </label>
                  <textarea
                    id="changes-note"
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    rows={3}
                    className="w-full rounded-md border border-border bg-surface px-3 py-2 text-text-main"
                  />
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => act('request-changes')}
                    className="mt-2 min-h-[44px] rounded-md bg-brand-primary px-4 py-2 text-sm font-semibold text-white hover:bg-brand-primary/90 disabled:opacity-60"
                  >
                    Send back for changes
                  </button>
                </div>
              )}
              {actionError && (
                <p role="alert" className="mt-2 text-sm text-status-error">
                  {actionError}
                </p>
              )}
            </>
          ) : (
            <p className="mt-3 text-sm text-text-secondary">Someone with approval rights on your account can approve this.</p>
          )}
        </section>
      )}

      {work.answers.length > 0 && (
        <details className="rounded-lg border border-border bg-surface p-5">
          <summary className="cursor-pointer font-semibold text-text-main">Your request</summary>
          <dl className="mt-3 space-y-3 text-sm">
            {work.answers.map((a) => (
              <div key={a.prompt}>
                <dt className="text-text-tertiary">{a.prompt}</dt>
                <dd className="whitespace-pre-wrap text-text-main">{a.value}</dd>
              </div>
            ))}
          </dl>
        </details>
      )}
    </div>
  );
}

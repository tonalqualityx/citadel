'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { RequestWorkButton } from '@/components/portal/request-work-button';
import { StatusChip } from '@/components/portal/ui/status-chip';
import type { ChipTone } from '@/lib/portal/status-labels';

// Retainer (portal phase B slice 2): one card per active or paused plan. The plan name, the
// period, what is in flight this period, the latest report, a plan waiting for approval, and the
// plan's allowance. Never hours used. Backed by GET /api/portal/retainer.

interface Item {
  id: string;
  title: string;
  state: { label: string; tone: ChipTone };
  site: { id: string; name: string } | null;
}
interface Card {
  id: string;
  heading: string;
  status: { label: string; tone: ChipTone };
  period: string;
  covers: string[];
  allowance: string | null;
  plan_ready: { task_id: string; title: string; preview_url: string; book_href: string } | null;
  this_month: { open: Item[]; done: Item[] };
  latest_report: { title: string; headline: string | null; period: string; url: string } | null;
}

const BOOK = '/portal/book?type=marketing';

function Items({ items }: { items: Item[] }) {
  return (
    <ul className="divide-y divide-border">
      {items.map((i) => (
        <li key={i.id} className="flex flex-col gap-1 py-3 sm:flex-row sm:items-center sm:justify-between">
          <Link
            href={`/portal/work/${i.id}`}
            className="font-medium text-text-main hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          >
            {i.title}
          </Link>
          <StatusChip label={i.state.label} tone={i.state.tone} />
        </li>
      ))}
    </ul>
  );
}

function RetainerCard({ card, onChanged }: { card: Card; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function approve(taskId: string) {
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch(`/api/portal/tasks/mine/${taskId}/approve`, { method: 'POST' });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setErr(body.error || 'Something went wrong. Please try again.');
        return;
      }
      onChanged();
    } catch {
      setErr('Something went wrong. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  const { open, done } = card.this_month;
  return (
    <article aria-labelledby={`plan-${card.id}`} className="space-y-5 rounded-lg border border-border bg-surface p-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id={`plan-${card.id}`} className="text-xl font-semibold text-text-main">
            {card.heading}
          </h2>
          <p className="mt-1 text-sm text-text-secondary">
            {card.period}
            {card.covers.length > 0 ? ` · Covers ${card.covers.join(', ')}` : ''}
          </p>
        </div>
        <StatusChip label={card.status.label} tone={card.status.tone} />
      </header>

      {card.plan_ready && (
        <section aria-label="Plan ready for you" className="rounded-md border border-border bg-surface-secondary p-4">
          <h3 className="font-semibold text-text-main">Plan ready for you</h3>
          <p className="mt-1 text-sm text-text-secondary">{card.plan_ready.title}</p>
          <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
            <a
              href={card.plan_ready.preview_url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex min-h-[44px] items-center justify-center rounded-md border border-border bg-surface px-4 py-2 text-sm font-semibold text-text-main hover:bg-surface-secondary"
            >
              Open the plan
            </a>
            <button
              type="button"
              disabled={busy}
              onClick={() => approve(card.plan_ready!.task_id)}
              className="min-h-[44px] rounded-md bg-brand-primary px-4 py-2 text-sm font-semibold text-white hover:bg-brand-primary/90 disabled:opacity-60"
            >
              {busy ? 'Approving…' : 'Approve the plan'}
            </button>
            <Link
              href={card.plan_ready.book_href || BOOK}
              className="inline-flex min-h-[44px] items-center justify-center rounded-md border border-border bg-surface px-4 py-2 text-sm font-semibold text-text-main hover:bg-surface-secondary"
            >
              Book a meeting
            </Link>
          </div>
          <p className="mt-2 text-sm text-text-tertiary">Approving here or by email both count.</p>
          {err && (
            <p role="alert" className="mt-2 text-sm text-status-error">
              {err}
            </p>
          )}
        </section>
      )}

      <section aria-labelledby={`month-${card.id}`}>
        <h3 id={`month-${card.id}`} className="font-semibold text-text-main">
          This month
        </h3>
        {open.length === 0 && done.length === 0 ? (
          <p className="mt-1 text-sm text-text-secondary">
            Nothing scheduled for this period yet. Your plan for next month will show here when it is ready.
          </p>
        ) : (
          <>
            {open.length > 0 && <Items items={open} />}
            {done.length > 0 && (
              <>
                <p className="mt-3 text-sm font-medium text-text-secondary">Finished this period</p>
                <Items items={done} />
              </>
            )}
          </>
        )}
      </section>

      <section aria-labelledby={`report-${card.id}`}>
        <h3 id={`report-${card.id}`} className="font-semibold text-text-main">
          Latest report
        </h3>
        {card.latest_report ? (
          <div className="mt-1 text-sm">
            <p className="text-text-main">{card.latest_report.title}</p>
            {card.latest_report.headline && <p className="mt-1 text-text-secondary">{card.latest_report.headline}</p>}
            <a
              href={card.latest_report.url}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-2 inline-block font-semibold text-brand-primary underline"
            >
              Read the report
            </a>
          </div>
        ) : (
          <p className="mt-1 text-sm text-text-secondary">Your first monthly report will show here.</p>
        )}
      </section>

      {card.allowance && <p className="text-sm text-text-secondary">{card.allowance}</p>}
    </article>
  );
}

export default function PortalRetainerPage() {
  const router = useRouter();
  const [cards, setCards] = useState<Card[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/portal/retainer');
      if (res.status === 401) {
        router.replace('/portal/login');
        return;
      }
      if (!res.ok) {
        setError('Failed to load your retainer');
        return;
      }
      setCards((await res.json()).retainers);
    } catch {
      setError('Failed to load your retainer');
    }
  }, [router]);

  useEffect(() => {
    load();
  }, [load]);

  if (error) {
    return (
      <div className="rounded-lg border border-border bg-surface p-8 text-center">
        <h2 className="mb-2 text-xl font-semibold text-text-main">Unable to load your retainer</h2>
        <p className="text-text-secondary">{error}</p>
      </div>
    );
  }
  if (!cards) return <div className="py-20 text-center text-text-secondary">Loading…</div>;

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <h1 className="text-2xl font-bold text-text-main">Retainer</h1>
        <RequestWorkButton prefill={{ type: 'marketing_question' }} />
      </header>

      {cards.length === 0 ? (
        <div className="rounded-lg border border-border bg-surface p-6">
          <p className="text-text-secondary">
            No retainer on your account. When you have one, your monthly plan, reports and the work in progress show here.
          </p>
          <p className="mt-4">
            <Link
              href={BOOK}
              className="inline-flex min-h-[44px] items-center justify-center rounded-md border border-border bg-surface px-4 py-2 text-sm font-semibold text-text-main hover:bg-surface-secondary"
            >
              Book a meeting
            </Link>
          </p>
        </div>
      ) : (
        cards.map((c) => <RetainerCard key={c.id} card={c} onChanged={load} />)
      )}
    </div>
  );
}

'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { RequestWorkButton } from '@/components/portal/request-work-button';

// Projects (portal phase B slice 2): every project the signed-in person may see, active first,
// then complete. Backed by GET /api/portal/projects. Each card links to the project page.

interface Item {
  id: string;
  name: string;
  status_label: string;
  progress: { done: number; total: number };
  next_milestone: { name: string; target_date: string | null } | null;
  target_date: string | null;
}

function formatDate(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

function Card({ p }: { p: Item }) {
  const pct = p.progress.total > 0 ? Math.round((p.progress.done / p.progress.total) * 100) : 0;
  const next = p.next_milestone
    ? `Next: ${p.next_milestone.name}${p.next_milestone.target_date ? `, ${formatDate(p.next_milestone.target_date)}` : ''}`
    : p.target_date
      ? `Target ${formatDate(p.target_date)}`
      : null;
  return (
    <li className="rounded-lg border border-border bg-surface p-5">
      <div className="flex items-start justify-between gap-4">
        <Link
          href={`/portal/projects/${p.id}`}
          className="text-lg font-semibold text-text-main hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
        >
          {p.name}
        </Link>
        <span className="shrink-0 rounded-full border border-border px-3 py-1 text-xs font-semibold text-text-main">{p.status_label}</span>
      </div>
      <p className="mt-2 text-sm text-text-secondary">
        {p.progress.total > 0 ? `${p.progress.done} of ${p.progress.total} complete` : 'No tasks to show yet'}
        {next ? ` · ${next}` : ''}
      </p>
      {p.progress.total > 0 && (
        <div
          className="mt-3 h-2 w-full overflow-hidden rounded-full bg-surface-secondary"
          role="progressbar"
          aria-valuenow={pct}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={`${p.name}: tasks complete`}
        >
          <div className="h-full bg-brand-primary" style={{ width: `${pct}%` }} />
        </div>
      )}
    </li>
  );
}

export default function PortalProjectsPage() {
  const router = useRouter();
  const [data, setData] = useState<{ active: Item[]; complete: Item[] } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/portal/projects');
        if (res.status === 401) {
          router.replace('/portal/login');
          return;
        }
        if (!res.ok) {
          if (!cancelled) setError('Failed to load your projects');
          return;
        }
        const payload = await res.json();
        if (!cancelled) setData(payload);
      } catch {
        if (!cancelled) setError('Failed to load your projects');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [router]);

  if (error) {
    return (
      <div className="rounded-lg border border-border bg-surface p-8 text-center">
        <h2 className="mb-2 text-xl font-semibold text-text-main">Unable to load your projects</h2>
        <p className="text-text-secondary">{error}</p>
      </div>
    );
  }
  if (!data) return <div className="py-20 text-center text-text-secondary">Loading…</div>;

  const none = data.active.length === 0 && data.complete.length === 0;

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <h1 className="text-2xl font-bold text-text-main">Projects</h1>
        <RequestWorkButton />
      </header>

      {none ? (
        <div className="rounded-lg border border-border bg-surface p-6">
          <p className="text-text-secondary">
            No projects right now. When we build something for you, its progress, approvals and history show here.
          </p>
        </div>
      ) : (
        <>
          {data.active.length > 0 && (
            <section aria-labelledby="active-heading" className="space-y-3">
              <h2 id="active-heading" className="text-lg font-semibold text-text-main">
                Active
              </h2>
              <ul className="space-y-3">
                {data.active.map((p) => (
                  <Card key={p.id} p={p} />
                ))}
              </ul>
            </section>
          )}
          {data.complete.length > 0 && (
            <section aria-labelledby="complete-heading" className="space-y-3">
              <h2 id="complete-heading" className="text-lg font-semibold text-text-main">
                Complete
              </h2>
              <ul className="space-y-3">
                {data.complete.map((p) => (
                  <Card key={p.id} p={p} />
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </div>
  );
}

'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { activityLabel, type ActivityType } from '@/lib/portal/status-labels';

// Client history (portal MVP A5): finished work and published articles, newest first, paged.
// Backed by GET /api/portal/history.

interface HistoryItem {
  type: ActivityType;
  id: string;
  title: string;
  url: string | null;
  project: { id: string; name: string } | null;
  at: string;
}

interface HistoryPayload {
  items: HistoryItem[];
  page: number;
  page_size: number;
  has_more: boolean;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

export default function ClientHistoryPage() {
  const router = useRouter();
  const [items, setItems] = useState<HistoryItem[]>([]);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (nextPage: number) => {
      try {
        const res = await fetch(`/api/portal/history?page=${nextPage}`);
        if (res.status === 401) {
          router.replace('/portal/login');
          return;
        }
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          setError(body.error || 'Failed to load your history');
          return;
        }
        const payload: HistoryPayload = await res.json();
        setItems((prev) => (nextPage === 1 ? payload.items : [...prev, ...payload.items]));
        setPage(payload.page);
        setHasMore(payload.has_more);
      } catch {
        setError('Failed to load your history');
      } finally {
        setLoading(false);
        setLoadingMore(false);
      }
    },
    [router]
  );

  useEffect(() => {
    load(1);
  }, [load]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="text-text-secondary">Loading…</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-surface rounded-lg border border-border p-8 text-center">
        <h2 className="text-xl font-semibold text-text-main mb-2">Unable to load your history</h2>
        <p className="text-text-secondary">{error}</p>
      </div>
    );
  }

  return (
    <div className="bg-surface rounded-lg border border-border p-6">
      <h2 className="text-2xl font-bold text-text-main mb-1">History</h2>
      <p className="text-sm text-text-tertiary mb-4">Finished work and published articles, newest first.</p>
      {items.length === 0 ? (
        <p className="text-sm text-text-tertiary">Nothing finished yet. Completed work will show up here.</p>
      ) : (
        <ul className="divide-y divide-border">
          {items.map((item) => (
            <li key={`${item.type}-${item.id}`} className="flex items-center justify-between gap-4 py-3 text-sm">
              <span className="text-text-main">
                {activityLabel(item.type)}: {item.title}
                {item.project && (
                  <>
                    {' '}
                    <Link href={`/portal/projects/${item.project.id}`} className="text-xs text-brand-primary hover:underline">
                      {item.project.name}
                    </Link>
                  </>
                )}
                {item.url && (
                  <>
                    {' '}
                    <a href={item.url} target="_blank" rel="noopener noreferrer" className="text-xs text-brand-primary hover:underline">
                      View
                    </a>
                  </>
                )}
              </span>
              <span className="shrink-0 text-xs text-text-tertiary">{formatDate(item.at)}</span>
            </li>
          ))}
        </ul>
      )}
      {hasMore && (
        <div className="mt-4">
          <button
            type="button"
            disabled={loadingMore}
            onClick={() => {
              setLoadingMore(true);
              load(page + 1);
            }}
            className="px-4 py-2 rounded-md border border-border text-text-main hover:bg-surface-secondary transition-colors disabled:opacity-60"
          >
            {loadingMore ? 'Loading…' : 'Show more'}
          </button>
        </div>
      )}
    </div>
  );
}

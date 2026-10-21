'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { RequestRow } from '@/components/portal/request-row';
import { RequestWorkButton } from '@/components/portal/request-work-button';
import type { RequestItem } from '@/lib/portal/requests';

// Requests (portal phase B slice 1): everything the client has asked for, wherever it is being
// handled. Attention first, then newest. Backed by GET /api/portal/requests.

type Item = Omit<RequestItem, 'created_at' | 'updated_at'> & { created_at: string; updated_at: string };

export default function PortalRequestsPage() {
  const router = useRouter();
  const [open, setOpen] = useState<Item[]>([]);
  const [closed, setClosed] = useState<Item[]>([]);
  const [sites, setSites] = useState<Array<{ id: string; name: string }>>([]);
  const [siteId, setSiteId] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (site: string) => {
      try {
        const res = await fetch(`/api/portal/requests${site ? `?site_id=${encodeURIComponent(site)}` : ''}`);
        if (res.status === 401) {
          router.replace('/portal/login');
          return;
        }
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          setError(body.error || 'Failed to load your requests');
          return;
        }
        const payload = await res.json();
        setOpen(payload.open);
        setClosed(payload.recently_closed);
        setError(null);
      } catch {
        setError('Failed to load your requests');
      } finally {
        setLoading(false);
      }
    },
    [router]
  );

  useEffect(() => {
    load('');
    fetch('/api/portal/intake/context')
      .then((r) => (r.ok ? r.json() : null))
      .then((c) => c && setSites(c.sites))
      .catch(() => undefined);
  }, [load]);

  if (loading) return <div className="py-20 text-center text-text-secondary">Loading…</div>;
  if (error) {
    return (
      <div className="rounded-lg border border-border bg-surface p-8 text-center">
        <h2 className="mb-2 text-xl font-semibold text-text-main">Unable to load your requests</h2>
        <p className="text-text-secondary">{error}</p>
      </div>
    );
  }

  const none = open.length === 0 && closed.length === 0 && !siteId;

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-text-main">
            {open.length === 0 ? 'No open requests' : `${open.length} open request${open.length === 1 ? '' : 's'}`}
          </h1>
          <p className="mt-1 text-text-secondary">Everything you have asked us for, wherever it is being handled.</p>
        </div>
        <RequestWorkButton />
      </header>

      {sites.length >= 2 && (
        <div>
          <label htmlFor="request-site" className="mb-1 block text-sm font-medium text-text-main">
            Site
          </label>
          <select
            id="request-site"
            value={siteId}
            onChange={(e) => {
              setSiteId(e.target.value);
              load(e.target.value);
            }}
            className="min-h-[44px] rounded-md border border-border bg-surface px-3 text-text-main"
          >
            <option value="">All sites</option>
            {sites.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </div>
      )}

      {none ? (
        <div className="rounded-lg border border-border bg-surface p-6">
          <p className="text-text-secondary">
            You have not sent any requests yet. Use Request work to ask for a change, a new page, an article, or help with something broken.
          </p>
        </div>
      ) : (
        <>
          {open.length > 0 && (
            <section aria-labelledby="open-heading" className="rounded-lg border border-border bg-surface px-5">
              <h2 id="open-heading" className="sr-only">
                Open requests
              </h2>
              <ul className="divide-y divide-border">
                {open.map((item) => (
                  <RequestRow key={item.id} item={item} />
                ))}
              </ul>
            </section>
          )}
          {closed.length > 0 && (
            <section aria-labelledby="closed-heading" className="rounded-lg border border-border bg-surface px-5 py-4">
              <h2 id="closed-heading" className="text-lg font-semibold text-text-main">
                Closed in the last 30 days
              </h2>
              <ul className="divide-y divide-border">
                {closed.map((item) => (
                  <RequestRow key={item.id} item={item} />
                ))}
              </ul>
              <p className="mt-3 text-sm text-text-tertiary">Older work is in History.</p>
            </section>
          )}
        </>
      )}
    </div>
  );
}

'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ChevronDown, Contrast, PenLine, TriangleAlert } from 'lucide-react';
import { RequestRow } from '@/components/portal/request-row';
import { RequestWorkButton } from '@/components/portal/request-work-button';
import { PageHeader } from '@/components/portal/ui/page-header';
import { Callout } from '@/components/portal/ui/callout';
import { EmptyState } from '@/components/portal/ui/empty-state';
import { Field } from '@/components/portal/ui/field';
import { Section } from '@/components/portal/ui/section';
import { SegmentedControl } from '@/components/portal/ui/segmented-control';
import { Skeleton, SkeletonRegion } from '@/components/portal/ui/skeleton';
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

  const none = open.length === 0 && closed.length === 0 && !siteId;
  const lede = 'Everything you have asked us for, wherever it is being handled.';

  if (loading) {
    return (
      <SkeletonRegion label="Loading your requests">
        <PageHeader title="Requests" size="page" lede={lede} motif="contours" />
        <div className="card">
          <Skeleton lines={4} />
        </div>
      </SkeletonRegion>
    );
  }
  if (error) {
    return (
      <>
        <PageHeader title="Requests" size="page" lede={lede} motif="contours" actions={<RequestWorkButton />} />
        <Callout tone="urgent" icon={TriangleAlert} title="We could not load your requests" id="requests-error">
          <p>{error}. Refresh the page to try again.</p>
        </Callout>
      </>
    );
  }

  const needsYou = open.filter((i) => i.state.tone === 'attention');
  const moving = open.filter((i) => i.state.tone !== 'attention');
  const siteOptions = [{ value: '', label: 'All sites' }, ...sites.map((s) => ({ value: s.id, label: s.name }))];
  const pickSite = (id: string) => {
    setSiteId(id);
    load(id);
  };

  return (
    <>
      <PageHeader
        title={open.length === 0 ? 'No open requests' : `${open.length} open request${open.length === 1 ? '' : 's'}`}
        size="page"
        lede={lede}
        motif="contours"
        actions={<RequestWorkButton />}
      />

      {sites.length >= 2 && sites.length <= 3 && <SegmentedControl label="Site" options={siteOptions} value={siteId} onChange={pickSite} />}
      {sites.length > 3 && (
        <Field id="request-site" label="Site">
          <select value={siteId} onChange={(e) => pickSite(e.target.value)}>
            <option value="">All sites</option>
            {sites.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </Field>
      )}

      {none ? (
        <EmptyState
          art="contours"
          title="No requests yet"
          body="You have not sent any requests yet. Use Request work to ask for a change, a new page, an article, or help with something broken."
        />
      ) : (
        <>
          {needsYou.length > 0 && (
            <Callout icon={PenLine} title="Needs you" count={needsYou.length} id="requests-needs-you">
              <ul className="rows">
                {needsYou.map((item) => (
                  <RequestRow key={item.id} item={item} />
                ))}
              </ul>
            </Callout>
          )}
          {moving.length > 0 && (
            <Section id="requests-moving" title="Moving" icon={Contrast} kind="request">
              <div className="card">
                <ul className="rows">
                  {moving.map((item) => (
                    <RequestRow key={item.id} item={item} />
                  ))}
                </ul>
              </div>
            </Section>
          )}
          {open.length === 0 && closed.length > 0 && (
            <div className="card">
              <p>Nothing is open right now.</p>
            </div>
          )}
          {open.length === 0 && closed.length === 0 && siteId && (
            <div className="card">
              <p>No requests for this site yet.</p>
            </div>
          )}
          {closed.length > 0 && (
            <details className="card fold">
              <summary>
                Closed in the last 30 days
                <ChevronDown className="i" aria-hidden="true" focusable="false" />
              </summary>
              <ul className="rows">
                {closed.map((item) => (
                  <RequestRow key={item.id} item={item} />
                ))}
              </ul>
              <p className="meta">Older work is in History.</p>
            </details>
          )}
        </>
      )}
    </>
  );
}

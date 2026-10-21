'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ChevronDown, TriangleAlert } from 'lucide-react';
import { PageHeader } from '@/components/portal/ui/page-header';
import { Callout } from '@/components/portal/ui/callout';
import { SegmentedControl } from '@/components/portal/ui/segmented-control';
import { MonthGroup } from '@/components/portal/ui/month-group';
import { PortalButton } from '@/components/portal/ui/button';
import { EmptyState } from '@/components/portal/ui/empty-state';
import { Skeleton, SkeletonRegion } from '@/components/portal/ui/skeleton';
import { TYPE_ICON, type HistoryType } from '@/components/portal/ui/icons';
import type { TimelineItem } from '@/components/portal/ui/timeline';
import { engagementText, type Engagement } from '@/lib/portal/engagement';
import { activityLabel, type ActivityType } from '@/lib/portal/status-labels';
import { groupByMonth, shortDate, monthKeyOf, monthLabel, type GroupableItem, type HistoryFilter } from '@/lib/portal/history-group';

// Client history (portal MVP A5, redesigned in slice 3): finished work and published articles,
// newest first, a month at a time, paged. Backed by GET /api/portal/history.

interface HistoryItem {
  type: ActivityType;
  id: string;
  title: string;
  url: string | null;
  project: { id: string; name: string } | null;
  engagement: Engagement | null;
  at: string;
}

interface HistoryPayload {
  items: HistoryItem[];
  page: number;
  page_size: number;
  has_more: boolean;
}

type Entry = GroupableItem & { item: HistoryItem };

const TYPE_OF: Record<ActivityType, HistoryType> = {
  task_completed: 'completed',
  task_approved: 'approved',
  article_published: 'published',
};

const FILTER_OPTIONS: { value: HistoryFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'site', label: 'Site work' },
  { value: 'article', label: 'Articles' },
  { value: 'approval', label: 'Your approvals' },
];

function swatch(label: string, kind: string) {
  return (
    <span className="k" key={label}>
      <span className="kind" data-kind={kind}>
        {label}
      </span>
    </span>
  );
}

function typeKey(label: string, type: HistoryType) {
  const Icon = TYPE_ICON[type];
  return (
    <span className="k" key={label}>
      <Icon className="i" aria-hidden="true" focusable="false" />
      {label}
    </span>
  );
}

function toEntry(item: HistoryItem): Entry {
  const e = item.engagement;
  return {
    id: `${item.type}-${item.id}`,
    type: item.type,
    at: item.at,
    kind: e ? e.kind : null,
    site: e && e.kind === 'request' && e.label !== 'Request' ? e.label : null,
    item,
  };
}

export default function ClientHistoryPage() {
  const router = useRouter();
  const [items, setItems] = useState<HistoryItem[]>([]);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<HistoryFilter>('all');
  const [site, setSite] = useState('');
  const [sites, setSites] = useState<Array<{ id: string; name: string }>>([]);

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
    fetch('/api/portal/intake/context')
      .then((r) => (r.ok ? r.json() : null))
      .then((c) => c && Array.isArray(c.sites) && setSites(c.sites))
      .catch(() => undefined);
  }, [load]);

  const entries = useMemo(() => items.map(toEntry), [items]);
  const groups = useMemo(() => groupByMonth(entries, new Date(), { filter, site: site || null }), [entries, filter, site]);

  if (loading) {
    return (
      <SkeletonRegion label="Loading your history">
        <PageHeader title="What we have finished together" size="page" motif="river" />
        <Skeleton block lines={3} />
        <Skeleton block lines={3} />
      </SkeletonRegion>
    );
  }

  if (error) {
    return (
      <>
        <PageHeader title="What we have finished together" size="page" motif="river" />
        <Callout tone="urgent" icon={TriangleAlert} title="We could not load your history" id="history-error">
          <p className="note">{error}. Please refresh the page. If it keeps happening, tell us and we will look into it.</p>
        </Callout>
      </>
    );
  }

  const oldest = groups.length > 0 ? groups[groups.length - 1].key : null;
  const nowYear = monthKeyOf(new Date())?.slice(0, 4);
  let since = '';
  if (oldest) {
    const label = monthLabel(oldest);
    since = oldest.slice(0, 4) === nowYear ? label.split(' ')[0] : label;
  }
  const lede =
    items.length === 0
      ? 'Newest first, a month at a time.'
      : `Newest first, a month at a time. ${items.length} ${items.length === 1 ? 'thing' : 'things'} since ${since}.`;

  return (
    <>
      <PageHeader eyebrow={['History']} title="What we have finished together" size="page" lede={lede} motif="river" />

      {items.length === 0 ? (
        <EmptyState art="river" title="Nothing finished yet" body="Nothing finished yet. Completed work will show up here." />
      ) : (
        <>
          <div className="key" role="group" aria-label="How to read the timeline">
            {swatch('Project', 'project')}
            {swatch('Retainer', 'retainer')}
            {swatch('Request', 'request')}
            <span className="sep" aria-hidden="true" />
            {typeKey('Completed', 'completed')}
            {typeKey('You approved', 'approved')}
            {typeKey('Published', 'published')}
            {typeKey('Milestone', 'milestone')}
          </div>

          <div className="filters">
            <SegmentedControl label="Show" options={FILTER_OPTIONS} value={filter} onChange={(v) => setFilter(v as HistoryFilter)} />
            {sites.length >= 2 && (
              <label htmlFor="history-site">
                Site
                <select id="history-site" value={site} onChange={(e) => setSite(e.target.value)}>
                  <option value="">All sites</option>
                  {sites.map((s) => (
                    <option key={s.id} value={s.name}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>

          <div style={{ display: 'grid', gap: 16 }}>
            {groups.map((g) => {
              const timeline: TimelineItem[] = g.items.map((e) => {
                const it = (e as Entry).item;
                return {
                  id: `${it.type}-${it.id}`,
                  kind: e.kind ?? 'retainer',
                  type: TYPE_OF[it.type],
                  title: it.title,
                  what: activityLabel(it.type),
                  at: shortDate(it.at),
                  kindLabel: it.engagement ? engagementText(it.engagement) : undefined,
                  href: it.url,
                };
              });
              return (
                <MonthGroup
                  key={`${g.key}-${filter}-${site}`}
                  monthKey={g.key}
                  label={g.label}
                  summary={g.summary}
                  byKind={g.byKind}
                  items={timeline}
                  defaultOpen={g.defaultOpen}
                />
              );
            })}
          </div>

          {hasMore && (
            <div className="actions">
              <PortalButton
                variant="secondary"
                icon={ChevronDown}
                disabled={loadingMore}
                onClick={() => {
                  setLoadingMore(true);
                  load(page + 1);
                }}
              >
                {loadingMore ? 'Getting earlier months' : 'Show earlier months'}
              </PortalButton>
            </div>
          )}
        </>
      )}
    </>
  );
}

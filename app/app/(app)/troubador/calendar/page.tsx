'use client';

import * as React from 'react';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { Select } from '@/components/ui/select';
import { Spinner } from '@/components/ui/spinner';
import { EmptyState } from '@/components/ui/empty-state';
import { useSites } from '@/lib/hooks/use-sites';
import { useTroubadorCalendar } from '@/lib/hooks/use-troubador';
import { ArticleStatusBadge } from '@/components/domain/troubador/ArticleStatusBadge';
import type { CalendarEntry } from '@/lib/types/troubador';

function formatDateKey(value: string): string {
  const parts = value.split('T')[0].split('-');
  if (parts.length !== 3) return value;
  const d = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
  return d.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

export default function CalendarPage() {
  const [siteId, setSiteId] = React.useState('');

  const { data: sitesData } = useSites({ limit: 200 });
  const siteOptions = (sitesData?.sites ?? []).map((s) => ({
    value: s.id,
    label: s.name,
  }));

  const { data, isLoading, isError } = useTroubadorCalendar(siteId);

  const grouped = React.useMemo(() => {
    const map = new Map<string, CalendarEntry[]>();
    for (const entry of data?.entries ?? []) {
      const key = entry.date.split('T')[0];
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(entry);
    }
    return Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [data]);

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/troubador"
          className="inline-flex items-center gap-1 text-sm text-text-sub hover:text-text-main transition-colors mb-1"
        >
          <ArrowLeft className="h-4 w-4" /> Board
        </Link>
        <h1 className="text-2xl font-semibold text-text-main">Publishing Calendar</h1>
      </div>

      <div className="w-72">
        <Select
          label="Site"
          value={siteId}
          onChange={setSiteId}
          options={siteOptions}
          placeholder="Select a site"
        />
      </div>

      {!siteId ? (
        <EmptyState
          title="Select a site"
          description="Choose a site to view its publishing calendar."
        />
      ) : isLoading ? (
        <div className="flex justify-center py-12">
          <Spinner size="md" />
        </div>
      ) : isError ? (
        <div className="text-center py-12 text-text-sub text-sm">
          Failed to load calendar.
        </div>
      ) : grouped.length === 0 ? (
        <EmptyState
          title="Nothing scheduled"
          description="No articles are scheduled to publish for this site yet."
        />
      ) : (
        <div className="space-y-6">
          {grouped.map(([date, entries]) => (
            <div key={date}>
              <h2 className="text-sm font-semibold text-text-main mb-2">
                {formatDateKey(date)}
              </h2>
              <div className="space-y-2">
                {entries.map((entry) => (
                  <div
                    key={entry.article_id}
                    className="flex items-center justify-between gap-3 rounded-lg border border-border-warm bg-surface p-3"
                  >
                    <div className="min-w-0">
                      <p className="font-medium text-text-main truncate">
                        {entry.title}
                      </p>
                      <Link
                        href={`/troubador/runs/${entry.run_id}`}
                        className="text-xs text-text-sub hover:text-primary transition-colors"
                      >
                        View run
                      </Link>
                    </div>
                    <ArticleStatusBadge status={entry.status} />
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

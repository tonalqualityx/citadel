'use client';

import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import type { Run } from '@/lib/types/troubador';

export function RunCard({ run }: { run: Run }) {
  const stats = run.article_stats;
  const needsReview = stats?.in_review ?? 0;

  return (
    <Link
      href={`/troubador/runs/${run.id}`}
      className="block rounded-lg border border-border-warm bg-surface p-3 text-sm shadow-soft transition-shadow hover:shadow-sm"
    >
      <div className="flex items-start justify-between gap-2">
        <span className="text-xs text-text-sub truncate" title={run.client?.name}>
          {run.client?.name ?? 'Unknown client'}
        </span>
        {needsReview > 0 && (
          <Badge variant="warning" size="sm" className="shrink-0">
            {needsReview} need review
          </Badge>
        )}
      </div>

      <div className="mt-1 font-medium text-text-main line-clamp-2">
        {run.title}
      </div>

      <div className="mt-2 flex items-center justify-between gap-2 text-xs text-text-sub">
        <span className="truncate" title={run.site?.name}>
          {run.site?.name ?? '—'}
        </span>
        {run.assignee && (
          <span className="truncate max-w-[90px]" title={run.assignee.name}>
            {run.assignee.name.split(' ')[0]}
          </span>
        )}
      </div>

      {stats && stats.total > 0 && (
        <div className="mt-2 flex items-center gap-2 text-[0.625rem] text-text-sub">
          <span>{stats.published}/{stats.total} published</span>
          {stats.approved > 0 && <span>· {stats.approved} approved</span>}
          {stats.scheduled > 0 && <span>· {stats.scheduled} scheduled</span>}
        </div>
      )}
    </Link>
  );
}

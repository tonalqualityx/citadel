import Link from 'next/link';
import { StatusChip } from '@/components/portal/ui/status-chip';
import { EngagementChip } from '@/components/portal/ui/engagement-chip';
import type { RequestItem } from '@/lib/portal/requests';

function formatDate(iso: Date | string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

// One request in a list: title (a link to the work page), state, engagement and last update.
// `item` is the client-safe shape from GET /api/portal/requests.
export function RequestRow({ item }: { item: Omit<RequestItem, 'created_at' | 'updated_at'> & { updated_at: string } }) {
  return (
    <li className="flex flex-col gap-2 py-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <Link
          href={`/portal/work/${item.id}`}
          className="font-medium text-text-main hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
        >
          {item.title}
        </Link>
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <EngagementChip engagement={item.engagement} />
          <span className="text-xs text-text-tertiary">Updated {formatDate(item.updated_at)}</span>
        </div>
      </div>
      <StatusChip label={item.state.label} tone={item.state.tone} />
    </li>
  );
}

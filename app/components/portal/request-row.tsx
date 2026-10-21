import Link from 'next/link';
import { StatusChip } from '@/components/portal/ui/status-chip';
import { EngagementChip } from '@/components/portal/ui/engagement-chip';
import { SiteMark } from '@/components/portal/ui/site-mark';
import type { RequestItem } from '@/lib/portal/requests';

function formatDate(iso: Date | string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

// One request in a list: title (a link to the work page), state, engagement, site and last update.
// `item` is the client-safe shape from GET /api/portal/requests. Render inside a <ul className="rows">.
export function RequestRow({ item }: { item: Omit<RequestItem, 'created_at' | 'updated_at'> & { updated_at: string } }) {
  return (
    <li className="req-row">
      <span className="t">
        <Link href={`/portal/work/${item.id}`}>{item.title}</Link>
      </span>
      <StatusChip label={item.state.label} tone={item.state.tone} />
      <div className="meta">
        <EngagementChip engagement={item.engagement} />
        {item.site ? <SiteMark name={item.site.name} /> : null}
        <span>Updated {formatDate(item.updated_at)}</span>
      </div>
    </li>
  );
}

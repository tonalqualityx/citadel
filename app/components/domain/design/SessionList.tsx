'use client';

import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import type { SessionListItem } from '@/lib/hooks/use-design';

export function SessionList({ sessions }: { sessions: SessionListItem[] }) {
  if (sessions.length === 0) {
    return <p className="text-sm text-text-sub">No sessions yet.</p>;
  }
  return (
    <ul className="divide-y divide-border-warm rounded-lg border border-border-warm bg-surface">
      {sessions.map((s) => (
        <li key={s.id}>
          <Link href={`/design/s/${s.id}`} className="flex min-h-[44px] items-center justify-between gap-3 px-4 py-2 hover:bg-background-light">
            <span className="min-w-0">
              <span className="block truncate text-sm text-text-main">{s.task.title}</span>
              <span className="block text-xs text-text-sub">{s.site.name}</span>
            </span>
            <Badge size="sm">{s.status.replace(/_/g, ' ')}</Badge>
          </Link>
        </li>
      ))}
    </ul>
  );
}

'use client';

import { CheckCircle2, Circle, CircleDot, MinusCircle } from 'lucide-react';
import type { PlanItem } from '@/lib/design/feed-reducer';

const ICONS = {
  pending: { Icon: Circle, label: 'To do' },
  in_progress: { Icon: CircleDot, label: 'In progress' },
  completed: { Icon: CheckCircle2, label: 'Done' },
  canceled: { Icon: MinusCircle, label: 'Dropped' },
} as const;

// The worker's latest plan (the newest `plan` event replaces the whole list).
export function PlanChecklist({ items }: { items: PlanItem[] | null }) {
  if (!items || items.length === 0) return null;
  const done = items.filter((i) => i.status === 'completed').length;
  return (
    <section aria-label="Plan" className="rounded-lg border border-border-warm bg-surface px-3 py-2">
      <h3 className="mb-1 text-xs font-medium text-text-sub">Plan ({done} of {items.length} done)</h3>
      <ul className="space-y-1">
        {items.map((item, i) => {
          const { Icon, label } = ICONS[item.status];
          return (
            <li key={`${i}-${item.text}`} className="flex items-start gap-2 text-sm" data-status={item.status}>
              <Icon className="mt-0.5 h-4 w-4 shrink-0 text-text-sub" aria-hidden="true" />
              <span className="sr-only">{label}: </span>
              <span className={item.status === 'completed' || item.status === 'canceled' ? 'text-text-sub line-through' : 'text-text-main'}>{item.text}</span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

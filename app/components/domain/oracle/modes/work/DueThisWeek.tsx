'use client';

import * as React from 'react';
import Link from 'next/link';
import { useTaskPeek } from '@/lib/contexts/task-peek-context';
import { DEFAULT_DISPLAY_TIMEZONE } from '@/lib/timezone';
import type { DueRow, RitualBlocks } from '@/lib/waits/ritual-blocks';

interface DueThisWeekProps {
  block: RitualBlocks['due_this_week'] | undefined;
}

// Wait record phase 1 — Mike's other waits and his tasks due in the next 7 days, by date, seven
// rows then "N more". Date only: no "overdue" word and no count, per the no-time-guilt rule for
// internal targets. Each title is the one button (opens the task or the project). Empty renders
// nothing.
function formatDue(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    timeZone: DEFAULT_DISPLAY_TIMEZONE,
  });
}

function Title({ row }: { row: DueRow }) {
  const { openTaskPeek } = useTaskPeek();
  const a = row.action;
  const cls = 'min-w-0 truncate text-left text-sm text-text-main hover:text-primary hover:underline';
  if (a.type === 'task') {
    return (
      <button type="button" onClick={() => openTaskPeek(a.id)} className={cls} data-testid="due-row-action">
        {row.title}
      </button>
    );
  }
  if (a.type === 'project') {
    return (
      <Link href={`/projects/${a.id}`} className={cls} data-testid="due-row-action">
        {row.title}
      </Link>
    );
  }
  return <span className="min-w-0 truncate text-sm text-text-main">{row.title}</span>;
}

export function DueThisWeek({ block }: DueThisWeekProps) {
  if (!block || block.total === 0) return null;
  return (
    <section className="flex flex-col gap-1.5" data-testid="due-this-week" aria-label="Due this week">
      <h2 className="text-base font-semibold text-text-main">Due this week</h2>
      <ul className="flex flex-col gap-1">
        {block.rows.map((row) => (
          <li key={`${row.type}-${row.id}`} className="flex items-center justify-between gap-3 px-1 py-1" data-testid="due-row">
            <Title row={row} />
            <span className="shrink-0 text-xs text-text-sub">
              {row.client ? `${row.client.name} · ` : ''}
              {formatDue(row.due_at)}
            </span>
          </li>
        ))}
      </ul>
      {block.more > 0 && (
        <p className="px-1 text-xs text-text-sub" data-testid="due-more">
          and {block.more} more
        </p>
      )}
    </section>
  );
}

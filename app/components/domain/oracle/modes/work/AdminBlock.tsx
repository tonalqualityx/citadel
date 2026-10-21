'use client';

import * as React from 'react';
import { useTaskPeek } from '@/lib/contexts/task-peek-context';
import type { RitualBlocks } from '@/lib/waits/ritual-blocks';

interface AdminBlockProps {
  block: RitualBlocks['admin'] | undefined;
}

// Wait record phase 1 — admin and ad-hoc work (the existing /api/oracle/admin-soon filter), five
// rows, so it never competes with client rows. Each title opens the task. Empty renders nothing.
export function AdminBlock({ block }: AdminBlockProps) {
  const { openTaskPeek } = useTaskPeek();
  if (!block || block.total === 0) return null;
  return (
    <section className="flex flex-col gap-1.5" data-testid="admin-block" aria-label="Admin">
      <h2 className="text-base font-semibold text-text-main">Admin</h2>
      <ul className="flex flex-col gap-1">
        {block.rows.map((row) => (
          <li key={row.id} className="flex items-center justify-between gap-3 px-1 py-1" data-testid="admin-row">
            <button
              type="button"
              onClick={() => openTaskPeek(row.id)}
              className="min-w-0 truncate text-left text-sm text-text-main hover:text-primary hover:underline"
              data-testid="admin-row-action"
            >
              {row.title}
            </button>
            {row.client && <span className="shrink-0 text-xs text-text-sub">{row.client.name}</span>}
          </li>
        ))}
      </ul>
      {block.more > 0 && (
        <p className="px-1 text-xs text-text-sub" data-testid="admin-more">
          and {block.more} more
        </p>
      )}
    </section>
  );
}

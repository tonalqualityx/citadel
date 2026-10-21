'use client';

import * as React from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { useTaskPeek } from '@/lib/contexts/task-peek-context';
import { useUpdateWait } from '@/lib/hooks/use-waits';
import type { BlockingRow, RitualBlocks } from '@/lib/waits/ritual-blocks';

interface BlockingTodayProps {
  blocks: RitualBlocks['blocking_today'] | undefined;
}

// Wait record phase 1 (specs/citadel-shape-SPEC.md 4.2) — the first block under the signals
// rail: waits on Mike that are holding a client up, due today or earlier. Project approvals
// first, then the longest client wait; five rows, then "and N more". Each row carries ONE
// button, because a row with no action is noise (oracle-what-mike-actually-uses). Empty
// renders nothing at all. Nothing here reads the focus flag.
function RowAction({ row }: { row: BlockingRow }) {
  const { openTaskPeek } = useTaskPeek();
  const update = useUpdateWait();
  const a = row.action;
  if (a.type === 'task') {
    return (
      <Button variant="secondary" size="sm" onClick={() => openTaskPeek(a.id)} data-testid="blocking-row-action">
        Open task
      </Button>
    );
  }
  if (a.type === 'project' || (a.type === 'approval' && row.project_id)) {
    const projectId = a.type === 'project' ? a.id : row.project_id;
    return (
      <Button variant="secondary" size="sm" asChild data-testid="blocking-row-action">
        <Link href={`/projects/${projectId}`}>{a.type === 'approval' ? 'Open approval' : 'Open project'}</Link>
      </Button>
    );
  }
  // A wait with no task or project behind it (a plain gate or handoff): the action is closing it.
  const approval = row.kind === 'approval';
  return (
    <Button
      variant="secondary"
      size="sm"
      disabled={update.isPending}
      onClick={() =>
        update.mutate({ id: row.id, patch: { action: 'resolve', resolution: approval ? 'approved' : 'completed' } })
      }
      data-testid="blocking-row-action"
    >
      {approval ? 'Approved' : 'Mark done'}
    </Button>
  );
}

function Row({ row }: { row: BlockingRow }) {
  return (
    <li
      className="flex items-center justify-between gap-3 rounded-lg border border-border-warm bg-surface px-3 py-2"
      data-testid="blocking-row"
      data-countdown={row.countdown ? 'true' : 'false'}
    >
      <div className="min-w-0">
        <p className="truncate text-sm font-medium text-text-main">{row.title}</p>
        <p className="truncate text-xs text-text-sub">
          {row.client ? `${row.client.name} · ` : ''}
          {row.label}
        </p>
      </div>
      <RowAction row={row} />
    </li>
  );
}

export function BlockingToday({ blocks }: BlockingTodayProps) {
  const [expanded, setExpanded] = React.useState(false);
  if (!blocks || blocks.total === 0) return null;

  return (
    <section className="flex flex-col gap-2" data-testid="blocking-today" aria-label="Blocking today">
      <h2 className="text-lg font-semibold text-text-main">Blocking today</h2>
      <ul className="flex flex-col gap-1.5">
        {blocks.rows.map((row) => (
          <Row key={row.id} row={row} />
        ))}
        {expanded && blocks.overflow.map((row) => <Row key={row.id} row={row} />)}
      </ul>
      {blocks.more > 0 && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="self-start text-xs text-text-sub hover:text-text-main hover:underline"
          aria-expanded={expanded}
          data-testid="blocking-more"
        >
          {expanded ? 'Show fewer' : `and ${blocks.more} more blocking a client`}
        </button>
      )}
    </section>
  );
}

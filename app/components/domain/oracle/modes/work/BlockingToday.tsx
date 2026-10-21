'use client';

import * as React from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { useTaskPeek } from '@/lib/contexts/task-peek-context';
import { useUpdateWait } from '@/lib/hooks/use-waits';
import type { BlockingRow, RitualBlocks } from '@/lib/waits/ritual-blocks';

interface BlockingTodayProps {
  blocks: RitualBlocks['blocking_today'] | undefined;
  /** Fetches the next page of overflow rows (after `offset` already loaded). */
  onLoadMore?: (offset: number) => Promise<BlockingRow[]>;
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
  // A wait with no task or project behind it. A plain gate is approved here; a wait that sits
  // on an approval request is only marked handled, because this button does not resolve the
  // request itself and must not claim it did.
  const onApprovalRequest = a.type === 'approval';
  const approval = row.kind === 'approval' && !onApprovalRequest;
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
      {approval ? 'Approved' : onApprovalRequest ? 'Mark handled' : 'Mark done'}
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

/** "and N more" opens this many rows per click, so a long list never becomes a wall. */
export const MORE_PAGE_SIZE = 5;

export function BlockingToday({ blocks, onLoadMore }: BlockingTodayProps) {
  const [extra, setExtra] = React.useState(0);
  const [fetched, setFetched] = React.useState<BlockingRow[]>([]);
  const [loading, setLoading] = React.useState(false);

  // A fresh response starts the list over.
  React.useEffect(() => {
    setExtra(0);
    setFetched([]);
  }, [blocks]);

  if (!blocks || blocks.total === 0) return null;

  const loaded = [...blocks.overflow, ...fetched];
  const remaining = blocks.more - extra;

  async function showMore() {
    if (!blocks) return;
    const next = extra + MORE_PAGE_SIZE;
    // Reached the end of what is loaded but the server has more: fetch the next 50.
    if (next > loaded.length && loaded.length < blocks.more && onLoadMore) {
      setLoading(true);
      try {
        const rows = await onLoadMore(loaded.length);
        const seen = new Set(loaded.map((r) => r.id));
        setFetched((f) => [...f, ...rows.filter((r) => !seen.has(r.id))]);
      } catch {
        // Leave the list as it is; the button stays so Mike can try again.
        setLoading(false);
        return;
      }
      setLoading(false);
    }
    setExtra(next);
  }

  return (
    <section className="flex flex-col gap-2" data-testid="blocking-today" aria-label="Blocking today">
      <h2 className="text-lg font-semibold text-text-main">Blocking today</h2>
      <ul className="flex flex-col gap-1.5">
        {blocks.rows.map((row) => (
          <Row key={row.id} row={row} />
        ))}
        {loaded.slice(0, extra).map((row) => <Row key={row.id} row={row} />)}
      </ul>
      {remaining > 0 && (
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={showMore}
            disabled={loading}
            className="text-xs text-text-sub hover:text-text-main hover:underline"
            data-testid="blocking-more"
          >
            and {remaining} more blocking a client
          </button>
        </div>
      )}
      {extra > 0 && (
        <button
          type="button"
          onClick={() => setExtra(0)}
          className="self-start text-xs text-text-sub hover:text-text-main hover:underline"
          data-testid="blocking-fewer"
        >
          Show fewer
        </button>
      )}
    </section>
  );
}

'use client';

import * as React from 'react';
import { Link2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tooltip } from '@/components/ui/tooltip';
import { useArcs } from '@/lib/hooks/use-arcs';
import { useTasks } from '@/lib/hooks/use-tasks';
import { useAttachEmailAsk } from '@/lib/hooks/use-email-asks';
import { attachPickerResults } from './intake-drawer-logic';

interface IntakeAttachPickerProps {
  askId: string;
}

// Clarity Phase 3 (Seeing Stone Reckoning, spec Q4/Q11) — the intake drawer's per-item
// "Attach to…": a two-click search-select over open arcs and open tasks. Click one
// (reveal the search box) + click two (pick the result) attaches — the ask leaves the
// drawer immediately (state=handled, server-side). Data only loads once revealed
// (`enabled: open`), so the common case (never opened) costs nothing extra.
export function IntakeAttachPicker({ askId }: IntakeAttachPickerProps) {
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState('');
  const { data: arcsData } = useArcs('open', { enabled: open });
  const { data: tasksData } = useTasks({ active_only: true, limit: 30 }, { enabled: open });
  const attach = useAttachEmailAsk();

  const results = React.useMemo(
    () => attachPickerResults(arcsData?.arcs ?? [], tasksData?.tasks ?? [], query),
    [arcsData, tasksData, query]
  );

  function select(kind: 'arc' | 'task', id: string) {
    attach.mutate({ id: askId, data: kind === 'arc' ? { arc_id: id } : { task_id: id } });
    setOpen(false);
    setQuery('');
  }

  if (!open) {
    return (
      <Tooltip content="Attach this email to an existing arc or task — it leaves this list once attached">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setOpen(true)}
          data-testid="intake-attach-trigger"
        >
          <Link2 className="h-3.5 w-3.5" aria-hidden="true" />
          Attach to…
        </Button>
      </Tooltip>
    );
  }

  return (
    <div
      className="flex w-full flex-col gap-1 rounded border border-border-warm bg-surface p-1.5"
      data-testid="intake-attach-picker"
    >
      <input
        autoFocus
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search open arcs or tasks…"
        className="rounded border border-border-warm bg-surface px-2 py-1 text-xs text-text-main placeholder:text-text-sub"
        data-testid="intake-attach-search"
      />
      <div className="flex max-h-40 flex-col gap-0.5 overflow-y-auto">
        {results.length === 0 && (
          <p className="px-1 py-1 text-xs text-text-sub">No open arcs or tasks match.</p>
        )}
        {results.map((r) => (
          <button
            key={`${r.kind}-${r.id}`}
            type="button"
            onClick={() => select(r.kind, r.id)}
            disabled={attach.isPending}
            className="flex items-center justify-between gap-2 rounded px-1.5 py-1 text-left text-xs hover:bg-background-light"
            data-testid="intake-attach-option"
            data-kind={r.kind}
          >
            <span className="truncate text-text-main">{r.label}</span>
            <span className="shrink-0 text-[0.625rem] uppercase text-text-sub">{r.kind}</span>
          </button>
        ))}
      </div>
      <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>
        Cancel
      </Button>
    </div>
  );
}

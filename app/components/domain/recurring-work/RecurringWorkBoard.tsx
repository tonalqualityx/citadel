'use client';

import * as React from 'react';
import { ChevronRight } from 'lucide-react';
import { EmptyState } from '@/components/ui/empty-state';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils/cn';
import { StateMark } from '@/components/domain/initiatives/StateMark';
import { monthDay, type StateMarkInfo } from '@/components/domain/initiatives/format';
import type { GroupedRecurringWork, RecurringWorkGroup } from '@/lib/hooks/use-recurring-work';
import type { RecurringWorkItem } from '@/types/entities';

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

const isStopped = (r: RecurringWorkItem) => r.last_run_ok === false && !r.paused_on_purpose;

/** A row's state mark: the last run, in shape and word. Paused on purpose is not shown as a mark (it reads in gray). */
export function runMark(r: RecurringWorkItem): StateMarkInfo {
  const when = monthDay(r.last_run_at);
  if (isStopped(r)) return { shape: '◐', word: when ? `stopped ${when}` : 'stopped', tone: 'attention' };
  if (r.last_run_at) return { shape: '●', word: `ran ${when}`, tone: 'on' };
  return { shape: '○', word: 'not run yet', tone: 'quiet' };
}

export interface BoardView {
  groups: RecurringWorkGroup[];
  /** Background rows that are running fine, kept out of the main list. */
  quiet: RecurringWorkItem[];
  readCount: number;
  stoppedCount: number;
  backgroundRunning: number;
}

/** The API's groups, minus the background rows that are running (a stopped background row stays in its group). */
export function boardView(data: GroupedRecurringWork): BoardView {
  const quiet: RecurringWorkItem[] = [];
  const groups: RecurringWorkGroup[] = [];
  for (const g of data.groups) {
    const rows = g.rows.filter((r) => {
      if (r.is_plumbing && !isStopped(r)) {
        quiet.push(r);
        return false;
      }
      return true;
    });
    if (rows.length) groups.push({ label: g.label, count: rows.length, stopped: rows.filter(isStopped).length, rows });
  }
  return {
    groups,
    quiet,
    readCount: groups.reduce((n, g) => n + g.rows.filter((r) => !r.is_plumbing).length, 0),
    stoppedCount: groups.reduce((n, g) => n + g.stopped, 0),
    backgroundRunning: quiet.length,
  };
}

export function headerLine(v: BoardView): string {
  return `${v.readCount} you read · ${v.stoppedCount} stopped · ${plural(v.backgroundRunning, 'background job', 'background jobs')} running`;
}

function Row({ r }: { r: RecurringWorkItem }) {
  const when = r.schedule_text || r.cadence;
  return (
    <li className="flex flex-wrap items-baseline gap-x-4 gap-y-1 px-4 py-3" data-testid="recurring-row">
      <span className="min-w-0 flex-1 basis-64 font-medium text-text-main">
        {r.title ?? 'Untitled'}
        {r.initiative ? (
          <Badge variant="default" size="sm" className="ml-2 align-middle" data-testid="initiative-tag">
            {r.initiative.name}
          </Badge>
        ) : null}
      </span>
      <span className="w-24 text-sm text-text-sub">{r.owner?.name ?? 'No owner'}</span>
      <span className="w-48 text-sm text-text-sub">{when ?? ''}</span>
      <span className="min-w-0 flex-1 basis-64 text-sm text-text-sub">{r.produces ? `makes: ${r.produces}` : ''}</span>
      <span className="w-40 text-sm">
        {r.paused_on_purpose ? (
          <span className="text-text-muted" data-testid="paused-note">
            paused on purpose
          </span>
        ) : (
          <StateMark mark={runMark(r)} />
        )}
      </span>
    </li>
  );
}

export function RecurringWorkBoard({ data }: { data: GroupedRecurringWork }) {
  const [open, setOpen] = React.useState(false);
  const view = boardView(data);
  if (view.groups.length === 0 && view.quiet.length === 0) {
    return <EmptyState title="Nothing recurring yet" description="Work that repeats, on the machine or in Citadel, shows here once it is set up." />;
  }
  return (
    <div className="space-y-4" data-testid="recurring-work-board">
      <div>
        <p className="text-sm text-text-sub">Everything that repeats, who answers for it, and what it makes.</p>
        <p className="text-sm text-text-sub" data-testid="recurring-counts">
          {headerLine(view)}
        </p>
      </div>
      {view.groups.map((g) => (
        <section key={g.label} data-testid="recurring-group">
          <h3 className="mb-1 text-sm font-medium text-text-main">
            {g.label} ({g.count})
          </h3>
          <ul className="divide-y divide-border rounded-lg border border-border-warm bg-surface shadow-soft">
            {g.rows.map((r) => (
              <Row key={r.id} r={r} />
            ))}
          </ul>
        </section>
      ))}
      {view.quiet.length > 0 ? (
        <div>
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            aria-expanded={open}
            className="flex items-center gap-1 text-sm text-text-sub hover:text-text-main focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            data-testid="background-toggle"
          >
            <ChevronRight className={cn('h-4 w-4 transition-transform', open && 'rotate-90')} aria-hidden />
            {plural(view.quiet.length, 'background job', 'background jobs')}: all running
          </button>
          {open ? (
            <ul className="mt-2 divide-y divide-border rounded-lg border border-border-warm bg-surface" data-testid="background-list">
              {view.quiet.map((r) => (
                <li key={r.id} className="flex flex-wrap items-baseline gap-x-4 px-4 py-2 text-sm">
                  <span className="flex-1 basis-64 text-text-main">{r.title ?? 'Untitled'}</span>
                  <span className="text-text-sub">{r.schedule_text ?? ''}</span>
                  <span className="text-text-muted">{r.paused_on_purpose ? 'paused on purpose' : r.last_run_at ? `ran ${monthDay(r.last_run_at)}` : 'not run yet'}</span>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

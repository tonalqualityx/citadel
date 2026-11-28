'use client';

import * as React from 'react';
import { ChevronRight } from 'lucide-react';
import { EmptyState } from '@/components/ui/empty-state';
import { Badge } from '@/components/ui/badge';
import { Select } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { destinationWords, filterRows, lastUsedText, sortRows, usageText, type RecurringSort } from '@/lib/recurring-work/board-logic';
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

const PRIORITY_OPTIONS = [
  { value: 'normal', label: 'Normal' },
  { value: 'low', label: 'Low' },
];

const SORT_OPTIONS: { value: RecurringSort; label: string }[] = [
  { value: 'default', label: 'Sort: stopped first' },
  { value: 'usage', label: 'Sort: Claude usage' },
  { value: 'last_run', label: 'Sort: last run' },
];

type Pick = 'keep' | 'cut' | 'weekly';

const PICK_WORDS: Record<Pick, string> = { keep: 'Kept', cut: 'Cut picked', weekly: 'Weekly picked' };

/** The line beside the buttons: the pick and its card, or when it was picked. */
function PickStatus({ r }: { r: RecurringWorkItem }) {
  if (r.pick_card_open && r.pick_task) {
    return (
      <span className="text-sm text-text-sub" data-testid="pick-status">
        <a href={`/tasks/${r.pick_task.id}`} className="text-primary underline" data-testid="pick-card-link">
          {PICK_WORDS[r.mike_pick ?? 'cut']} · card open
        </a>
      </span>
    );
  }
  if (r.mike_pick) {
    const when = monthDay(r.mike_pick_at);
    return (
      <span className="text-sm text-text-sub" data-testid="pick-status">
        {PICK_WORDS[r.mike_pick]}
        {when ? ` · ${when}` : ''}
      </span>
    );
  }
  return null;
}

function Row({
  r,
  onPriorityChange,
  onPick,
}: {
  r: RecurringWorkItem;
  onPriorityChange?: (id: string, priority: 'normal' | 'low') => void;
  onPick?: (id: string, pick: Pick) => void;
}) {
  const job = r.title ?? 'this job';
  const cardOpen = Boolean(r.pick_card_open);
  const when = r.schedule_text || r.cadence;
  const usage = usageText(r);
  const priority = r.priority ?? 'normal';
  return (
    <li className="flex flex-wrap items-baseline gap-x-4 gap-y-1 px-4 py-3" data-testid="recurring-row">
      <span className="min-w-0 flex-1 basis-64 font-medium text-text-main">
        {r.title ?? 'Untitled'}
        {r.initiative ? (
          <Badge variant="default" size="sm" className="ml-2 align-middle" data-testid="initiative-tag">
            {r.initiative.name}
          </Badge>
        ) : null}
        {r.file_only ? (
          <Badge variant="warning" size="sm" className="ml-2 align-middle" data-testid="file-only-flag">
            file only
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
      <span className="w-full basis-full" aria-hidden />
      <span className="w-44 text-sm text-text-sub" title={r.usage_note ?? undefined} data-testid="usage-cell">
        {usage.main}
        {usage.month ? ` · ${usage.month}` : ''}
      </span>
      <span className="min-w-0 flex-1 basis-48 text-sm text-text-sub" title={r.destination_note ?? undefined} data-testid="destination-cell">
        {destinationWords(r.destinations)}
      </span>
      <span className="w-36 text-sm text-text-sub" title={r.last_used_signal ?? undefined} data-testid="last-used-cell">
        {lastUsedText(r, monthDay)}
      </span>
      <span className="w-32">
        <Select
          options={PRIORITY_OPTIONS}
          value={priority}
          onChange={(v) => onPriorityChange?.(r.id, v === 'low' ? 'low' : 'normal')}
          disabled={!onPriorityChange}
          aria-label={`Priority for ${r.title ?? 'this job'}`}
          data-testid="priority-control"
        />
      </span>
      <span className="flex flex-wrap items-center gap-2">
        <Button type="button" variant="secondary" size="sm" disabled={!onPick} onClick={() => onPick?.(r.id, 'keep')} aria-label={`Keep ${job}`} data-testid="pick-keep">
          Keep
        </Button>
        <Button type="button" variant="secondary" size="sm" disabled={!onPick || cardOpen} onClick={() => onPick?.(r.id, 'cut')} aria-label={`Cut ${job}`} data-testid="pick-cut">
          Cut
        </Button>
        <Button type="button" variant="secondary" size="sm" disabled={!onPick || cardOpen} onClick={() => onPick?.(r.id, 'weekly')} aria-label={`Make ${job} weekly`} data-testid="pick-weekly">
          Make weekly
        </Button>
        <PickStatus r={r} />
      </span>
    </li>
  );
}

export interface RecurringWorkBoardProps {
  data: GroupedRecurringWork;
  /** Group labels this person collapsed. The background-jobs section is the exception: it starts closed and
   *  BACKGROUND_OPEN_KEY in the list means the person opened it. */
  collapsed?: string[];
  /** Called with the full new list of collapsed labels when a group is toggled. */
  onCollapsedChange?: (next: string[]) => void;
  onPriorityChange?: (id: string, priority: 'normal' | 'low') => void;
  /** Keep, Cut or Make weekly on a row. Without it the three buttons are disabled. */
  onPick?: (id: string, pick: Pick) => void;
}

/** Stored in the same list when the background-jobs section is open (it starts closed: design.md 3.2). */
export const BACKGROUND_OPEN_KEY = '__background:open';

export function RecurringWorkBoard({ data, collapsed = [], onCollapsedChange, onPriorityChange, onPick }: RecurringWorkBoardProps) {
  const [sort, setSort] = React.useState<RecurringSort>('default');
  const [onlyUnread, setOnlyUnread] = React.useState(false);
  const [bgOpen, setBgOpen] = React.useState(false);
  const base = boardView(data);
  if (base.groups.length === 0 && base.quiet.length === 0) {
    return <EmptyState title="Nothing recurring yet" description="Work that repeats, on the machine or in Citadel, shows here once it is set up." />;
  }
  const shape = (rows: RecurringWorkItem[]) => sortRows(filterRows(rows, onlyUnread), sort);
  const groups = base.groups
    .map((g) => {
      const rows = shape(g.rows);
      return { ...g, rows, count: rows.length };
    })
    .filter((g) => g.rows.length > 0);
  const quiet = shape(base.quiet);
  const isCollapsed = (key: string) => collapsed.includes(key);
  const toggle = (key: string) => onCollapsedChange?.(isCollapsed(key) ? collapsed.filter((k) => k !== key) : [...collapsed, key]);
  const bgShown = onCollapsedChange ? isCollapsed(BACKGROUND_OPEN_KEY) : bgOpen;
  return (
    <div className="space-y-4" data-testid="recurring-work-board">
      <div>
        <p className="text-sm text-text-sub">Everything that repeats, who answers for it, and what it makes.</p>
        <p className="text-sm text-text-sub" data-testid="recurring-counts">
          {headerLine(base)}
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <div className="w-52">
          <Select
            options={SORT_OPTIONS}
            value={sort}
            onChange={(v) => setSort(v === 'usage' || v === 'last_run' ? v : 'default')}
            aria-label="Sort by"
            data-testid="sort-control"
          />
        </div>
        <Button
          type="button"
          variant={onlyUnread ? 'primary' : 'secondary'}
          size="sm"
          aria-pressed={onlyUnread}
          onClick={() => setOnlyUnread((v) => !v)}
          data-testid="nobody-reads-filter"
        >
          Only jobs nobody reads
        </Button>
      </div>
      {onlyUnread && groups.length === 0 && quiet.length === 0 ? (
        <p className="text-sm text-text-sub" data-testid="nobody-reads-empty">
          No job matches. Jobs whose use is not known yet are left out.
        </p>
      ) : null}
      {groups.map((g) => {
        const closed = isCollapsed(g.label);
        return (
          <section key={g.label} data-testid="recurring-group">
            <h3 className="mb-1 text-sm font-medium text-text-main">
              <button
                type="button"
                onClick={() => toggle(g.label)}
                aria-expanded={!closed}
                className="flex items-center gap-1 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                data-testid="group-toggle"
              >
                <ChevronRight className={cn('h-4 w-4 transition-transform', !closed && 'rotate-90')} aria-hidden />
                {g.label} ({g.count})
              </button>
            </h3>
            {closed ? null : (
              <ul className="divide-y divide-border rounded-lg border border-border-warm bg-surface shadow-soft">
                {g.rows.map((r) => (
                  <Row key={r.id} r={r} onPriorityChange={onPriorityChange} onPick={onPick} />
                ))}
              </ul>
            )}
          </section>
        );
      })}
      {quiet.length > 0 ? (
        <div>
          <button
            type="button"
            onClick={() => (onCollapsedChange ? toggle(BACKGROUND_OPEN_KEY) : setBgOpen((o) => !o))}
            aria-expanded={bgShown}
            className="flex items-center gap-1 text-sm text-text-sub hover:text-text-main focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            data-testid="background-toggle"
          >
            <ChevronRight className={cn('h-4 w-4 transition-transform', bgShown && 'rotate-90')} aria-hidden />
            {plural(quiet.length, 'background job', 'background jobs')}: all running
          </button>
          {bgShown ? (
            <ul className="mt-2 divide-y divide-border rounded-lg border border-border-warm bg-surface" data-testid="background-list">
              {quiet.map((r) => (
                <Row key={r.id} r={r} onPriorityChange={onPriorityChange} onPick={onPick} />
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

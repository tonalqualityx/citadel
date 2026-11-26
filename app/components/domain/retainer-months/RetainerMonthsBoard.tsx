'use client';

import * as React from 'react';
import { EmptyState } from '@/components/ui/empty-state';
import { cn } from '@/lib/utils/cn';
import { hoursText, monthLabel } from '@/lib/retainer-months/format';
import type { RetainerMonthView } from '@/types/entities';
import { RetainerMonthPanel } from './RetainerMonthPanel';

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export type UpcomingByCharter = Map<string, RetainerMonthView>;

/** Plans waiting to be confirmed for one retainer: this month's and next month's. */
export function plansToConfirm(r: RetainerMonthView, upcoming?: RetainerMonthView): number {
  return Number(r.state === 'planning') + Number(upcoming?.state === 'planning');
}

/** The retainer in focus: a plan waiting to be confirmed (this month's or next month's), then the most time outside the plan, then the one closest to its hours (design.md 3.3). */
export function focusOrder(retainers: RetainerMonthView[], upcoming: UpcomingByCharter = new Map()): RetainerMonthView[] {
  const closeness = (r: RetainerMonthView) => {
    const allotted = r.hours_allotted * 60;
    return allotted > 0 ? Math.abs(1 - r.used_minutes / allotted) : Infinity;
  };
  const waiting = (r: RetainerMonthView) => Number(plansToConfirm(r, upcoming.get(r.charter_id)) > 0);
  return [...retainers].sort(
    (a, b) =>
      waiting(b) - waiting(a) ||
      b.outside_minutes - a.outside_minutes ||
      closeness(a) - closeness(b) ||
      a.client_name.localeCompare(b.client_name),
  );
}

export function countLine(retainers: RetainerMonthView[], upcoming: UpcomingByCharter = new Map()): string {
  const parts = [plural(retainers.length, 'retainer', 'retainers')];
  const waiting = retainers.reduce((n, r) => n + plansToConfirm(r, upcoming.get(r.charter_id)), 0);
  const outside = retainers.filter((r) => r.outside_minutes > 0).length;
  if (waiting) parts.push(`${waiting} ${waiting === 1 ? 'plan' : 'plans'} to confirm`);
  if (outside) parts.push(`${outside} ${outside === 1 ? 'has' : 'have'} work outside the plan`);
  return parts.join(' · ');
}

function Tile({ r, toConfirm, onFocus }: { r: RetainerMonthView; toConfirm: boolean; onFocus: () => void }) {
  return (
    <button
      type="button"
      onClick={onFocus}
      className="w-full rounded-lg border border-border-warm bg-surface p-3 text-left shadow-soft transition-colors hover:border-primary/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
      data-testid="retainer-tile"
    >
      <p className="truncate font-medium text-text-main">{r.client_name}</p>
      <p className="text-sm text-text-sub">{toConfirm ? 'plan to confirm' : r.state}</p>
      <p className="text-sm text-text-main">
        {hoursText(r.used_minutes)} of {r.hours_allotted} h
      </p>
      {r.outside_minutes > 0 ? <p className="text-sm text-warning">outside: {hoursText(r.outside_minutes)}</p> : null}
    </button>
  );
}

export interface RetainerMonthsBoardProps {
  month: string;
  retainers: RetainerMonthView[];
  /** Next month's rows; a plan drafted from the 25th waits here to be confirmed. */
  upcoming?: RetainerMonthView[];
  focusId: string | null;
  onFocus: (id: string) => void;
  onConfirm: (month: RetainerMonthView) => void;
  onTalk: (month: RetainerMonthView) => void;
  busy?: boolean;
}

export function RetainerMonthsBoard({ month, retainers, upcoming = [], focusId, onFocus, onConfirm, onTalk, busy }: RetainerMonthsBoardProps) {
  if (retainers.length === 0) {
    return <EmptyState title="No retainer months yet" description="Monthly retainers get a month drafted from the 25th of the month before." />;
  }
  const next: UpcomingByCharter = new Map(upcoming.map((u) => [u.charter_id, u]));
  const ordered = focusOrder(retainers, next);
  const focus = ordered.find((r) => r.id === focusId) ?? ordered[0];
  const rest = ordered.filter((r) => r.id !== focus.id);
  return (
    <div className="space-y-4" data-testid="retainer-months-board">
      <div>
        <p className="text-sm text-text-sub">{monthLabel(month)}: what each retainer holds and what it has used.</p>
        <p className="text-sm text-text-sub" data-testid="retainer-counts">
          {countLine(retainers, next)}
        </p>
      </div>
      <div className={cn('grid gap-4', rest.length ? 'grid-cols-1 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]' : 'grid-cols-1')}>
        <RetainerMonthPanel month={focus} upcoming={next.get(focus.charter_id) ?? null} onConfirm={onConfirm} onTalk={onTalk} busy={busy} showClient />
        {rest.length ? (
          <div className="grid content-start gap-2 sm:grid-cols-2 xl:grid-cols-1">
            {rest.map((r) => (
              <Tile key={r.id} r={r} toConfirm={plansToConfirm(r, next.get(r.charter_id)) > 0} onFocus={() => onFocus(r.id)} />
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}

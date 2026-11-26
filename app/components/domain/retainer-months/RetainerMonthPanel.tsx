'use client';

import * as React from 'react';
import { MessageSquare } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { hoursText, monthName, rangeText } from '@/lib/retainer-months/format';
import { totalRangeOf } from './totals';
import type { RetainerMonthLine, RetainerMonthView } from '@/types/entities';

/** Used against allotted: accent blue up to the allotment, muted gold beyond it (never red). */
export function UsageBar({ usedMinutes, allottedMinutes }: { usedMinutes: number; allottedMinutes: number }) {
  const scale = Math.max(usedMinutes, allottedMinutes, 1);
  const blue = (Math.min(usedMinutes, allottedMinutes) / scale) * 100;
  const gold = (Math.max(usedMinutes - allottedMinutes, 0) / scale) * 100;
  return (
    <div className="flex h-3 w-full overflow-hidden rounded-full bg-surface-alt" role="presentation" data-testid="usage-bar">
      <div className="h-full bg-primary" style={{ width: `${blue}%` }} data-testid="usage-bar-within" />
      {gold > 0 ? <div className="h-full bg-warning" style={{ width: `${gold}%` }} data-testid="usage-bar-past" /> : null}
    </div>
  );
}

export function pastMonthLine(l: RetainerMonthLine): string {
  const out = l.outside_minutes > 0 ? `, ${hoursText(l.outside_minutes)} outside the plan` : '';
  return `${monthName(l.month)}: ${hoursText(l.used_minutes)} of ${l.hours_allotted} h${out}`;
}

export interface RetainerMonthPanelProps {
  month: RetainerMonthView;
  /** Next month's row when it exists (drafted from the 25th): shown above this month so its plan can be confirmed. */
  upcoming?: RetainerMonthView | null;
  /** Past months, one line each. */
  past?: RetainerMonthLine[];
  onConfirm?: (month: RetainerMonthView) => void;
  onTalk?: (month: RetainerMonthView) => void;
  busy?: boolean;
  /** Show the client's name in the heading (the Retainer months tab); the charter page already says whose it is. */
  showClient?: boolean;
}

function draftedOn(m: RetainerMonthView): string {
  return m.created_at ? new Date(m.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '';
}

/** Next month's plan, compact: its state, the items with ranges, the total against the allotted hours, and Use this plan while it is a draft. */
function UpcomingPlan({ month, showClient, onConfirm, busy }: { month: RetainerMonthView; showClient?: boolean; onConfirm?: (m: RetainerMonthView) => void; busy?: boolean }) {
  const total = totalRangeOf(month.items);
  const when = month.state === 'planning' ? `drafted${draftedOn(month) ? ` ${draftedOn(month)}` : ''}` : month.state;
  return (
    <div className="mb-4 rounded-md border border-border-warm bg-surface-alt p-3" data-testid="upcoming-plan">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-medium text-text-main">
          {showClient ? `${month.client_name}: ` : ''}
          {monthName(month.month)} plan <span className="font-normal text-text-sub">· {when}</span>
        </p>
        {month.state === 'planning' && onConfirm ? (
          <Button size="sm" onClick={() => onConfirm(month)} disabled={busy} data-testid="upcoming-confirm">
            Use this plan
          </Button>
        ) : null}
      </div>
      <ul className="mt-1 space-y-0.5 text-sm text-text-sub">
        {month.items.map((i) => (
          <li key={i.id} className="flex justify-between gap-3" data-testid="upcoming-item">
            <span className="truncate">{i.title}</span>
            <span className="shrink-0">{rangeText(i.estimate_min_low, i.estimate_min_high)}</span>
          </li>
        ))}
        {month.items.length === 0 ? <li>Nothing drafted yet.</li> : null}
      </ul>
      <p className="mt-1 text-sm text-text-main" data-testid="upcoming-total">
        Total {rangeText(total.low, total.high)} of {month.hours_allotted} h
      </p>
    </div>
  );
}

/** One retainer's month (design.md 3.3): the bar, the planned items with estimate and used, what is outside the plan, past months. */
export function RetainerMonthPanel({ month, upcoming, past = [], onConfirm, onTalk, busy, showClient }: RetainerMonthPanelProps) {
  const allotted = Math.round(month.hours_allotted * 60);
  const heading = `${showClient ? `${month.client_name}: ` : ''}${monthName(month.month)}`;
  return (
    <Card className="p-4" data-testid="retainer-month-panel">
      {upcoming ? <UpcomingPlan month={upcoming} showClient={showClient} onConfirm={onConfirm} busy={busy} /> : null}
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold text-text-main">{heading}</h2>
          <p className="text-sm text-text-sub">
            {month.hours_allotted} h a month
            {month.state === 'planning' ? ' · plan drafted, not confirmed' : null}
            {month.state === 'planned' ? (month.note ? ` · planned (${month.note})` : ' · planned') : null}
            {month.state === 'closed' ? ' · closed' : null}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {month.state === 'planning' && onConfirm ? (
            <Button size="sm" onClick={() => onConfirm(month)} disabled={busy}>
              Use this plan
            </Button>
          ) : null}
          {onTalk ? (
            <Button size="sm" variant="secondary" onClick={() => onTalk(month)}>
              <MessageSquare className="mr-1.5 h-4 w-4" />
              Talk it through
            </Button>
          ) : null}
        </div>
      </div>

      <div className="mt-3">
        <UsageBar usedMinutes={month.used_minutes} allottedMinutes={allotted} />
        <p className="mt-1 text-sm text-text-main" data-testid="usage-line">
          Used {hoursText(month.used_minutes)} of {month.hours_allotted} h
        </p>
      </div>

      <table className="mt-4 w-full text-sm">
        <thead>
          <tr className="text-left text-xs uppercase tracking-wider text-text-sub">
            <th className="py-1 font-semibold">Planned</th>
            <th className="py-1 text-right font-semibold">Estimate</th>
            <th className="py-1 text-right font-semibold">Used</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border-warm">
          {month.items.length === 0 ? (
            <tr>
              <td colSpan={3} className="py-2 text-text-sub">
                Nothing planned for this month.
              </td>
            </tr>
          ) : (
            month.items.map((i) => (
              <tr key={i.id} data-testid="retainer-item">
                <td className="py-1.5 text-text-main">{i.title}</td>
                <td className="py-1.5 text-right text-text-sub">{rangeText(i.estimate_min_low, i.estimate_min_high)}</td>
                <td className="py-1.5 text-right text-text-main">{hoursText(i.used_minutes)}</td>
              </tr>
            ))
          )}
        </tbody>
      </table>

      {month.outside.length > 0 ? (
        <div className="mt-4 rounded-md bg-warning-subtle p-3" data-testid="outside-the-plan">
          <div className="flex items-baseline justify-between text-sm font-medium text-text-main">
            <span>Outside the plan</span>
            <span className="text-warning">{hoursText(month.outside_minutes)}</span>
          </div>
          <ul className="mt-1 space-y-0.5 text-sm text-text-sub">
            {month.outside.map((o) => (
              <li key={o.id} className="flex justify-between gap-3">
                <span className="truncate">{o.title}</span>
                <span className="shrink-0">{hoursText(o.minutes)}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {month.unassigned_minutes > 0 ? (
        <p className="mt-3 text-sm text-text-sub" data-testid="unassigned-line">
          {hoursText(month.unassigned_minutes)} of this client&apos;s time is not assigned to a retainer.
        </p>
      ) : null}

      {past.length > 0 ? (
        <ul className="mt-4 space-y-0.5 border-t border-border-warm pt-3 text-sm text-text-sub" data-testid="past-months">
          {past.map((l) => (
            <li key={l.id}>{pastMonthLine(l)}</li>
          ))}
        </ul>
      ) : null}
    </Card>
  );
}

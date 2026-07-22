'use client';

import * as React from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { useTodayCalendar } from '@/lib/hooks/use-today';
import { useCreateIdea } from '@/lib/hooks/use-ideas';
import { DEFAULT_DISPLAY_TIMEZONE } from '@/lib/timezone';
import type { OracleMachineDTO } from '@/lib/types/oracle';
import { CronHealthLine } from './CronHealthLine';
import { WeekStrip } from './today/WeekStrip';

interface OracleHeaderProps {
  machines: OracleMachineDTO[];
  /** Clarity Phase 3c — quiet, count-only link to the Fleet screen ("N in motion · M
   *  docked"), where the In Motion/Docked machinery now lives. Optional so the header
   *  still renders sanely if a caller ever omits it. */
  fleetCounts?: { inMotion: number; docked: number };
}

// Clarity Phase 3d bug fix: was `new Date().toLocaleDateString('en-US', {...})` with no
// timeZone — rendered in the BROWSER's implicit locale zone, not the resolved
// requester's zone. Always pass the resolved zone from the /api/today/calendar
// response (falls back to the client-safe default while it's still loading).
function formatToday(timezone: string): string {
  return new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: timezone });
}

// Header: title, the machine-health one-liner (crons visible ONLY when erroring —
// exception-based display, healthy crons render nothing), the idea quick-add ("idea: …"
// straight to /api/ideas, source=oracle), and the week capacity strip.
export function OracleHeader({ machines, fleetCounts }: OracleHeaderProps) {
  const [ideaText, setIdeaText] = React.useState('');
  const createIdea = useCreateIdea();
  const { data: calendarData } = useTodayCalendar();
  const timezone = calendarData?.timezone ?? DEFAULT_DISPLAY_TIMEZONE;

  function submitIdea(e: React.FormEvent) {
    e.preventDefault();
    const text = ideaText.trim();
    if (!text) return;
    createIdea.mutate({ text, source: 'oracle' }, { onSuccess: () => setIdeaText('') });
  }

  return (
    <header className="flex flex-wrap items-start justify-between gap-3" data-testid="oracle-header">
      <div>
        <h1 className="text-lg font-bold text-text-main">Seeing Stone</h1>
        <div className="flex items-center gap-1.5 text-xs text-text-sub">
          <span>{formatToday(timezone)}</span>
          <CronHealthLine machines={machines} />
        </div>
        {fleetCounts && (
          <Link
            href="/oracle/fleet"
            data-testid="fleet-link"
            className="mt-0.5 inline-block text-xs text-text-sub underline-offset-2 hover:text-text-main hover:underline"
          >
            {fleetCounts.inMotion} in motion · {fleetCounts.docked} docked
          </Link>
        )}
      </div>

      <form onSubmit={submitIdea} className="flex min-w-[230px] max-w-[380px] flex-1 gap-1.5">
        <input
          value={ideaText}
          onChange={(e) => setIdeaText(e.target.value)}
          placeholder="idea: … (files straight to the Ideas list)"
          className="flex-1 rounded-lg border border-border-warm bg-surface px-2.5 py-1.5 text-sm text-text-main placeholder:text-text-sub"
          data-testid="idea-quickadd-input"
        />
        <Button type="submit" variant="primary" size="sm" disabled={createIdea.isPending || !ideaText.trim()}>
          Catch
        </Button>
      </form>

      {calendarData && <WeekStrip week={calendarData.week} todayDate={calendarData.date} />}
    </header>
  );
}

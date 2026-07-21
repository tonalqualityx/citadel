'use client';

import * as React from 'react';
import { AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useTodayCalendar } from '@/lib/hooks/use-today';
import { useCreateIdea } from '@/lib/hooks/use-ideas';
import type { OracleMachineDTO } from '@/lib/types/oracle';
import { erroringCrons } from './oracle-logic';
import { WeekStrip } from './today/WeekStrip';

interface OracleHeaderProps {
  machines: OracleMachineDTO[];
}

function formatToday(): string {
  return new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
}

// Header: title, the machine-health one-liner (crons visible ONLY when erroring —
// exception-based display, healthy crons render nothing), the idea quick-add ("idea: …"
// straight to /api/ideas, source=oracle), and the week capacity strip.
export function OracleHeader({ machines }: OracleHeaderProps) {
  const [ideaText, setIdeaText] = React.useState('');
  const createIdea = useCreateIdea();
  const { data: calendarData } = useTodayCalendar();

  const crons = erroringCrons(machines);

  function submitIdea(e: React.FormEvent) {
    e.preventDefault();
    const text = ideaText.trim();
    if (!text) return;
    createIdea.mutate({ text, source: 'oracle' }, { onSuccess: () => setIdeaText('') });
  }

  return (
    <header className="flex flex-wrap items-start justify-between gap-3" data-testid="oracle-header">
      <div>
        <h1 className="text-lg font-bold text-text-main">The Oracle</h1>
        <div className="flex items-center gap-1.5 text-xs text-text-sub">
          <span>{formatToday()}</span>
          {crons.length === 0 ? (
            <span>· all crons healthy</span>
          ) : (
            <span
              className="flex items-center gap-1 font-semibold text-[var(--warning)]"
              data-testid="cron-health-warning"
            >
              <AlertTriangle className="h-3 w-3" aria-hidden="true" />
              {crons.length} cron{crons.length === 1 ? '' : 's'} need attention:{' '}
              {crons.map((c) => c.title).join(', ')}
            </span>
          )}
        </div>
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

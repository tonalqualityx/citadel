'use client';

import * as React from 'react';
import Link from 'next/link';
import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tooltip } from '@/components/ui/tooltip';
import { useTodayCalendar } from '@/lib/hooks/use-today';
import { useCreateIdea } from '@/lib/hooks/use-ideas';
import { useCreateTask } from '@/lib/hooks/use-tasks';
import { useTriageStats } from '@/lib/hooks/use-triage-stats';
import { DEFAULT_DISPLAY_TIMEZONE } from '@/lib/timezone';
import type { WaitingOnMeResponse } from '@/lib/hooks/use-waiting-on-me';
import { IntakeDrawer } from './intake/IntakeDrawer';
import { NewArcModal } from './NewArcModal';
import { parseCatchInput, MIKE_USER_ID } from './oracle-header-logic';

interface OracleHeaderProps {
  /** Clarity Phase 3c — quiet, count-only link to the Fleet screen ("N in motion · M
   *  docked"), where the In Motion/Docked machinery now lives. Optional so the header
   *  still renders sanely if a caller ever omits it. */
  fleetCounts?: { inMotion: number; docked: number };
  /** Clarity Phase 4b — the Intake trigger chip + its slide-over drawer, relocated here
   *  (top right, under the week capacity strip) from a large in-page expandable section
   *  under Needs Reshi. Optional so the header still renders sanely before
   *  waiting-on-me's data arrives. */
  intake?: WaitingOnMeResponse['intake'];
}

// Clarity Phase 3d bug fix: was `new Date().toLocaleDateString('en-US', {...})` with no
// timeZone — rendered in the BROWSER's implicit locale zone, not the resolved
// requester's zone. Always pass the resolved zone from the /api/today/calendar
// response (falls back to the client-safe default while it's still loading).
function formatToday(timezone: string): string {
  return new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: timezone });
}

// Clarity Phase 3 (Reckoning, spec Q11) — the triage visibility chip's destination:
// Gmail's Bast/Archived-Auto label, where every auto-archived message actually lands.
const AUTO_ARCHIVED_LABEL_URL = 'https://mail.google.com/mail/u/0/#label/Bast%2FArchived-Auto';

// Header: title, date, the idea quick-add ("idea: …" straight to /api/ideas, source=oracle
// — or "task: …" straight to /api/tasks), New arc, the fleet link, the triage chip, and the
// Intake drawer trigger. Clarity Phase 8 (composition) — the machine-health cron line moved
// into Work mode's signals rail (SignalsRail mounts CronHealthLine directly) and the week
// capacity strip moved into Plan mode (PlanView mounts WeekStrip directly) — both were
// always-visible header furniture that the mode-escort law now scopes to the mode that
// actually needs them.
export function OracleHeader({ fleetCounts, intake }: OracleHeaderProps) {
  const [catchText, setCatchText] = React.useState('');
  const [newArcOpen, setNewArcOpen] = React.useState(false);
  const createIdea = useCreateIdea();
  const createTask = useCreateTask();
  const { data: triageStats } = useTriageStats();
  const { data: calendarData } = useTodayCalendar();
  const timezone = calendarData?.timezone ?? DEFAULT_DISPLAY_TIMEZONE;

  // Clarity Phase 3 (Reckoning, spec Q19) — the Catch bar accepts either prefix: "task: …"
  // files straight to /api/tasks (assignee Mike, not_started, priority 3); anything else
  // (including the original bare/"idea: …" input) keeps filing to the ideas bank — the
  // bar's original single purpose, never removed.
  function submitCatch(e: React.FormEvent) {
    e.preventDefault();
    const parsed = parseCatchInput(catchText);
    if (!parsed) return;
    if (parsed.kind === 'task') {
      createTask.mutate(
        { title: parsed.text, assignee_id: MIKE_USER_ID, status: 'not_started', priority: 3 },
        { onSuccess: () => setCatchText('') }
      );
    } else {
      createIdea.mutate({ text: parsed.text, source: 'oracle' }, { onSuccess: () => setCatchText('') });
    }
  }

  const isPending = createIdea.isPending || createTask.isPending;

  return (
    <header className="flex flex-wrap items-start justify-between gap-3" data-testid="oracle-header">
      <div>
        <h1 className="text-lg font-bold text-text-main">Seeing Stone</h1>
        <div className="flex items-center gap-1.5 text-xs text-text-sub">
          <span>{formatToday(timezone)}</span>
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

      <form onSubmit={submitCatch} className="flex min-w-[230px] max-w-[380px] flex-1 gap-1.5">
        <input
          value={catchText}
          onChange={(e) => setCatchText(e.target.value)}
          placeholder="idea: … or task: … (files to Ideas or Tasks)"
          className="flex-1 rounded-lg border border-border-warm bg-surface px-2.5 py-1.5 text-sm text-text-main placeholder:text-text-sub"
          data-testid="idea-quickadd-input"
        />
        <Button type="submit" variant="primary" size="sm" disabled={isPending || !catchText.trim()}>
          Catch
        </Button>
      </form>

      <div className="flex flex-col items-end gap-1.5">
        <div className="flex items-center gap-2">
          {/* Clarity Phase 3 (Reckoning, spec Q4) — starts a shapeless arc container in
              two fields; navigates straight into its workspace on success. */}
          <Tooltip content="Starts a new arc — just a name. Add tasks, emails, or a client once you're inside.">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setNewArcOpen(true)}
              data-testid="new-arc-trigger"
            >
              <Plus className="h-3.5 w-3.5" aria-hidden="true" />
              New arc
            </Button>
          </Tooltip>
        </div>
        <div className="flex items-center gap-2">
          {/* Clarity Phase 3 (Reckoning, spec Q11) — the triage visibility chip:
              anti-silent-triage, only renders when there's something to check. */}
          {!!triageStats && triageStats.archived_count > 0 && (
            <Tooltip content="Auto-archived by the classifier today — click to review the list in Gmail">
              <a
                href={AUTO_ARCHIVED_LABEL_URL}
                target="_blank"
                rel="noopener noreferrer"
                data-testid="triage-archived-chip"
                className="rounded-full border border-border-warm bg-surface px-2.5 py-1 text-xs text-text-sub hover:bg-background-light hover:text-text-main"
              >
                {triageStats.archived_count} auto-archived today
              </a>
            </Tooltip>
          )}
          {intake && <IntakeDrawer intake={intake} timezone={timezone} />}
        </div>
      </div>

      <NewArcModal open={newArcOpen} onOpenChange={setNewArcOpen} />
    </header>
  );
}

'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { ChevronRight, ExternalLink, Plus, X } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import type { EmailAsk, WaitingOnMeResponse } from '@/lib/hooks/use-waiting-on-me';
import { useUpdateEmailAsk, useCreateTaskFromEmailAsk } from '@/lib/hooks/use-email-asks';
import { crisisFromLabel } from '@/components/domain/oracle/crisis/crisis-strip-logic';
import { intakeSummaryLine } from './intake-drawer-logic';

interface IntakeDrawerProps {
  intake: WaitingOnMeResponse['intake'];
  timezone: string;
}

// Clarity Phase 4a — the intake drawer. Non-urgent client mail waits here, one quiet line
// under Needs Reshi. Collapsed by default ALWAYS — expand state is local component state,
// never persisted, so it re-collapses on every load (rituals/on-demand opening only, per
// Mike's talk-first ruling). Renders even when count is 0 (a quiet "nothing waiting" line),
// unlike the crisis strip's exception-only zero-pixels rule — the drawer's whole point is
// being a stable, always-there landmark.
export function IntakeDrawer({ intake, timezone }: IntakeDrawerProps) {
  const router = useRouter();
  const [expanded, setExpanded] = React.useState(false);
  const updateAsk = useUpdateEmailAsk();
  const createTask = useCreateTaskFromEmailAsk();

  function handleDismiss(ask: EmailAsk) {
    updateAsk.mutate({ id: ask.id, data: { state: 'dismissed' } });
  }

  function handleCreate(ask: EmailAsk) {
    createTask.mutate({ id: ask.id });
  }

  async function handleCreateAndOpen(ask: EmailAsk) {
    const task = await createTask.mutateAsync({ id: ask.id });
    router.push(`/tasks/${task.id}`);
  }

  return (
    <section className="flex flex-col gap-2" data-testid="intake-drawer">
      <button
        type="button"
        onClick={() => setExpanded((e) => !e)}
        aria-expanded={expanded}
        className="flex min-h-9 items-center gap-1.5 rounded px-1 text-left text-sm text-text-sub"
      >
        <ChevronRight className={expanded ? 'h-3.5 w-3.5 rotate-90 transition-transform' : 'h-3.5 w-3.5 transition-transform'} />
        {intakeSummaryLine(intake.count, intake.newest_at, timezone)}
      </button>

      {expanded && (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3" data-testid="intake-cards">
          {intake.items.length === 0 ? (
            <p className="px-1 text-sm text-text-sub">Nothing waiting.</p>
          ) : (
            intake.items.map((ask) => (
              <Card key={ask.id} className="flex flex-col gap-1.5 p-3" data-testid="intake-card">
                <span className="truncate text-xs text-text-sub">{crisisFromLabel(ask)}</span>
                <p className="truncate text-sm font-medium text-text-main">{ask.subject}</p>
                {ask.gist && <p className="truncate text-xs text-text-sub">{ask.gist}</p>}

                <div className="mt-1 flex flex-wrap items-center gap-1.5">
                  <Button asChild variant="secondary" size="sm">
                    <a href={ask.deep_link} target="_blank" rel="noopener noreferrer">
                      <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                      Open email
                    </a>
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => handleCreate(ask)}
                    disabled={createTask.isPending}
                  >
                    <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                    Create
                  </Button>
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={() => handleCreateAndOpen(ask)}
                    disabled={createTask.isPending}
                  >
                    Create + open
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleDismiss(ask)}
                    disabled={updateAsk.isPending}
                    aria-label="Dismiss"
                  >
                    <X className="h-3.5 w-3.5" aria-hidden="true" />
                  </Button>
                </div>
              </Card>
            ))
          )}
        </div>
      )}
    </section>
  );
}

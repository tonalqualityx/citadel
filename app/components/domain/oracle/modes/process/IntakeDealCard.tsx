'use client';

import * as React from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Tooltip } from '@/components/ui/tooltip';
import { useUpdateEmailAsk, useCreateTaskFromEmailAsk } from '@/lib/hooks/use-email-asks';
import { useCreateAccord } from '@/lib/hooks/use-accords';
import { IntakeAttachPicker } from '@/components/domain/oracle/intake/IntakeAttachPicker';
import { crisisFromLabel } from '@/components/domain/oracle/crisis/crisis-strip-logic';
import type { EmailAsk } from '@/lib/hooks/use-waiting-on-me';

interface IntakeDealCardProps {
  ask: EmailAsk;
  onRouted: () => void;
}

// Clarity Phase 8 (composition) — Process mode's intake card, one at a time. Four routes:
//   Lead — creates a real Accord (status=lead) via the existing POST /api/accords route,
//   then marks the email handled so it leaves Intake. (Accord<->EmailAsk linkage doesn't
//   exist yet — the accord is created standing alone; a future phase can add the FK.)
//   Arc — the existing IntakeAttachPicker (attach to an open arc or task; already wired to
//   POST /api/email-asks/{id}/attach).
//   Task — the existing create-task route (same as the drawer's own "Create" button).
//   Dismiss — PATCH state=dismissed.
export function IntakeDealCard({ ask, onRouted }: IntakeDealCardProps) {
  const updateAsk = useUpdateEmailAsk();
  const createTask = useCreateTaskFromEmailAsk();
  const createAccord = useCreateAccord();

  function handleLead() {
    createAccord.mutate(
      { name: ask.subject, lead_name: ask.from_name ?? undefined, lead_email: ask.from_email, status: 'lead' },
      {
        onSuccess: () => {
          updateAsk.mutate({ id: ask.id, data: { state: 'handled' } });
          onRouted();
        },
      }
    );
  }

  function handleTask() {
    createTask.mutate({ id: ask.id }, { onSuccess: onRouted });
  }

  function handleDismiss() {
    updateAsk.mutate({ id: ask.id, data: { state: 'dismissed' } }, { onSuccess: onRouted });
  }

  const busy = updateAsk.isPending || createTask.isPending || createAccord.isPending;

  return (
    <Card className="flex flex-col gap-2 p-4" data-testid="process-deal-card" data-stage="intake">
      <span className="text-xs text-text-sub">{crisisFromLabel(ask)}</span>
      <p className="text-sm font-medium text-text-main">{ask.subject}</p>
      {ask.gist && <p className="text-xs text-text-sub">{ask.gist}</p>}

      <div className="mt-1 flex flex-wrap items-center gap-1.5">
        <Tooltip content="Creates an Accord (status: lead) for this email">
          <Button variant="secondary" size="sm" onClick={handleLead} disabled={busy} data-testid="intake-deal-lead">
            Lead
          </Button>
        </Tooltip>
        <Button variant="secondary" size="sm" onClick={handleTask} disabled={busy} data-testid="intake-deal-task">
          Task
        </Button>
        <Tooltip content="Dismiss — clears this from Intake with no other action">
          <Button variant="ghost" size="sm" onClick={handleDismiss} disabled={busy} data-testid="intake-deal-dismiss">
            Dismiss
          </Button>
        </Tooltip>
      </div>
      <IntakeAttachPicker askId={ask.id} />
    </Card>
  );
}

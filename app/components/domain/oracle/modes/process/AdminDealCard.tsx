'use client';

import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Tooltip } from '@/components/ui/tooltip';
import { useUpdateTask } from '@/lib/hooks/use-tasks';
import { useTaskPeek } from '@/lib/contexts/task-peek-context';
import { showToast } from '@/lib/hooks/use-toast';
import type { AdminSoonTask } from '@/lib/hooks/use-admin-soon';

interface AdminDealCardProps {
  task: AdminSoonTask;
  onRouted: () => void;
}

// Clarity Phase 8 (composition) — Process mode's admin-soon card, one at a time:
// decisions-and-signatures only (DAY-REALITY #4 — "no admin days, a weekly admin chunk").
//
// Clarity Phase 8 (shakedown, 2026-07-28) — Done and Skip both changed something real
// (a task status flip; a session-local skip) with no toast to confirm it — useUpdateTask's
// own onSuccess only pops a toast for the separate, conditional completion-nudge case, not
// a plain "done." Both now say what happened, same honesty pass as ReviewBatchDealCard's
// Open->Skip rename. Open already opens the task peek drawer — a visible surface change is
// its own feedback, so it's left alone.
export function AdminDealCard({ task, onRouted }: AdminDealCardProps) {
  const updateTask = useUpdateTask();
  const { openTaskPeek } = useTaskPeek();

  function handleDone() {
    updateTask.mutate(
      { id: task.id, data: { status: 'done' } },
      {
        onSuccess: () => {
          showToast.success('Marked done');
          onRouted();
        },
      }
    );
  }

  function handleSkip() {
    showToast.success('Skipped — still in the queue');
    onRouted();
  }

  return (
    <Card className="flex flex-col gap-2 p-4" data-testid="process-deal-card" data-stage="admin">
      <p className="text-sm font-medium text-text-main">{task.title}</p>
      {task.client && <p className="text-xs text-text-sub">{task.client.name}</p>}

      <div className="mt-1 flex flex-wrap items-center gap-1.5">
        <Button variant="secondary" size="sm" onClick={() => openTaskPeek(task.id)} data-testid="admin-deal-open">
          Open
        </Button>
        <Button variant="primary" size="sm" onClick={handleDone} disabled={updateTask.isPending} data-testid="admin-deal-done">
          Done
        </Button>
        <Tooltip content="Skip for now — stays in the queue">
          <Button variant="ghost" size="sm" onClick={handleSkip} data-testid="admin-deal-skip">
            Skip
          </Button>
        </Tooltip>
      </div>
    </Card>
  );
}

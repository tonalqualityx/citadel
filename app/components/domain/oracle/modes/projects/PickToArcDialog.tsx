'use client';

import * as React from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Modal, ModalContent, ModalHeader, ModalTitle, ModalBody, ModalFooter } from '@/components/ui/modal';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { useArcs, useCreateArc } from '@/lib/hooks/use-arcs';
import { useTodayPicks, useCreateTodayPick } from '@/lib/hooks/use-today';
import { useCreateTask, useUpdateTask } from '@/lib/hooks/use-tasks';
import { showToast } from '@/lib/hooks/use-toast';
import { useTerminology } from '@/lib/hooks/use-terminology';
import { oracleProjectsKeys } from '@/lib/hooks/use-oracle-projects';
import { MIKE_USER_ID } from '@/lib/oracle/projects/gate-constants';
import { buildSinglePickPlan } from './projects-logic';
import type { Blocker } from '@/lib/oracle/projects/blockers';

interface PickToArcDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  blocker: Blocker;
  project: { id: string; name: string };
}

// Oracle Projects Tab Phase 4 — the single-blocker pick flow: attach the blocker's task
// (creating one first for a non-task blocker) to an existing open arc, a brand-new one,
// or no arc at all, then add ONE Today pick for the task. Surfaces the WIP-cap warning
// up front and, on a 409 at the cap, the API's own message verbatim (never re-worded).
export function PickToArcDialog({ open, onOpenChange, blocker, project }: PickToArcDialogProps) {
  const { t } = useTerminology();
  const queryClient = useQueryClient();
  const { data: openArcs } = useArcs('open', { enabled: open });
  const { data: today } = useTodayPicks();
  const createArc = useCreateArc();
  const createTask = useCreateTask();
  const updateTask = useUpdateTask();
  const createPick = useCreateTodayPick();

  const [choice, setChoice] = React.useState<'none' | 'existing' | 'new'>('none');
  const [existingArcId, setExistingArcId] = React.useState('');
  const [newArcName, setNewArcName] = React.useState('');
  // MEDIUM-3 — "move it here instead" for a task already attached to a DIFFERENT arc.
  const [moveIfAlreadyInArc, setMoveIfAlreadyInArc] = React.useState(false);
  const [submitting, setSubmitting] = React.useState(false);
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null);

  const atCap = !!today && today.meta.uncompleted >= today.meta.cap;

  const targetArcId = choice === 'existing' ? existingArcId || null : choice === 'new' ? 'pending-new-arc' : null;
  const alreadyInArc = blocker.arc && targetArcId && blocker.arc.id !== targetArcId ? blocker.arc : null;

  async function submit() {
    setErrorMessage(null);
    setSubmitting(true);
    try {
      let arcId: string | null = null;
      if (choice === 'existing' && existingArcId) {
        arcId = existingArcId;
      } else if (choice === 'new' && newArcName.trim()) {
        const arc = await createArc.mutateAsync({ name: newArcName.trim(), project_id: project.id });
        arcId = arc.id;
      }

      const plan = buildSinglePickPlan(blocker, project.id, MIKE_USER_ID, arcId, moveIfAlreadyInArc);
      let taskId = plan.existingTaskId;
      if (plan.needsTaskCreation && plan.createTaskInput) {
        const task = await createTask.mutateAsync(plan.createTaskInput);
        taskId = task.id;
      }
      if (!taskId) throw new Error('No task to pick');

      if (plan.arcId) {
        await updateTask.mutateAsync({ id: taskId, data: { arc_id: plan.arcId } });
      }

      await createPick.mutateAsync({ item_type: 'task', task_id: taskId });
      queryClient.invalidateQueries({ queryKey: oracleProjectsKeys.all });
      showToast.success(
        plan.alreadyInArc
          ? `Picked. Left it in arc ${plan.alreadyInArc.name}.`
          : 'Added to today’s picks'
      );
      onOpenChange(false);
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Failed to pick');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal open={open} onOpenChange={onOpenChange}>
      <ModalContent size="md">
        <ModalHeader>
          <ModalTitle>Pick &quot;{blocker.title}&quot;</ModalTitle>
        </ModalHeader>
        <ModalBody>
          {atCap && (
            <div
              data-testid="wip-cap-warning"
              className="mb-3 rounded-lg border px-3 py-2 text-sm"
              style={{ borderColor: 'var(--warning-subtle)', backgroundColor: 'var(--warning-subtle)', color: 'var(--warning)' }}
            >
              Today&apos;s picks are already at the {today?.meta.cap ?? 5}-item cap.
            </div>
          )}

          <div className="flex flex-col gap-2">
            <label className="flex items-center gap-2 text-sm">
              <input type="radio" name="arc-choice" checked={choice === 'none'} onChange={() => setChoice('none')} />
              No arc, just pick the {t('task').toLowerCase()}
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="radio" name="arc-choice" checked={choice === 'existing'} onChange={() => setChoice('existing')} />
              Attach to an existing open arc
            </label>
            {choice === 'existing' && (
              <Select
                value={existingArcId}
                onChange={setExistingArcId}
                placeholder="Select an arc..."
                options={(openArcs?.arcs ?? []).map((arc) => ({ value: arc.id, label: arc.name }))}
                aria-label="Existing arc"
              />
            )}
            <label className="flex items-center gap-2 text-sm">
              <input type="radio" name="arc-choice" checked={choice === 'new'} onChange={() => setChoice('new')} />
              Create a new arc
            </label>
            {choice === 'new' && (
              <Input
                value={newArcName}
                onChange={(e) => setNewArcName(e.target.value)}
                placeholder="Arc name"
                aria-label="New arc name"
              />
            )}
          </div>

          {/* MEDIUM-3 — re-homing: flag a task already attached to a DIFFERENT arc than
              the one this pick targets, and require an explicit opt-in to move it. */}
          {alreadyInArc && (
            <div
              data-testid="already-in-arc-warning"
              className="mt-3 rounded-lg border px-3 py-2 text-sm"
              style={{ borderColor: 'var(--warning-subtle)', backgroundColor: 'var(--warning-subtle)', color: 'var(--warning)' }}
            >
              <p>Already in arc {alreadyInArc.name}.</p>
              <label className="mt-1 flex items-center gap-2 text-sm" style={{ color: 'var(--text-main)' }}>
                <input
                  type="checkbox"
                  checked={moveIfAlreadyInArc}
                  onChange={(e) => setMoveIfAlreadyInArc(e.target.checked)}
                  aria-label="Move it here instead"
                />
                Move it here instead
              </label>
            </div>
          )}

          {errorMessage && (
            <div data-testid="pick-error" className="mt-3 text-sm" style={{ color: 'var(--error)' }}>
              {errorMessage}
            </div>
          )}
        </ModalBody>
        <ModalFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="primary" onClick={submit} disabled={submitting}>
            Pick
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}

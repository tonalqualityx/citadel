'use client';

import * as React from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Checkbox } from '@/components/ui/checkbox';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { formatRelativeTime } from '@/lib/utils/time';
import { useCreateArc } from '@/lib/hooks/use-arcs';
import { useCreateTodayPick, useTodayPicks } from '@/lib/hooks/use-today';
import { useCreateTask, useUpdateTask } from '@/lib/hooks/use-tasks';
import { showToast } from '@/lib/hooks/use-toast';
import { useTerminology } from '@/lib/hooks/use-terminology';
import { oracleProjectsKeys } from '@/lib/hooks/use-oracle-projects';
import { MIKE_USER_ID } from '@/lib/oracle/projects/gate-constants';
import {
  buildMultiPickPlan,
  buildSinglePickPlan,
  defaultArcNameForHeading,
  type KindLensGroup,
  type MultiPickSelection,
} from './projects-logic';

interface KindLensProps {
  groups: KindLensGroup[];
  onOpenProject: (projectId: string) => void;
}

function rowKey(projectId: string, blockerId: string) {
  return `${projectId}::${blockerId}`;
}

function apiErrorMessage(err: unknown, fallback: string): string {
  return err instanceof Error ? err.message : fallback;
}

// Oracle Projects Tab Phase 4 — the by-kind lens: grouped rows with per-heading select-
// all and a sticky action bar once anything is selected ("Add to today's picks" / "New
// arc…"). Clicking a row (not its checkbox) opens the same project drawer the by-project
// lens uses.
//
// MEDIUM-5 — the WIP cap count shows up front (same as PickToArcDialog), and both
// multi-pick actions check remaining capacity BEFORE doing any writes: "Add to today's
// picks" refuses outright if the selection would exceed the cap (each task is its own
// pick), and "New arc…" checks against the ONE pick the new arc itself will consume. If
// an unexpected 409 lands mid-way through "Add to today's picks" anyway (a race with
// another pick elsewhere), the loop stops immediately, the selection is left exactly as
// it was (never cleared on a partial failure), and the error banner reports exactly how
// many succeeded before the API's own message is shown verbatim — never a bare catch.
export function KindLens({ groups, onOpenProject }: KindLensProps) {
  const { t } = useTerminology();
  const queryClient = useQueryClient();
  const createArc = useCreateArc();
  const createTask = useCreateTask();
  const updateTask = useUpdateTask();
  const createPick = useCreateTodayPick();
  const { data: today } = useTodayPicks();

  const [selected, setSelected] = React.useState<Map<string, MultiPickSelection>>(new Map());
  const [showNewArc, setShowNewArc] = React.useState(false);
  const [arcName, setArcName] = React.useState('');
  const [moveAlreadyArced, setMoveAlreadyArced] = React.useState(false);
  const [submitting, setSubmitting] = React.useState(false);
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null);

  const selection = Array.from(selected.values());
  const selectedCount = selection.length;
  const remainingCapacity = today ? Math.max(0, today.meta.cap - today.meta.uncompleted) : null;

  function toggleRow(sel: MultiPickSelection) {
    setErrorMessage(null);
    setSelected((prev) => {
      const next = new Map(prev);
      const key = rowKey(sel.project.id, sel.blocker.id);
      if (next.has(key)) next.delete(key);
      else next.set(key, sel);
      return next;
    });
  }

  function toggleGroup(group: KindLensGroup) {
    setErrorMessage(null);
    setSelected((prev) => {
      const next = new Map(prev);
      const allSelected = group.rows.every((r) => next.has(rowKey(r.project.id, r.blocker.id)));
      for (const row of group.rows) {
        const key = rowKey(row.project.id, row.blocker.id);
        if (allSelected) next.delete(key);
        else next.set(key, row);
      }
      return next;
    });
  }

  function invalidateProjects() {
    queryClient.invalidateQueries({ queryKey: oracleProjectsKeys.all });
  }

  async function addAllToToday() {
    setErrorMessage(null);
    // MEDIUM-5 — all-or-nothing: check capacity BEFORE starting. Each selected blocker
    // becomes exactly one Today pick, so the selection can never exceed remaining room.
    if (remainingCapacity !== null && selection.length > remainingCapacity) {
      setErrorMessage(
        `That's ${selection.length} picks, but only ${remainingCapacity} of ${today?.meta.cap ?? 5} today's-picks slots are left. Deselect some and try again.`
      );
      return;
    }

    setSubmitting(true);
    let succeeded = 0;
    try {
      for (const sel of selection) {
        const plan = buildSinglePickPlan(sel.blocker, sel.project.id, MIKE_USER_ID);
        let taskId = plan.existingTaskId;
        if (plan.needsTaskCreation && plan.createTaskInput) {
          const task = await createTask.mutateAsync(plan.createTaskInput);
          taskId = task.id;
        }
        if (taskId) {
          await createPick.mutateAsync({ item_type: 'task', task_id: taskId });
        }
        succeeded += 1;
      }
      showToast.success(`Added ${selection.length} to today's picks`);
      setSelected(new Map());
      invalidateProjects();
    } catch (err) {
      // An unexpected 409 (or any other failure) mid-loop: stop immediately, keep the
      // selection exactly as it was, and report exactly what got through.
      const remaining = selection.length - succeeded;
      setErrorMessage(
        `${succeeded} of ${selection.length} added before this happened: ${apiErrorMessage(err, 'Failed to add to today’s picks.')} ${remaining} left unpicked; your selection is unchanged.`
      );
      invalidateProjects();
    } finally {
      setSubmitting(false);
    }
  }

  async function createNewArc() {
    if (!arcName.trim()) return;
    setErrorMessage(null);

    // MEDIUM-5 — the new arc consumes exactly ONE Today pick, regardless of how many
    // tasks attach to it. Check that ONE slot before creating anything.
    if (remainingCapacity !== null && remainingCapacity < 1) {
      setErrorMessage(`Today's picks are already at the ${today?.meta.cap ?? 5}-item cap.`);
      return;
    }

    setSubmitting(true);
    try {
      const plan = buildMultiPickPlan(selection, arcName.trim(), MIKE_USER_ID, moveAlreadyArced);
      const arc = await createArc.mutateAsync({ name: plan.arcName, project_id: plan.projectId });

      const allTaskIds: string[] = [...plan.existingTaskIds];
      for (const toCreate of plan.tasksToCreate) {
        const task = await createTask.mutateAsync(toCreate.input);
        allTaskIds.push(task.id);
      }
      for (const taskId of allTaskIds) {
        await updateTask.mutateAsync({ id: taskId, data: { arc_id: arc.id } });
      }
      // The capacity check above is a pre-flight, not a guarantee — a concurrent pick
      // elsewhere can still 409 here. No bare catch: the API's own message is surfaced
      // verbatim rather than assumed.
      await createPick.mutateAsync({ item_type: 'arc', arc_id: arc.id });

      if (plan.skippedAlreadyInArc.length > 0) {
        showToast.success(
          `New arc created and picked. ${plan.skippedAlreadyInArc.length} ${plan.skippedAlreadyInArc.length === 1 ? t('task').toLowerCase() : t('tasks').toLowerCase()} ${plan.skippedAlreadyInArc.length === 1 ? 'was' : 'were'} already in another arc and left there.`
        );
      } else {
        showToast.success('New arc created and picked');
      }
      setSelected(new Map());
      setShowNewArc(false);
      setArcName('');
      setMoveAlreadyArced(false);
      invalidateProjects();
    } catch (err) {
      setErrorMessage(apiErrorMessage(err, 'Failed to create the arc.'));
      invalidateProjects();
    } finally {
      setSubmitting(false);
    }
  }

  function openNewArcInput() {
    const firstHeading = groups.find((g) => g.rows.some((r) => selected.has(rowKey(r.project.id, r.blocker.id))))?.heading;
    setArcName(defaultArcNameForHeading(firstHeading ?? 'Picks', new Date()));
    setShowNewArc(true);
    setErrorMessage(null);
  }

  const selectionHasArced = selection.some((s) => s.blocker.arc);

  return (
    <div className="flex flex-col gap-6 pb-20" data-testid="kind-lens">
      {/* MEDIUM-5 — the cap count shows up front, same as PickToArcDialog, not only once
          something is selected. Phase 5 carry-over F — while the Today query hasn't
          resolved yet, remainingCapacity is null, which addAllToToday/createNewArc both
          already treat as "no cap known" and let a pick proceed WITHOUT a pre-flight cap
          check. Shows a loading state here (rather than nothing) so Mike sees why the
          pick actions below are inert, instead of a silently-dead button. */}
      <div data-testid="kind-lens-cap-count" className="text-xs text-text-sub">
        {today ? (
          <>
            {today.meta.uncompleted} of {today.meta.cap} today&apos;s picks used
          </>
        ) : (
          "Loading today's picks…"
        )}
      </div>

      {groups.map((group) => {
        const allSelected = group.rows.length > 0 && group.rows.every((r) => selected.has(rowKey(r.project.id, r.blocker.id)));
        return (
          <section key={group.kind} data-testid={`kind-group-${group.kind}`}>
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-sm font-semibold uppercase tracking-wide text-text-sub">
                {group.heading} ({group.rows.length})
              </h3>
              <label className="flex items-center gap-2 text-xs text-text-sub">
                <Checkbox
                  checked={allSelected}
                  onCheckedChange={() => toggleGroup(group)}
                  aria-label={`Select all ${group.heading}`}
                />
                Select all
              </label>
            </div>
            <div className="flex flex-col gap-2">
              {group.rows.map(({ blocker, project }) => {
                const key = rowKey(project.id, blocker.id);
                return (
                  <div
                    key={key}
                    data-testid="kind-lens-row"
                    className="flex cursor-pointer items-start gap-2 rounded-lg border px-3 py-2"
                    style={{ borderColor: 'var(--border)' }}
                    onClick={() => onOpenProject(project.id)}
                  >
                    <div onClick={(e) => e.stopPropagation()}>
                      <Checkbox
                        checked={selected.has(key)}
                        onCheckedChange={() => toggleRow({ blocker, project })}
                        aria-label={`Select ${blocker.title}`}
                      />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="text-xs font-medium text-text-sub">{project.name}</div>
                      <div className="text-sm text-text-main">{blocker.title}</div>
                      <div className="text-xs text-text-sub">{formatRelativeTime(blocker.since)}</div>
                      {blocker.arc && (
                        <div data-testid="kind-lens-row-arc" className="text-xs" style={{ color: 'var(--warning)' }}>
                          Already in arc {blocker.arc.name}.
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        );
      })}

      {selectedCount > 0 && (
        <div
          data-testid="kind-lens-action-bar"
          className="fixed bottom-0 left-0 right-0 z-40 flex flex-col gap-2 border-t px-4 py-3 shadow-soft"
          style={{ borderColor: 'var(--border)', backgroundColor: 'var(--bg-elevated)' }}
        >
          {errorMessage && (
            <div data-testid="kind-lens-error" className="text-sm" style={{ color: 'var(--error)' }}>
              {errorMessage}
            </div>
          )}
          <div className="flex items-center justify-between gap-3">
            <span className="text-sm text-text-main">{selectedCount} selected</span>
            <div className="flex items-center gap-2">
              {showNewArc ? (
                <>
                  {selectionHasArced && (
                    <label className="flex items-center gap-2 text-xs text-text-sub">
                      <Checkbox
                        checked={moveAlreadyArced}
                        onCheckedChange={(checked) => setMoveAlreadyArced(!!checked)}
                        aria-label={`Move already-arc'd ${t('tasks').toLowerCase()} too`}
                      />
                      Move already-arc&apos;d {t('tasks').toLowerCase()} too
                    </label>
                  )}
                  <Input
                    value={arcName}
                    onChange={(e) => setArcName(e.target.value)}
                    aria-label="New arc name"
                    className="w-64"
                  />
                  <Button size="sm" variant="primary" onClick={createNewArc} disabled={submitting || !arcName.trim()}>
                    Create arc
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setShowNewArc(false)}>
                    Cancel
                  </Button>
                </>
              ) : (
                <>
                  <Button size="sm" variant="secondary" onClick={addAllToToday} disabled={submitting || !today}>
                    Add to today&apos;s picks
                  </Button>
                  <Button size="sm" variant="primary" onClick={openNewArcInput} disabled={submitting || !today}>
                    New arc…
                  </Button>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

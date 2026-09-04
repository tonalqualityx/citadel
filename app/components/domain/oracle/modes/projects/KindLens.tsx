'use client';

import * as React from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Checkbox } from '@/components/ui/checkbox';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { formatRelativeTime } from '@/lib/utils/time';
import { useCreateArc } from '@/lib/hooks/use-arcs';
import { useCreateTodayPick } from '@/lib/hooks/use-today';
import { useCreateTask, useUpdateTask } from '@/lib/hooks/use-tasks';
import { showToast } from '@/lib/hooks/use-toast';
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

// Oracle Projects Tab Phase 4 — the by-kind lens: grouped rows with per-heading select-
// all and a sticky action bar once anything is selected ("Add to today's picks" / "New
// arc…"). Clicking a row (not its checkbox) opens the same project drawer the by-project
// lens uses.
export function KindLens({ groups, onOpenProject }: KindLensProps) {
  const queryClient = useQueryClient();
  const createArc = useCreateArc();
  const createTask = useCreateTask();
  const updateTask = useUpdateTask();
  const createPick = useCreateTodayPick();

  const [selected, setSelected] = React.useState<Map<string, MultiPickSelection>>(new Map());
  const [showNewArc, setShowNewArc] = React.useState(false);
  const [arcName, setArcName] = React.useState('');
  const [submitting, setSubmitting] = React.useState(false);

  const selection = Array.from(selected.values());
  const selectedCount = selection.length;

  function toggleRow(sel: MultiPickSelection) {
    setSelected((prev) => {
      const next = new Map(prev);
      const key = rowKey(sel.project.id, sel.blocker.id);
      if (next.has(key)) next.delete(key);
      else next.set(key, sel);
      return next;
    });
  }

  function toggleGroup(group: KindLensGroup) {
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
    setSubmitting(true);
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
      }
      showToast.success(`Added ${selection.length} to today's picks`);
      setSelected(new Map());
      invalidateProjects();
    } catch {
      // hooks already toast their own errors
    } finally {
      setSubmitting(false);
    }
  }

  async function createNewArc() {
    if (!arcName.trim()) return;
    setSubmitting(true);
    try {
      const plan = buildMultiPickPlan(selection, arcName.trim(), MIKE_USER_ID);
      const arc = await createArc.mutateAsync({ name: plan.arcName, project_id: plan.projectId });

      const allTaskIds: string[] = [...plan.existingTaskIds];
      for (const toCreate of plan.tasksToCreate) {
        const task = await createTask.mutateAsync(toCreate.input);
        allTaskIds.push(task.id);
      }
      for (const taskId of allTaskIds) {
        await updateTask.mutateAsync({ id: taskId, data: { arc_id: arc.id } });
      }
      await createPick.mutateAsync({ item_type: 'arc', arc_id: arc.id });

      showToast.success('New arc created and picked');
      setSelected(new Map());
      setShowNewArc(false);
      setArcName('');
      invalidateProjects();
    } catch {
      // hooks already toast their own errors
    } finally {
      setSubmitting(false);
    }
  }

  function openNewArcInput() {
    const firstHeading = groups.find((g) => g.rows.some((r) => selected.has(rowKey(r.project.id, r.blocker.id))))?.heading;
    setArcName(defaultArcNameForHeading(firstHeading ?? 'Picks', new Date()));
    setShowNewArc(true);
  }

  return (
    <div className="flex flex-col gap-6 pb-20" data-testid="kind-lens">
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
          className="fixed bottom-0 left-0 right-0 z-40 flex items-center justify-between gap-3 border-t px-4 py-3 shadow-soft"
          style={{ borderColor: 'var(--border)', backgroundColor: 'var(--bg-elevated)' }}
        >
          <span className="text-sm text-text-main">{selectedCount} selected</span>
          <div className="flex items-center gap-2">
            {showNewArc ? (
              <>
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
                <Button size="sm" variant="secondary" onClick={addAllToToday} disabled={submitting}>
                  Add to today&apos;s picks
                </Button>
                <Button size="sm" variant="primary" onClick={openNewArcInput} disabled={submitting}>
                  New arc…
                </Button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

'use client';

import * as React from 'react';
import { X, Search, AlertTriangle, Plus, Repeat } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Modal, ModalContent, ModalHeader, ModalTitle, ModalBody } from '@/components/ui/modal';
import { Spinner } from '@/components/ui/spinner';
import { useUpdateTask, RecipeTask, RecipePhase } from '@/lib/hooks/use-recipes';
import { showToast } from '@/lib/hooks/use-toast';

interface RecipeTaskDependenciesProps {
  recipeId: string;
  task: RecipeTask;
  phaseId: string;
  allPhases: RecipePhase[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

// Build a flat list of all tasks from all phases
function getAllTasks(phases: RecipePhase[]): (RecipeTask & { phaseName: string; phaseId: string })[] {
  const tasks: (RecipeTask & { phaseName: string; phaseId: string })[] = [];
  for (const phase of phases) {
    for (const task of phase.tasks || []) {
      tasks.push({ ...task, phaseName: phase.name, phaseId: phase.id });
    }
  }
  return tasks;
}

// Check if adding a dependency would create a cycle
function wouldCreateCycle(
  taskId: string,
  newBlockerId: string,
  allTasks: RecipeTask[],
  pendingDeps: string[]
): boolean {
  // Build adjacency list: task -> tasks it depends on
  const graph = new Map<string, string[]>();
  for (const task of allTasks) {
    if (task.id === taskId) {
      // Use pending deps for the task we're editing
      graph.set(task.id, [...pendingDeps, newBlockerId]);
    } else {
      graph.set(task.id, task.depends_on_ids || []);
    }
  }

  // Check if newBlockerId can reach back to taskId (would create cycle)
  const visited = new Set<string>();

  function canReach(from: string, target: string): boolean {
    if (from === target) return true;
    if (visited.has(from)) return false;
    visited.add(from);

    const deps = graph.get(from) || [];
    for (const dep of deps) {
      if (canReach(dep, target)) return true;
    }
    return false;
  }

  return canReach(newBlockerId, taskId);
}

export function RecipeTaskDependencies({
  recipeId,
  task,
  phaseId,
  allPhases,
  open,
  onOpenChange,
}: RecipeTaskDependenciesProps) {
  const [search, setSearch] = React.useState('');
  const [pendingDeps, setPendingDeps] = React.useState<string[]>([]);
  const [hasChanges, setHasChanges] = React.useState(false);

  const updateTask = useUpdateTask();

  // Initialize pending deps when modal opens
  React.useEffect(() => {
    if (open) {
      setPendingDeps(task.depends_on_ids || []);
      setHasChanges(false);
      setSearch('');
    }
  }, [open, task.depends_on_ids]);

  // Get all tasks from all phases
  const allTasks = React.useMemo(() => getAllTasks(allPhases), [allPhases]);

  // Get current blockers
  const currentBlockers = React.useMemo(() => {
    return allTasks.filter((t) => pendingDeps.includes(t.id));
  }, [allTasks, pendingDeps]);

  // Get available tasks (not current task, not already a blocker)
  const availableTasks = React.useMemo(() => {
    const blockerSet = new Set(pendingDeps);
    return allTasks.filter((t) => {
      if (t.id === task.id) return false;
      if (blockerSet.has(t.id)) return false;
      if (search && !t.sop.title.toLowerCase().includes(search.toLowerCase())) return false;
      return true;
    });
  }, [allTasks, task.id, pendingDeps, search]);

  // Group available tasks by phase
  const tasksByPhase = React.useMemo(() => {
    const grouped = new Map<string, typeof availableTasks>();
    for (const t of availableTasks) {
      const existing = grouped.get(t.phaseId) || [];
      existing.push(t);
      grouped.set(t.phaseId, existing);
    }
    return grouped;
  }, [availableTasks]);

  const handleAddBlocker = (blockerId: string) => {
    // Check for circular dependency
    if (wouldCreateCycle(task.id, blockerId, allTasks, pendingDeps)) {
      showToast.error('Cannot add: would create circular dependency');
      return;
    }
    setPendingDeps((prev) => [...prev, blockerId]);
    setHasChanges(true);
  };

  const handleRemoveBlocker = (blockerId: string) => {
    setPendingDeps((prev) => prev.filter((id) => id !== blockerId));
    setHasChanges(true);
  };

  const handleSave = async () => {
    try {
      await updateTask.mutateAsync({
        recipeId,
        phaseId,
        taskId: task.id,
        data: { depends_on_ids: pendingDeps },
      });
      showToast.success('Dependencies updated');
      onOpenChange(false);
    } catch (error) {
      showToast.apiError(error, 'Failed to update dependencies');
    }
  };

  const taskTitle = task.title || task.sop.title;

  return (
    <Modal open={open} onOpenChange={onOpenChange}>
      <ModalContent size="md">
        <ModalHeader>
          <ModalTitle className="flex items-center gap-2">
            Dependencies for &quot;{taskTitle}&quot;
            {task.is_variable && (
              <Badge variant="purple" className="ml-2">
                <Repeat className="h-3 w-3 mr-1" />
                Variable
              </Badge>
            )}
          </ModalTitle>
        </ModalHeader>
        <ModalBody>
          <p className="text-sm text-text-sub mb-4">
            Select tasks that must be completed before this task can start.
            {task.is_variable && (
              <span className="block mt-1 text-xs">
                When expanded, each instance will depend on matching blockers.
              </span>
            )}
          </p>

          {/* Current Blockers */}
          {currentBlockers.length > 0 && (
            <div className="mb-4">
              <div className="flex items-center gap-2 text-sm font-medium text-text-sub mb-2">
                <AlertTriangle className="h-4 w-4 text-amber-500" />
                Blocked by ({currentBlockers.length})
              </div>
              <div className="space-y-2 max-h-32 overflow-y-auto">
                {currentBlockers.map((blocker) => (
                  <div
                    key={blocker.id}
                    className="flex items-center justify-between p-2 rounded border border-border bg-surface-alt group"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-text-main truncate">
                          {blocker.title || blocker.sop.title}
                        </span>
                        {blocker.is_variable && (
                          <Badge variant="purple" size="sm">
                            <Repeat className="h-2.5 w-2.5" />
                          </Badge>
                        )}
                      </div>
                      <span className="text-xs text-text-sub">{blocker.phaseName}</span>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="opacity-60 group-hover:opacity-100"
                      onClick={() => handleRemoveBlocker(blocker.id)}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Search */}
          <div className="relative mb-4">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-text-sub" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search tasks..."
              className="pl-10"
            />
          </div>

          {/* Available Tasks by Phase */}
          <div className="max-h-64 overflow-y-auto space-y-4">
            {allPhases.map((phase) => {
              const phaseTasks = tasksByPhase.get(phase.id) || [];
              if (phaseTasks.length === 0) return null;

              return (
                <div key={phase.id}>
                  <div className="text-xs font-semibold text-text-sub uppercase tracking-wide mb-2">
                    {phase.name}
                  </div>
                  <div className="space-y-1">
                    {phaseTasks.map((t) => {
                      const wouldCycle = wouldCreateCycle(task.id, t.id, allTasks, pendingDeps);
                      return (
                        <button
                          key={t.id}
                          type="button"
                          onClick={() => handleAddBlocker(t.id)}
                          disabled={wouldCycle}
                          className={`w-full text-left p-2 rounded border transition-colors flex items-center gap-2 ${
                            wouldCycle
                              ? 'border-border bg-surface opacity-50 cursor-not-allowed'
                              : 'border-border hover:bg-surface-2 hover:border-primary'
                          }`}
                        >
                          <Plus className="h-4 w-4 text-text-sub flex-shrink-0" />
                          <span className="text-sm text-text-main truncate flex-1">
                            {t.title || t.sop.title}
                          </span>
                          {t.is_variable && (
                            <Badge variant="purple" size="sm">
                              <Repeat className="h-2.5 w-2.5" />
                            </Badge>
                          )}
                          {wouldCycle && (
                            <span className="text-xs text-amber-500">circular</span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}

            {availableTasks.length === 0 && (
              <p className="text-sm text-text-sub text-center py-4">
                {search ? 'No matching tasks found' : 'No other tasks available'}
              </p>
            )}
          </div>

          {/* Actions */}
          <div className="flex justify-end gap-3 mt-4 pt-4 border-t border-border">
            <Button
              variant="secondary"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button
              onClick={handleSave}
              disabled={!hasChanges || updateTask.isPending}
            >
              {updateTask.isPending ? <Spinner size="sm" className="mr-2" /> : null}
              Save Changes
            </Button>
          </div>
        </ModalBody>
      </ModalContent>
    </Modal>
  );
}

'use client';

import * as React from 'react';
import Link from 'next/link';
import { Plus, X, Search, AlertTriangle, ArrowRight } from 'lucide-react';
import { useAddDependency, useRemoveDependency, useTasks } from '@/lib/hooks/use-tasks';
import { useAuth } from '@/lib/hooks/use-auth';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Modal, ModalContent, ModalHeader, ModalTitle, ModalBody } from '@/components/ui/modal';
import { Spinner } from '@/components/ui/spinner';
import { showToast } from '@/lib/hooks/use-toast';
import { getTaskStatusLabel, getTaskStatusVariant } from '@/lib/calculations/status';

interface BlockerTask {
  id: string;
  title: string;
  status: string;
}

interface TaskDependenciesProps {
  taskId: string;
  taskTitle: string;
  projectId: string | null;
  blockedBy: BlockerTask[];
  blocking: BlockerTask[];
}

export function TaskDependencies({
  taskId,
  taskTitle,
  projectId,
  blockedBy,
  blocking,
}: TaskDependenciesProps) {
  const { isPmOrAdmin } = useAuth();
  const [isAddModalOpen, setIsAddModalOpen] = React.useState(false);
  const [search, setSearch] = React.useState('');
  const [isSearching, setIsSearching] = React.useState(false);

  const addDependency = useAddDependency();
  const removeDependency = useRemoveDependency();

  // Search for tasks to add as blockers
  const { data: searchResults, isLoading: isLoadingSearch } = useTasks({
    search: search.length >= 2 ? search : undefined,
    project_id: projectId || undefined,
    limit: 10,
  });

  const hasBlockers = blockedBy.length > 0;
  const isBlocking = blocking.length > 0;

  // Filter out current task and already-blocking tasks from search results
  const filteredResults = React.useMemo(() => {
    if (!searchResults?.tasks) return [];
    const blockerIds = new Set(blockedBy.map((b) => b.id));
    return searchResults.tasks.filter(
      (t) => t.id !== taskId && !blockerIds.has(t.id)
    );
  }, [searchResults?.tasks, taskId, blockedBy]);

  const handleAddBlocker = async (blockerId: string) => {
    try {
      await addDependency.mutateAsync({ taskId, blockerId });
      showToast.success('Blocker added');
      setIsAddModalOpen(false);
      setSearch('');
    } catch (error) {
      showToast.apiError(error, 'Failed to add blocker');
    }
  };

  const handleRemoveBlocker = async (blockerId: string) => {
    try {
      await removeDependency.mutateAsync({ taskId, blockerId });
      showToast.success('Blocker removed');
    } catch (error) {
      showToast.apiError(error, 'Failed to remove blocker');
    }
  };

  // Only show card if there are dependencies OR user can edit
  if (!hasBlockers && !isBlocking && !isPmOrAdmin) {
    return null;
  }

  return (
    <>
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">Dependencies</CardTitle>
            {isPmOrAdmin && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setIsAddModalOpen(true)}
              >
                <Plus className="h-4 w-4 mr-1" />
                Add Blocker
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Blocked By Section */}
          {hasBlockers && (
            <div>
              <div className="flex items-center gap-2 text-sm font-medium text-text-sub mb-2">
                <AlertTriangle className="h-4 w-4 text-amber-500" />
                Blocked by
              </div>
              <div className="space-y-2">
                {blockedBy.map((blocker) => (
                  <div
                    key={blocker.id}
                    className="flex items-center justify-between p-2 rounded border border-border hover:bg-surface-2 group"
                  >
                    <Link
                      href={`/tasks/${blocker.id}`}
                      className="flex-1 min-w-0"
                    >
                      <div className="text-sm font-medium text-text-main truncate">
                        {blocker.title}
                      </div>
                      <Badge
                        variant={getTaskStatusVariant(blocker.status as any)}
                        className="mt-1"
                      >
                        {getTaskStatusLabel(blocker.status as any)}
                      </Badge>
                    </Link>
                    {isPmOrAdmin && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="opacity-0 group-hover:opacity-100 ml-2"
                        onClick={(e) => {
                          e.preventDefault();
                          handleRemoveBlocker(blocker.id);
                        }}
                        disabled={removeDependency.isPending}
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Blocking Section */}
          {isBlocking && (
            <div>
              <div className="flex items-center gap-2 text-sm font-medium text-text-sub mb-2">
                <ArrowRight className="h-4 w-4 text-blue-500" />
                Blocking
              </div>
              <div className="space-y-2">
                {blocking.map((blocked) => (
                  <Link
                    key={blocked.id}
                    href={`/tasks/${blocked.id}`}
                    className="block p-2 rounded border border-border hover:bg-surface-2"
                  >
                    <div className="text-sm font-medium text-text-main truncate">
                      {blocked.title}
                    </div>
                    <Badge
                      variant={getTaskStatusVariant(blocked.status as any)}
                      className="mt-1"
                    >
                      {getTaskStatusLabel(blocked.status as any)}
                    </Badge>
                  </Link>
                ))}
              </div>
            </div>
          )}

          {/* Empty State */}
          {!hasBlockers && !isBlocking && (
            <p className="text-sm text-text-sub italic">
              No dependencies. Use &quot;Add Blocker&quot; to set up task sequencing.
            </p>
          )}
        </CardContent>
      </Card>

      {/* Add Blocker Modal */}
      <Modal open={isAddModalOpen} onOpenChange={setIsAddModalOpen}>
        <ModalContent size="md">
          <ModalHeader>
            <ModalTitle>Add Blocker</ModalTitle>
          </ModalHeader>
          <ModalBody>
            <p className="text-sm text-text-sub mb-4">
              Select a task that must be completed before &quot;{taskTitle}&quot; can start.
            </p>

            <div className="relative mb-4">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-text-sub" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search tasks..."
                className="pl-10"
                autoFocus
              />
            </div>

            <div className="max-h-64 overflow-y-auto space-y-2">
              {isLoadingSearch && search.length >= 2 ? (
                <div className="flex justify-center py-4">
                  <Spinner size="sm" />
                </div>
              ) : search.length < 2 ? (
                <p className="text-sm text-text-sub text-center py-4">
                  Type at least 2 characters to search
                </p>
              ) : filteredResults.length === 0 ? (
                <p className="text-sm text-text-sub text-center py-4">
                  No matching tasks found
                </p>
              ) : (
                filteredResults.map((task) => (
                  <button
                    key={task.id}
                    type="button"
                    onClick={() => handleAddBlocker(task.id)}
                    disabled={addDependency.isPending}
                    className="w-full text-left p-3 rounded border border-border hover:bg-surface-2 hover:border-primary transition-colors"
                  >
                    <div className="font-medium text-text-main">{task.title}</div>
                    <div className="flex items-center gap-2 mt-1">
                      <Badge variant={getTaskStatusVariant(task.status as any)}>
                        {getTaskStatusLabel(task.status as any)}
                      </Badge>
                      {task.project && (
                        <span className="text-xs text-text-sub">
                          {task.project.name}
                        </span>
                      )}
                    </div>
                  </button>
                ))
              )}
            </div>

            <div className="flex justify-end mt-4">
              <Button
                variant="secondary"
                onClick={() => {
                  setIsAddModalOpen(false);
                  setSearch('');
                }}
              >
                Cancel
              </Button>
            </div>
          </ModalBody>
        </ModalContent>
      </Modal>
    </>
  );
}

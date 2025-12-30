'use client';

import * as React from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { Plus, CheckSquare, AlertCircle, Clock } from 'lucide-react';
import { useTasks, useUpdateTask } from '@/lib/hooks/use-tasks';
import { useUsers } from '@/lib/hooks/use-users';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { SearchInput } from '@/components/ui/search-input';
import { Select } from '@/components/ui/select';
import { MultiSelect } from '@/components/ui/multi-select';
import { SkeletonTable } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/ui/empty-state';
import {
  Modal,
  ModalContent,
  ModalHeader,
  ModalTitle,
  ModalBody,
} from '@/components/ui/modal';
import { TaskForm } from '@/components/domain/tasks/task-form';
import { TaskPeekDrawer } from '@/components/domain/tasks/task-peek-drawer';
import { TaskList } from '@/components/ui/task-list';
import {
  titleColumn,
  statusColumn,
  priorityColumn,
  assigneeColumn,
  rangedEstimateColumn,
  batteryColumn,
  actionsColumn,
} from '@/components/ui/task-list-columns';
import type { Task } from '@/lib/hooks/use-tasks';

const statusOptions = [
  { value: 'not_started', label: 'Not Started' },
  { value: 'in_progress', label: 'In Progress' },
  { value: 'review', label: 'Review' },
  { value: 'blocked', label: 'Blocked' },
  { value: 'done', label: 'Done' },
  { value: 'abandoned', label: 'Abandoned' },
];

const priorityOptions = [
  { value: '1', label: 'Critical' },
  { value: '2', label: 'High' },
  { value: '3', label: 'Medium' },
  { value: '4', label: 'Low' },
];

// Default to showing active tasks
const DEFAULT_STATUSES = ['not_started', 'in_progress'];

export default function QuestsPage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const projectIdParam = searchParams.get('project_id');

  const [search, setSearch] = React.useState('');
  const [statuses, setStatuses] = React.useState<string[]>(DEFAULT_STATUSES);
  const [priority, setPriority] = React.useState('');
  const [assigneeId, setAssigneeId] = React.useState('');
  const [page, setPage] = React.useState(1);
  const [allTasks, setAllTasks] = React.useState<Task[]>([]);
  const [isCreateOpen, setIsCreateOpen] = React.useState(false);
  const [peekTaskId, setPeekTaskId] = React.useState<string | null>(null);
  const [isPeekOpen, setIsPeekOpen] = React.useState(false);

  // Fetch users for the assignee filter
  const { data: usersData } = useUsers();
  const userOptions = React.useMemo(() => {
    if (!usersData?.users) return [];
    return usersData.users.map((user) => ({
      value: user.id,
      label: user.name,
    }));
  }, [usersData]);

  // Reset tasks when filters change
  React.useEffect(() => {
    setPage(1);
    setAllTasks([]);
  }, [search, statuses, priority, assigneeId]);

  const { data, isLoading, error } = useTasks({
    page,
    search: search || undefined,
    statuses: statuses.length > 0 ? statuses : undefined,
    priority: priority ? parseInt(priority) : undefined,
    assignee_id: assigneeId || undefined,
    project_id: projectIdParam || undefined,
  });

  // Accumulate tasks for "load more" pattern
  React.useEffect(() => {
    if (data?.tasks) {
      if (page === 1) {
        setAllTasks(data.tasks);
      } else {
        setAllTasks((prev) => [...prev, ...data.tasks]);
      }
    }
  }, [data?.tasks, page]);

  const updateTask = useUpdateTask();

  const handleTaskClick = (task: Task) => {
    setPeekTaskId(task.id);
    setIsPeekOpen(true);
  };

  const handleTaskUpdate = (taskId: string, updates: Partial<Task>) => {
    updateTask.mutate({ id: taskId, data: updates as any });
  };

  const handleLoadMore = () => {
    if (data && page < data.totalPages) {
      setPage((prev) => prev + 1);
    }
  };

  const handleCreateSuccess = () => {
    setIsCreateOpen(false);
  };

  // Define columns with inline editing
  const columns = [
    titleColumn({ editable: true, showProject: true }),
    statusColumn({ editable: true }),
    priorityColumn({ editable: true }),
    assigneeColumn({ editable: true }),
    rangedEstimateColumn(),
    batteryColumn({ editable: true }),
    actionsColumn({ onViewDetails: (task) => router.push(`/tasks/${task.id}`) }),
  ];

  if (error) {
    return (
      <div className="p-6">
        <Card>
          <CardContent className="py-8">
            <EmptyState
              icon={<CheckSquare className="h-12 w-12" />}
              title="Error loading quests"
              description="There was a problem loading the quest list. Please try again."
              action={
                <Button onClick={() => window.location.reload()}>Retry</Button>
              }
            />
          </CardContent>
        </Card>
      </div>
    );
  }

  const inProgressCount = data?.tasks.filter((t) => t.status === 'in_progress').length || 0;
  const blockedCount = data?.tasks.filter((t) => t.status === 'blocked').length || 0;

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-text-main">Quests</h1>
          <p className="text-text-sub">Manage your tasks and track progress</p>
        </div>
        <Button onClick={() => setIsCreateOpen(true)}>
          <Plus className="h-4 w-4 mr-2" />
          New Quest
        </Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardContent className="py-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-primary/10">
                <CheckSquare className="h-5 w-5 text-primary" />
              </div>
              <div>
                <div className="text-2xl font-semibold text-text-main">
                  {data?.total || 0}
                </div>
                <div className="text-sm text-text-sub">Total Quests</div>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-amber-500/10">
                <Clock className="h-5 w-5 text-amber-500" />
              </div>
              <div>
                <div className="text-2xl font-semibold text-text-main">
                  {inProgressCount}
                </div>
                <div className="text-sm text-text-sub">In Progress</div>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-red-500/10">
                <AlertCircle className="h-5 w-5 text-red-500" />
              </div>
              <div>
                <div className="text-2xl font-semibold text-text-main">
                  {blockedCount}
                </div>
                <div className="text-sm text-text-sub">Blocked</div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="py-4">
          <div className="flex flex-col md:flex-row gap-4">
            <SearchInput
              value={search}
              onChange={setSearch}
              placeholder="Search quests..."
              className="md:w-64"
            />
            <MultiSelect
              options={statusOptions}
              value={statuses}
              onChange={setStatuses}
              placeholder="All statuses"
              className="md:w-48"
            />
            <Select
              options={priorityOptions}
              value={priority}
              onChange={setPriority}
              placeholder="All priorities"
              className="md:w-40"
            />
            <Select
              options={userOptions}
              value={assigneeId}
              onChange={setAssigneeId}
              placeholder="All assignees"
              className="md:w-48"
            />
          </div>
        </CardContent>
      </Card>

      {/* Task List */}
      {isLoading && page === 1 ? (
        <Card>
          <CardContent className="p-0">
            <SkeletonTable rows={5} columns={6} />
          </CardContent>
        </Card>
      ) : (
        <TaskList
          tasks={allTasks}
          columns={columns}
          onTaskClick={handleTaskClick}
          onTaskUpdate={handleTaskUpdate}
          onLoadMore={handleLoadMore}
          hasMore={data ? page < data.totalPages : false}
          isLoading={isLoading && page > 1}
          emptyMessage={
            search || statuses.length > 0 || priority || assigneeId
              ? 'No quests found. Try adjusting your filters.'
              : 'No quests yet. Create your first quest to get started.'
          }
        />
      )}

      {/* Create Modal */}
      <Modal open={isCreateOpen} onOpenChange={setIsCreateOpen}>
        <ModalContent size="lg">
          <ModalHeader>
            <ModalTitle>Create New Quest</ModalTitle>
          </ModalHeader>
          <ModalBody>
            <TaskForm
              defaultProjectId={projectIdParam || undefined}
              onSuccess={handleCreateSuccess}
              onCancel={() => setIsCreateOpen(false)}
            />
          </ModalBody>
        </ModalContent>
      </Modal>

      {/* Peek Drawer */}
      <TaskPeekDrawer
        taskId={peekTaskId}
        open={isPeekOpen}
        onOpenChange={setIsPeekOpen}
      />
    </div>
  );
}

'use client';

import * as React from 'react';
import Link from 'next/link';
import {
  DndContext,
  DragOverlay,
  closestCorners,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragStartEvent,
  type DragEndEvent,
} from '@dnd-kit/core';
import { useDroppable } from '@dnd-kit/core';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { TagChips } from '@/components/ui/tag-chips';
import { Spinner } from '@/components/ui/spinner';
import { cn } from '@/lib/utils/cn';
import { useTasks, useUpdateTaskStatus, type Task } from '@/lib/hooks/use-tasks';
import { useCharterCommissionTasks } from '@/lib/hooks/use-charters';
import {
  energyToMinutes,
  getMysteryMultiplier,
  getBatteryMultiplier,
  formatHours,
} from '@/lib/calculations/energy';

interface CharterKanbanProps {
  charterId: string;
}

type TaskType = 'scheduled' | 'ad_hoc' | 'commission';
type ColumnId = 'ready' | 'in_progress' | 'done';

interface Column {
  id: ColumnId;
  title: string;
  statuses: string[];
}

const COLUMNS: Column[] = [
  { id: 'ready', title: 'Ready', statuses: ['not_started', 'blocked'] },
  { id: 'in_progress', title: 'In Progress', statuses: ['in_progress'] },
  { id: 'done', title: 'Done', statuses: ['done', 'abandoned'] },
];

const STATUS_FOR_COLUMN: Record<ColumnId, string> = {
  ready: 'not_started',
  in_progress: 'in_progress',
  done: 'done',
};

const COLUMN_COLORS: Record<ColumnId, {
  columnBg: string;
  columnHeader: string;
  countBg: string;
  cardBg: string;
  cardBorder: string;
  dropRing: string;
}> = {
  ready: {
    columnBg: 'bg-slate-50 dark:bg-slate-900/30',
    columnHeader: 'text-slate-500',
    countBg: 'bg-slate-200 text-slate-600 dark:bg-slate-700 dark:text-slate-300',
    cardBg: 'bg-slate-50 dark:bg-slate-800/50',
    cardBorder: 'border-slate-200 dark:border-slate-700',
    dropRing: 'ring-slate-300',
  },
  in_progress: {
    columnBg: 'bg-blue-50 dark:bg-blue-950/30',
    columnHeader: 'text-blue-600 dark:text-blue-400',
    countBg: 'bg-blue-200 text-blue-700 dark:bg-blue-800 dark:text-blue-200',
    cardBg: 'bg-blue-50 dark:bg-blue-900/30',
    cardBorder: 'border-blue-200 dark:border-blue-800',
    dropRing: 'ring-blue-300',
  },
  done: {
    columnBg: 'bg-emerald-50 dark:bg-emerald-950/30',
    columnHeader: 'text-emerald-600 dark:text-emerald-400',
    countBg: 'bg-emerald-200 text-emerald-700 dark:bg-emerald-800 dark:text-emerald-200',
    cardBg: 'bg-emerald-50 dark:bg-emerald-900/30',
    cardBorder: 'border-emerald-200 dark:border-emerald-800',
    dropRing: 'ring-emerald-300',
  },
};

const TASK_TYPE_LABELS: Record<TaskType, string> = {
  scheduled: 'Scheduled',
  ad_hoc: 'Ad Hoc',
  commission: 'Commission',
};

const TASK_TYPE_ORDER: TaskType[] = ['scheduled', 'commission', 'ad_hoc'];

function getCurrentPeriod(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

function classifyTask(task: Task): TaskType {
  if (task.project_id) return 'commission';
  if ((task as any).is_retainer_work) return 'scheduled';
  return 'ad_hoc';
}

function isOverdue(task: Task): boolean {
  if (!task.due_date) return false;
  if (task.status === 'done' || task.status === 'abandoned') return false;
  return new Date(task.due_date) < new Date();
}

function isPendingReview(task: Task): boolean {
  return task.status === 'done' && task.needs_review && !task.approved;
}

function getEstimateRange(task: Task): string | null {
  if (!task.energy_estimate) return null;
  const base = energyToMinutes(task.energy_estimate);
  const mystery = getMysteryMultiplier(task.mystery_factor as any);
  const battery = getBatteryMultiplier(task.battery_impact as any);
  const high = Math.round(base * mystery * battery);
  if (base === high) return formatHours(base);
  return `${formatHours(base)} – ${formatHours(high)}`;
}

export function CharterKanban({ charterId }: CharterKanbanProps) {
  const period = getCurrentPeriod();
  const { data: charterData, isLoading: charterLoading, isError: charterError } = useTasks({
    charter_id: charterId,
    maintenance_period: period,
    limit: 200,
  });
  const { data: commissionData, isLoading: commissionLoading } = useCharterCommissionTasks(charterId, period);
  const updateStatus = useUpdateTaskStatus();
  const [activeTask, setActiveTask] = React.useState<Task | null>(null);
  const [collapsedTypes, setCollapsedTypes] = React.useState<Set<TaskType>>(new Set());

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor)
  );

  const charterTasks = charterData?.tasks ?? [];
  const commissionTasks = commissionData?.tasks ?? [];

  // Merge charter + commission tasks, dedup by id
  const allTasks = React.useMemo(() => {
    const seen = new Set<string>();
    const merged: Task[] = [];
    for (const task of [...charterTasks, ...commissionTasks]) {
      if (!seen.has(task.id)) {
        seen.add(task.id);
        merged.push(task);
      }
    }
    return merged;
  }, [charterTasks, commissionTasks]);

  // Group by type, then by column
  const tasksByTypeAndColumn = React.useMemo(() => {
    const result = new Map<TaskType, Record<ColumnId, Task[]>>();
    for (const task of allTasks) {
      const type = classifyTask(task);
      if (!result.has(type)) {
        result.set(type, { ready: [], in_progress: [], done: [] });
      }
      const cols = result.get(type)!;
      const col = COLUMNS.find((c) => c.statuses.includes(task.status));
      if (col) cols[col.id].push(task);
      else cols.ready.push(task);
    }
    return result;
  }, [allTasks]);

  const activeTypes = TASK_TYPE_ORDER.filter((t) => tasksByTypeAndColumn.has(t));

  const toggleType = (type: TaskType) => {
    setCollapsedTypes((prev) => {
      const next = new Set(prev);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      return next;
    });
  };

  const handleDragStart = (event: DragStartEvent) => {
    const task = allTasks.find((t) => t.id === event.active.id);
    setActiveTask(task ?? null);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    setActiveTask(null);
    const { active, over } = event;
    if (!over) return;

    const taskId = active.id as string;
    // Extract the column id from the droppable id (format: "type-columnId")
    const overId = over.id as string;
    const targetColumn = overId.includes('-')
      ? overId.split('-').pop() as ColumnId
      : overId as ColumnId;
    const task = allTasks.find((t) => t.id === taskId);
    if (!task) return;

    const currentColumn = COLUMNS.find((c) => c.statuses.includes(task.status));
    if (currentColumn?.id === targetColumn) return;

    const newStatus = STATUS_FOR_COLUMN[targetColumn];
    if (newStatus) {
      updateStatus.mutate({ id: taskId, status: newStatus });
    }
  };

  const isLoading = charterLoading || commissionLoading;

  if (isLoading) {
    return (
      <div className="flex justify-center py-12">
        <Spinner size="md" />
      </div>
    );
  }

  if (charterError) {
    return (
      <div className="text-center py-12 text-text-sub text-sm">
        Failed to load tasks.
      </div>
    );
  }

  if (allTasks.length === 0) {
    return (
      <div className="text-center py-12 text-text-sub text-sm">
        No tasks for this period.
      </div>
    );
  }

  // If only one type, render flat kanban (no swimlanes)
  if (activeTypes.length <= 1) {
    const tasksByColumn: Record<ColumnId, Task[]> = { ready: [], in_progress: [], done: [] };
    for (const task of allTasks) {
      const col = COLUMNS.find((c) => c.statuses.includes(task.status));
      if (col) tasksByColumn[col.id].push(task);
      else tasksByColumn.ready.push(task);
    }

    return (
      <DndContext
        sensors={sensors}
        collisionDetection={closestCorners}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 min-h-[18rem]">
          {COLUMNS.map((col) => (
            <KanbanColumn
              key={col.id}
              column={col}
              tasks={tasksByColumn[col.id]}
              droppableId={col.id}
            />
          ))}
        </div>
        <DragOverlay>
          {activeTask && <TaskCard task={activeTask} isDragOverlay />}
        </DragOverlay>
      </DndContext>
    );
  }

  // Multiple types — render swimlanes
  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
    >
      <div className="space-y-4">
        {/* Column headers */}
        <div className="grid grid-cols-[200px_1fr_1fr_1fr] gap-4">
          <div /> {/* spacer for swimlane label */}
          {COLUMNS.map((col) => {
            const colors = COLUMN_COLORS[col.id];
            const count = activeTypes.reduce((sum, type) => {
              const cols = tasksByTypeAndColumn.get(type);
              return sum + (cols ? cols[col.id].length : 0);
            }, 0);
            return (
              <div key={col.id} className="flex items-center justify-between px-3">
                <h4 className={cn('text-xs font-semibold uppercase tracking-wide', colors.columnHeader)}>
                  {col.title}
                </h4>
                <span className={cn('text-xs px-1.5 py-0.5 rounded-full font-medium', colors.countBg)}>
                  {count}
                </span>
              </div>
            );
          })}
        </div>

        {/* Swimlanes by type */}
        {activeTypes.map((type) => {
          const cols = tasksByTypeAndColumn.get(type)!;
          const isCollapsed = collapsedTypes.has(type);
          const totalCount = cols.ready.length + cols.in_progress.length + cols.done.length;

          return (
            <div key={type}>
              {/* Swimlane header */}
              <button
                onClick={() => toggleType(type)}
                className="flex items-center gap-2 mb-2 text-sm font-medium text-text-main hover:text-primary transition-colors w-full text-left"
              >
                {isCollapsed
                  ? <ChevronRight className="h-4 w-4 text-text-sub" />
                  : <ChevronDown className="h-4 w-4 text-text-sub" />
                }
                <span>{TASK_TYPE_LABELS[type]}</span>
                <span className="text-xs text-text-sub font-normal">({totalCount})</span>
              </button>

              {!isCollapsed && (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 min-h-[8rem]">
                  {COLUMNS.map((col) => (
                    <KanbanColumn
                      key={`${type}-${col.id}`}
                      column={col}
                      tasks={cols[col.id]}
                      droppableId={`${type}-${col.id}`}
                    />
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
      <DragOverlay>
        {activeTask && <TaskCard task={activeTask} isDragOverlay />}
      </DragOverlay>
    </DndContext>
  );
}

function KanbanColumn({
  column,
  tasks,
  droppableId,
}: {
  column: Column;
  tasks: Task[];
  droppableId: string;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: droppableId });
  const colors = COLUMN_COLORS[column.id];

  return (
    <div
      ref={setNodeRef}
      className={cn(
        'rounded-lg p-3 min-h-[8rem] transition-all',
        colors.columnBg,
        isOver && `ring-2 ${colors.dropRing}`
      )}
    >
      <div className="flex items-center justify-between mb-3">
        <h4 className={cn('text-xs font-semibold uppercase tracking-wide', colors.columnHeader)}>
          {column.title}
        </h4>
        <span className={cn('text-xs px-1.5 py-0.5 rounded-full font-medium', colors.countBg)}>
          {tasks.length}
        </span>
      </div>
      <div className="space-y-2">
        {tasks.map((task) => (
          <TaskCard key={task.id} task={task} columnId={column.id} />
        ))}
      </div>
    </div>
  );
}

function TaskCard({ task, isDragOverlay, columnId }: { task: Task; isDragOverlay?: boolean; columnId?: ColumnId }) {
  const overdue = isOverdue(task);
  const pendingReview = isPendingReview(task);
  const estimate = getEstimateRange(task);
  const timeSpent = task.time_spent_minutes && task.time_spent_minutes > 0
    ? formatHours(task.time_spent_minutes)
    : null;

  const col = columnId ?? (COLUMNS.find((c) => c.statuses.includes(task.status))?.id ?? 'ready');
  const colors = COLUMN_COLORS[col];

  return (
    <div
      className={cn(
        'rounded-lg border p-3 text-sm transition-shadow',
        colors.cardBg,
        overdue
          ? 'border-[var(--error)] border-2 shadow-sm'
          : colors.cardBorder,
        isDragOverlay && 'shadow-lg rotate-2',
        !isDragOverlay && 'cursor-grab active:cursor-grabbing hover:shadow-sm'
      )}
    >
      <Link
        href={`/tasks/${task.id}`}
        className="font-medium text-text-main hover:text-primary transition-colors line-clamp-2 block"
        onClick={(e) => e.stopPropagation()}
      >
        {task.title}
      </Link>

      <div className="flex items-center gap-2 mt-2 flex-wrap">
        {task.status === 'blocked' && (
          <Badge variant="error" size="sm">Blocked</Badge>
        )}
        {task.status === 'abandoned' && (
          <Badge variant="default" size="sm">Abandoned</Badge>
        )}
        {pendingReview && (
          <Badge variant="warning" size="sm">Awaiting Review</Badge>
        )}
        {task.approved && task.needs_review && (
          <Badge variant="success" size="sm">Approved</Badge>
        )}
        {overdue && (
          <Badge variant="error" size="sm">Overdue</Badge>
        )}
      </div>

      {task.tags && task.tags.length > 0 && (
        <TagChips tags={task.tags} className="mt-2" />
      )}

      <div className="flex items-center justify-between mt-2 text-xs text-text-sub">
        <div className="flex items-center gap-2">
          {task.assignee && (
            <span className="truncate max-w-[80px]" title={task.assignee.name}>
              {task.assignee.name.split(' ')[0]}
            </span>
          )}
          {task.due_date && (
            <span className={cn(overdue && 'text-[var(--error)] font-medium')}>
              {(() => {
                const parts = task.due_date.split('T')[0].split('-');
                const d = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
                return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
              })()}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {timeSpent && (
            <span>{timeSpent}</span>
          )}
          {estimate && !timeSpent && (
            <span className="opacity-60">{estimate}</span>
          )}
        </div>
      </div>
    </div>
  );
}

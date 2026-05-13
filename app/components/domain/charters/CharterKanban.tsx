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
import { Badge } from '@/components/ui/badge';
import { Spinner } from '@/components/ui/spinner';
import { cn } from '@/lib/utils/cn';
import { useTasks, useUpdateTaskStatus, type Task } from '@/lib/hooks/use-tasks';
import {
  energyToMinutes,
  getMysteryMultiplier,
  getBatteryMultiplier,
  formatHours,
} from '@/lib/calculations/energy';
import type { MysteryFactor, BatteryImpact } from '@prisma/client';

interface CharterKanbanProps {
  charterId: string;
}

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

function getCurrentPeriod(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
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
  const mystery = getMysteryMultiplier(task.mystery_factor as MysteryFactor);
  const battery = getBatteryMultiplier(task.battery_impact as BatteryImpact);
  const high = Math.round(base * mystery * battery);
  if (base === high) return formatHours(base);
  return `${formatHours(base)} – ${formatHours(high)}`;
}

export function CharterKanban({ charterId }: CharterKanbanProps) {
  const period = getCurrentPeriod();
  const { data, isLoading, isError } = useTasks({
    charter_id: charterId,
    maintenance_period: period,
    limit: 200,
  });
  const updateStatus = useUpdateTaskStatus();
  const [activeTask, setActiveTask] = React.useState<Task | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor)
  );

  const tasks = data?.tasks ?? [];

  const tasksByColumn = React.useMemo(() => {
    const map: Record<ColumnId, Task[]> = { ready: [], in_progress: [], done: [] };
    for (const task of tasks) {
      const col = COLUMNS.find((c) => c.statuses.includes(task.status));
      if (col) map[col.id].push(task);
      else map.ready.push(task);
    }
    return map;
  }, [tasks]);

  const handleDragStart = (event: DragStartEvent) => {
    const task = tasks.find((t) => t.id === event.active.id);
    setActiveTask(task ?? null);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    setActiveTask(null);
    const { active, over } = event;
    if (!over) return;

    const taskId = active.id as string;
    const targetColumn = over.id as ColumnId;
    const task = tasks.find((t) => t.id === taskId);
    if (!task) return;

    const currentColumn = COLUMNS.find((c) => c.statuses.includes(task.status));
    if (currentColumn?.id === targetColumn) return;

    const newStatus = STATUS_FOR_COLUMN[targetColumn];
    if (newStatus) {
      updateStatus.mutate({ id: taskId, status: newStatus });
    }
  };

  if (isLoading) {
    return (
      <div className="flex justify-center py-12">
        <Spinner size="md" />
      </div>
    );
  }

  if (isError) {
    return (
      <div className="text-center py-12 text-text-sub text-sm">
        Failed to load tasks.
      </div>
    );
  }

  if (tasks.length === 0) {
    return (
      <div className="text-center py-12 text-text-sub text-sm">
        No tasks for this period.
      </div>
    );
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
    >
      <div className="grid grid-cols-3 gap-4 min-h-[300px]">
        {COLUMNS.map((col) => (
          <KanbanColumn
            key={col.id}
            column={col}
            tasks={tasksByColumn[col.id]}
          />
        ))}
      </div>
      <DragOverlay>
        {activeTask && <TaskCard task={activeTask} isDragOverlay />}
      </DragOverlay>
    </DndContext>
  );
}

function KanbanColumn({ column, tasks }: { column: Column; tasks: Task[] }) {
  const { setNodeRef, isOver } = useDroppable({ id: column.id });

  return (
    <div
      ref={setNodeRef}
      className={cn(
        'rounded-lg bg-background-light p-3 min-h-[200px] transition-colors',
        isOver && 'ring-2 ring-primary/40'
      )}
    >
      <div className="flex items-center justify-between mb-3">
        <h4 className="text-xs font-semibold text-text-sub uppercase tracking-wide">
          {column.title}
        </h4>
        <span className="text-xs text-text-sub bg-surface px-1.5 py-0.5 rounded-full">
          {tasks.length}
        </span>
      </div>
      <div className="space-y-2">
        {tasks.map((task) => (
          <TaskCard key={task.id} task={task} />
        ))}
      </div>
    </div>
  );
}

function TaskCard({ task, isDragOverlay }: { task: Task; isDragOverlay?: boolean }) {
  const overdue = isOverdue(task);
  const pendingReview = isPendingReview(task);
  const estimate = getEstimateRange(task);
  const timeSpent = task.time_spent_minutes && task.time_spent_minutes > 0
    ? formatHours(task.time_spent_minutes)
    : null;

  return (
    <div
      className={cn(
        'bg-surface rounded-lg border p-3 text-sm transition-shadow',
        overdue
          ? 'border-[var(--error)] shadow-sm'
          : 'border-border-warm',
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

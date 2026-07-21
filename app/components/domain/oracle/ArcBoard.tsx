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
  useDroppable,
  useDraggable,
  type DragStartEvent,
  type DragEndEvent,
} from '@dnd-kit/core';
import { cn } from '@/lib/utils/cn';
import { Badge } from '@/components/ui/badge';
import { Spinner } from '@/components/ui/spinner';
import { useTerminology } from '@/lib/hooks/use-terminology';
import { useQueryClient } from '@tanstack/react-query';
import { useArc, arcKeys, type ArcTask } from '@/lib/hooks/use-arcs';
import { useUpdateTaskStatus } from '@/lib/hooks/use-tasks';
import { getArcStatus, getArcProgressPercent } from '@/lib/arc-status';
import { capColumnCards, isWithinColumnLimit } from '@/lib/kanban-caps';

interface ArcBoardProps {
  arcId: string;
}

type ColumnId = 'not_started' | 'in_progress' | 'review' | 'done';

const COLUMNS: { id: ColumnId; title: string }[] = [
  { id: 'not_started', title: 'Not started' },
  { id: 'in_progress', title: 'In progress' },
  { id: 'review', title: 'Review' },
  { id: 'done', title: 'Done' },
];

// `blocked` renders as a chip on the card, not its own column (existing repo convention —
// see CharterKanban's 'ready' bucket) — it's grouped visually with Not started here.
function columnForTask(task: ArcTask): ColumnId {
  if (task.status === 'blocked') return 'not_started';
  if (task.status === 'abandoned') return 'done';
  return (task.status as ColumnId) ?? 'not_started';
}

// Never a 0%-guilt display: quiet (muted) below ~50%, gains presence (accent, fuller
// opacity) as completion nears 100 — no red anywhere in this bar, ever.
function ProgressBar({ percent }: { percent: number }) {
  const quiet = percent < 50;
  return (
    <div className="flex items-center gap-2" data-testid="arc-progress-bar" data-percent={percent}>
      <div className="h-2 w-40 overflow-hidden rounded-full bg-background-light">
        <div
          className="h-full rounded-full transition-all"
          style={{
            width: `${percent}%`,
            backgroundColor: quiet ? 'var(--text-muted)' : 'var(--accent)',
            opacity: quiet ? 0.45 : 0.6 + (0.4 * (percent - 50)) / 50,
          }}
        />
      </div>
      <span className="text-xs text-text-sub">{percent}%</span>
    </div>
  );
}

export function ArcBoard({ arcId }: ArcBoardProps) {
  const { t } = useTerminology();
  const { data: arc, isLoading, isError } = useArc(arcId);
  const updateStatus = useUpdateTaskStatus();
  const queryClient = useQueryClient();
  const [activeTask, setActiveTask] = React.useState<ArcTask | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor)
  );

  const tasksByColumn = React.useMemo(() => {
    const cols: Record<ColumnId, ArcTask[]> = { not_started: [], in_progress: [], review: [], done: [] };
    for (const task of arc?.tasks ?? []) {
      cols[columnForTask(task)].push(task);
    }
    return cols;
  }, [arc?.tasks]);

  function handleDragStart(event: DragStartEvent) {
    const task = arc?.tasks.find((tk) => tk.id === event.active.id);
    setActiveTask(task ?? null);
  }

  function handleDragEnd(event: DragEndEvent) {
    setActiveTask(null);
    const { active, over } = event;
    if (!over || !arc) return;

    const taskId = active.id as string;
    const targetColumn = over.id as ColumnId;
    const task = arc.tasks.find((tk) => tk.id === taskId);
    if (!task) return;
    if (columnForTask(task) === targetColumn) return;

    updateStatus.mutate(
      { id: taskId, status: targetColumn },
      { onSuccess: () => queryClient.invalidateQueries({ queryKey: arcKeys.detail(arcId) }) }
    );
  }

  if (isLoading) {
    return (
      <div className="flex justify-center py-12">
        <Spinner size="lg" />
      </div>
    );
  }

  if (isError || !arc) {
    return <div className="py-12 text-center text-sm text-text-sub">Failed to load this arc.</div>;
  }

  const percent = getArcProgressPercent(arc.tasks);
  const status = arc.status ?? getArcStatus({ closed_at: arc.closed_at ? new Date(arc.closed_at) : null, tasks: arc.tasks as any });

  if (!isWithinColumnLimit(COLUMNS.length)) {
    // Guard rail, not expected to fire — the binding kanban cap is 4 columns and this board
    // always renders exactly 4.
    return null;
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-lg font-bold text-text-main">{arc.name}</h1>
          <p className="text-xs text-text-sub">
            {status} · {arc.tasks.length} {arc.tasks.length === 1 ? t('task') : t('tasks')}
            {arc.client && ` · ${arc.client.name}`}
          </p>
        </div>
        <ProgressBar percent={percent} />
      </div>

      <DndContext
        sensors={sensors}
        collisionDetection={closestCorners}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
      >
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {COLUMNS.map((col) => (
            <ArcColumn key={col.id} id={col.id} title={col.title} tasks={tasksByColumn[col.id]} />
          ))}
        </div>
        <DragOverlay>{activeTask && <ArcTaskCard task={activeTask} isOverlay />}</DragOverlay>
      </DndContext>
    </div>
  );
}

function ArcColumn({ id, title, tasks }: { id: ColumnId; title: string; tasks: ArcTask[] }) {
  const { setNodeRef, isOver } = useDroppable({ id });
  const { visible, overflowCount } = capColumnCards(tasks);

  return (
    <div
      ref={setNodeRef}
      className={cn(
        'flex min-h-[10rem] flex-col gap-2 rounded-lg border p-2',
        'border-border-warm bg-background-light/40',
        isOver && 'border-[color:var(--accent)]'
      )}
      data-testid={`arc-column-${id}`}
    >
      <div className="flex items-center justify-between px-1">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-text-sub">{title}</h4>
        <span className="rounded-full border border-border-warm bg-surface px-2 text-xs text-text-sub">
          {tasks.length}
        </span>
      </div>
      <div className="flex flex-col gap-2">
        {visible.map((task) => (
          <ArcTaskCard key={task.id} task={task} />
        ))}
      </div>
      {overflowCount > 0 && (
        <div className="px-1 text-center text-xs text-text-sub">+ {overflowCount} more</div>
      )}
    </div>
  );
}

function ArcTaskCard({ task, isOverlay }: { task: ArcTask; isOverlay?: boolean }) {
  const pendingReview = task.status === 'done' && task.needs_review && !task.approved;

  return (
    <DraggableCard id={task.id} disabled={isOverlay}>
      <Link href={`/tasks/${task.id}`} className="line-clamp-2 text-sm font-medium text-text-main hover:text-primary">
        {task.title}
      </Link>
      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
        {task.status === 'blocked' && <Badge variant="warning" size="sm">Blocked</Badge>}
        {task.status === 'abandoned' && <Badge variant="default" size="sm">Abandoned</Badge>}
        {pendingReview && <Badge variant="warning" size="sm">Awaiting review</Badge>}
        {task.assignee && <span className="text-xs text-text-sub">{task.assignee.name.split(' ')[0]}</span>}
      </div>
    </DraggableCard>
  );
}

function DraggableCard({ id, disabled, children }: { id: string; disabled?: boolean; children: React.ReactNode }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id, disabled });
  const style = transform
    ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)` }
    : undefined;

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      className={cn(
        'cursor-grab rounded-lg border border-border-warm bg-surface p-2.5 shadow-sm active:cursor-grabbing',
        isDragging && 'opacity-40'
      )}
    >
      {children}
    </div>
  );
}

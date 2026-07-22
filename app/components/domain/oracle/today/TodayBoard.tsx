'use client';

import * as React from 'react';
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
import type { TodayPick } from '@/lib/hooks/use-today';
import { useUpdateTodayPick } from '@/lib/hooks/use-today';
import { TodayPickCard } from './TodayPickCard';
import { capColumnCards, isDoingColumnOverCap } from '@/lib/kanban-caps';
import { columnForPick, fieldsForTransition, type BoardColumnId } from './today-board-logic';

interface TodayBoardProps {
  picks: TodayPick[];
  // Clarity Phase 5 — threaded through to each card's attention dot, same as the list lens.
  legacyAttentionArcIds?: Set<string>;
}

const COLUMN_TITLES: Record<BoardColumnId, string> = {
  todo: 'To do',
  doing: 'Doing',
  done: 'Done',
};

const COLUMN_ORDER: BoardColumnId[] = ['todo', 'doing', 'done'];

// The Today board lens: same picks as the list, viewed as columns To do / Doing / Done —
// Clarity Phase 4b made this a REAL, server-persisted state (today_picks.started_at) with
// drag-and-drop between all three columns, using the same dnd-kit wiring pattern as
// ArcBoard (components/domain/oracle/ArcBoard.tsx): PointerSensor + KeyboardSensor,
// closestCorners collision, a DragOverlay ghost. Column membership is purely a function of
// started_at/completed_at (see today-board-logic.ts) — dragging a Done pick anywhere other
// than back into Done clears completed_at but preserves started_at, so it can land back in
// Doing rather than resetting all the way to To do (you can't un-start a task by dragging it
// out of Done). The existing checkmark toggle (in TodayPickCard) remains a same-effect
// shortcut for Doing/To do -> Done. The Doing column's soft WIP cap (>=3, warning tint,
// never a hard block) applies here exactly as before, now driven by real column membership.
export function TodayBoard({ picks, legacyAttentionArcIds }: TodayBoardProps) {
  const updatePick = useUpdateTodayPick();
  const [activePick, setActivePick] = React.useState<TodayPick | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor)
  );

  const columns = React.useMemo(() => {
    const cols: Record<BoardColumnId, TodayPick[]> = { todo: [], doing: [], done: [] };
    for (const pick of picks) {
      cols[columnForPick(pick)].push(pick);
    }
    return cols;
  }, [picks]);

  function movePick(pickId: string, target: BoardColumnId) {
    const pick = picks.find((p) => p.id === pickId);
    if (!pick) return;
    const source = columnForPick(pick);
    const fields = fieldsForTransition(source, target);
    if (!fields) return;
    updatePick.mutate({ id: pickId, data: fields });
  }

  function handleDragStart(event: DragStartEvent) {
    const pick = picks.find((p) => p.id === event.active.id);
    setActivePick(pick ?? null);
  }

  function handleDragEnd(event: DragEndEvent) {
    setActivePick(null);
    const { active, over } = event;
    if (!over) return;
    movePick(active.id as string, over.id as BoardColumnId);
  }

  const doingOverCap = isDoingColumnOverCap(columns.doing.length);

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3" data-testid="today-board">
        {COLUMN_ORDER.map((columnId) => {
          const cards = columns[columnId];
          const { visible, overflowCount } = capColumnCards(cards);
          const isDoing = columnId === 'doing';
          return (
            <TodayBoardColumn
              key={columnId}
              id={columnId}
              title={COLUMN_TITLES[columnId]}
              cards={visible}
              overflowCount={overflowCount}
              total={cards.length}
              overCap={isDoing && doingOverCap}
              onStart={columnId === 'todo' ? (pickId) => movePick(pickId, 'doing') : undefined}
              legacyAttentionArcIds={legacyAttentionArcIds}
            />
          );
        })}
      </div>
      <DragOverlay>
        {activePick && (
          <div className="opacity-90">
            <TodayPickCard
              pick={activePick}
              hasAttentionDot={!!activePick.arc_id && !!legacyAttentionArcIds?.has(activePick.arc_id)}
            />
          </div>
        )}
      </DragOverlay>
    </DndContext>
  );
}

function TodayBoardColumn({
  id,
  title,
  cards,
  overflowCount,
  total,
  overCap,
  onStart,
  legacyAttentionArcIds,
}: {
  id: BoardColumnId;
  title: string;
  cards: TodayPick[];
  overflowCount: number;
  total: number;
  overCap: boolean;
  onStart?: (pickId: string) => void;
  legacyAttentionArcIds?: Set<string>;
}) {
  const { setNodeRef, isOver } = useDroppable({ id });

  return (
    <div
      ref={setNodeRef}
      className={cn(
        'flex min-h-[10rem] flex-col gap-2 rounded-lg border p-2',
        overCap ? 'border-[color:var(--warning)] bg-[var(--warning-subtle)]' : 'border-border-warm bg-background-light/40',
        isOver && 'border-[color:var(--accent)]'
      )}
      data-testid={`today-board-column-${id}`}
      data-over-cap={overCap ? 'true' : undefined}
    >
      <div className="flex items-center justify-between px-1">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-text-sub">{title}</h4>
        <span className="rounded-full border border-border-warm bg-surface px-2 text-xs text-text-sub">
          {total}
        </span>
      </div>

      <div className="flex flex-col gap-2">
        {cards.map((pick) => (
          <div key={pick.id} className="flex flex-col gap-1">
            <DraggableTodayPick
              pick={pick}
              hasAttentionDot={!!pick.arc_id && !!legacyAttentionArcIds?.has(pick.arc_id)}
            />
            {onStart && (
              <button
                type="button"
                onClick={() => onStart(pick.id)}
                className="self-start px-1 text-xs text-text-sub underline decoration-dotted hover:text-text-main"
                data-testid="today-board-start-button"
              >
                Start
              </button>
            )}
          </div>
        ))}
      </div>

      {overflowCount > 0 && (
        <div className="px-1 text-center text-xs text-text-sub">+ {overflowCount} more</div>
      )}
    </div>
  );
}

function DraggableTodayPick({ pick, hasAttentionDot }: { pick: TodayPick; hasAttentionDot?: boolean }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: pick.id });
  const style = transform
    ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)` }
    : undefined;

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      className={cn('cursor-grab active:cursor-grabbing', isDragging && 'opacity-40')}
      data-testid="today-board-draggable-pick"
    >
      <TodayPickCard pick={pick} hasAttentionDot={hasAttentionDot} />
    </div>
  );
}

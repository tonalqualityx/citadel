'use client';

import * as React from 'react';
import { cn } from '@/lib/utils/cn';
import type { TodayPick } from '@/lib/hooks/use-today';
import { TodayPickCard } from './TodayPickCard';
import { capColumnCards, isDoingColumnOverCap } from '@/lib/kanban-caps';

interface TodayBoardProps {
  picks: TodayPick[];
}

type BoardColumnId = 'todo' | 'doing' | 'done';

const COLUMN_TITLES: Record<BoardColumnId, string> = {
  todo: 'To do',
  doing: 'Doing',
  done: 'Done',
};

// The Today board lens: same picks as the list, viewed as columns To do / Doing / Done by
// completed_at + an "in_progress" marker. The binding schema has no stored duration/status
// for a pick, so "Doing" is a cheap, session-local (not persisted) marker the operator
// toggles here — the spec calls this out explicitly as "cheap lens, same data", and this is
// the documented, deliberate simplification behind that. Kanban density caps + the Doing
// column's own soft WIP nudge (>=3 items, warning tint, never a hard block) both apply.
export function TodayBoard({ picks }: TodayBoardProps) {
  const [doingIds, setDoingIds] = React.useState<Set<string>>(new Set());

  // Keep the marker set clean: a completed pick can't still be "doing".
  React.useEffect(() => {
    setDoingIds((prev) => {
      const next = new Set(prev);
      let changed = false;
      for (const pick of picks) {
        if (pick.completed_at && next.has(pick.id)) {
          next.delete(pick.id);
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [picks]);

  const columns = React.useMemo(() => {
    const done: TodayPick[] = [];
    const doing: TodayPick[] = [];
    const todo: TodayPick[] = [];
    for (const pick of picks) {
      if (pick.completed_at) {
        done.push(pick);
      } else if (doingIds.has(pick.id)) {
        doing.push(pick);
      } else {
        todo.push(pick);
      }
    }
    return { todo, doing, done };
  }, [picks, doingIds]);

  function startPick(id: string) {
    setDoingIds((prev) => new Set(prev).add(id));
  }

  const doingOverCap = isDoingColumnOverCap(columns.doing.length);

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3" data-testid="today-board">
      {(Object.keys(columns) as BoardColumnId[]).map((columnId) => {
        const cards = columns[columnId];
        const { visible, overflowCount } = capColumnCards(cards);
        const isDoing = columnId === 'doing';
        return (
          <div
            key={columnId}
            className={cn(
              'flex flex-col gap-2 rounded-lg border p-2',
              isDoing && doingOverCap ? 'border-[color:var(--warning)] bg-[var(--warning-subtle)]' : 'border-border-warm bg-background-light/40'
            )}
            data-testid={`today-board-column-${columnId}`}
            data-over-cap={isDoing && doingOverCap ? 'true' : undefined}
          >
            <div className="flex items-center justify-between px-1">
              <h4 className="text-xs font-semibold uppercase tracking-wide text-text-sub">
                {COLUMN_TITLES[columnId]}
              </h4>
              <span className="rounded-full border border-border-warm bg-surface px-2 text-xs text-text-sub">
                {cards.length}
              </span>
            </div>

            <div className="flex flex-col gap-2">
              {visible.map((pick) => (
                <div key={pick.id} className="flex flex-col gap-1">
                  <TodayPickCard pick={pick} />
                  {columnId === 'todo' && (
                    <button
                      type="button"
                      onClick={() => startPick(pick.id)}
                      className="self-start px-1 text-xs text-text-sub underline decoration-dotted hover:text-text-main"
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
      })}
    </div>
  );
}

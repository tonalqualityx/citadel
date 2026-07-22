// Clarity Phase 4b — the Today board lens's column mapping + drag-transition math, pulled
// out of TodayBoard.tsx (dependency-free of React) so it's directly unit-testable, matching
// the existing needs-reshi-logic.ts / time-shape-logic.ts convention of "logic lives in a
// pure sibling file, the component stays a dumb renderer".
//
// Column mapping (server-persisted, no longer a session-local marker): To do = neither
// started_at nor completed_at; Doing = started_at set, completed_at null; Done =
// completed_at set (regardless of started_at — a pick can reach Done having skipped Doing
// entirely, e.g. dragged straight from To do).
import type { TodayPick } from '@/lib/hooks/use-today';

export type BoardColumnId = 'todo' | 'doing' | 'done';

export function columnForPick(pick: Pick<TodayPick, 'started_at' | 'completed_at'>): BoardColumnId {
  if (pick.completed_at) return 'done';
  if (pick.started_at) return 'doing';
  return 'todo';
}

export interface PickTransitionFields {
  started_at?: string | null;
  completed_at?: string | null;
}

/**
 * The fields to PATCH when a pick is dropped into `target`, having come from `source`.
 * Returns null when the drop is a no-op (same column). Semantics (binding, from Mike's own
 * framing):
 *   - drag to Doing sets started_at
 *   - drag back (Doing -> To do) clears it
 *   - drag to Done sets completed_at
 *   - drag OUT of Done clears completed_at but PRESERVES started_at untouched — dragging a
 *     completed pick back to "To do" can therefore land it back in Doing instead (the
 *     column mapping above is purely a function of the two fields, not of the drop target),
 *     which is intentional: you can't un-start a task by dragging it out of Done.
 */
export function fieldsForTransition(
  source: BoardColumnId,
  target: BoardColumnId,
  now: () => string = () => new Date().toISOString()
): PickTransitionFields | null {
  if (source === target) return null;

  if (target === 'done') {
    return { completed_at: now() };
  }

  if (source === 'done') {
    // Drag out of Done: only ever clears completed_at, never touches started_at.
    return { completed_at: null };
  }

  // Between To do <-> Doing (source is not 'done', target is not 'done').
  if (target === 'doing') {
    return { started_at: now() };
  }
  // target === 'todo'
  return { started_at: null };
}

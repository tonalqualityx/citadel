// Evidence-bound design rule (2026-07-21 ADHD motivation research, BINDING across every
// kanban-shaped view in the Oracle — Today board lens AND the arc board): max 4 columns,
// 5-7 visible cards per column, overflow behind a "+N more" collapse. Direct kanban-vs-list
// evidence is weak precisely when boards get dense, so the caps are load-bearing, not
// cosmetic — a board must never just dump every card on screen.
export const KANBAN_MAX_COLUMNS = 4;
export const KANBAN_MAX_VISIBLE_CARDS = 6; // within the binding 5-7 range

export interface ColumnCapResult<T> {
  visible: T[];
  overflowCount: number;
}

/** Caps a single column's cards to the visible limit; the rest count toward "+N more". */
export function capColumnCards<T>(cards: T[], max: number = KANBAN_MAX_VISIBLE_CARDS): ColumnCapResult<T> {
  if (cards.length <= max) {
    return { visible: cards, overflowCount: 0 };
  }
  return { visible: cards.slice(0, max), overflowCount: cards.length - max };
}

/** Never render more than the binding column max — callers should design around this, but
 *  this guards against an unexpected 5th board column slipping through unnoticed. */
export function isWithinColumnLimit(columnCount: number): boolean {
  return columnCount <= KANBAN_MAX_COLUMNS;
}

// Perplexity cross-check addendum (2026-07-21): the Today board lens's "Doing" column gets
// its own soft cap distinct from the visible-card cap above — ADHD-specific guidance caps
// active work-in-progress at 1-3 items. This is a NUDGE (warning tint), never a hard block —
// unlike the today-picks WIP ceiling (lib/today-picks.ts), which does hard-block a 6th pick.
export const DOING_COLUMN_WARNING_THRESHOLD = 3;

/** True once the Doing column carries more active items than ADHD WIP guidance recommends —
 *  renders the same warning tint used for over-target Today picks; still a soft nudge. */
export function isDoingColumnOverCap(doingCount: number): boolean {
  return doingCount >= DOING_COLUMN_WARNING_THRESHOLD;
}

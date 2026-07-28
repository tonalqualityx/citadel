// Clarity Phase 8 (composition) — the single source of truth for "why is this pick/task
// showing right now." Four variants, ONE chip per pick/task (never stacked): the Work hero
// cards, the Plan kanban cards (TodayPickCard via TodayBoard), the Plan list lens
// (TodaySection), and the Due-soon door's count/subtext all call the same functions here —
// they can never disagree, because there is only one predicate.
//
// Binding rule (first match wins):
//   1. pick.started_at && !pick.completed_at        -> "in progress"
//   2. task.promised_to && task.due_date             -> "promised: due <label>"
//   3. task.promised_to && !task.due_date            -> "promised"
//   4. !task.promised_to && task.due_date            -> "target: <label>"
//   5. otherwise (incl. every non-task pick type)    -> "picked this morning"
//
// Rule 1 beats everything because it's the most immediate truth (carried over from the
// now-strip-logic module this supersedes). Priority (P1/P2) is DELIBERATELY dropped from
// the chip — the wireframe has four variants, none of them priority; priority already
// floats to the top elsewhere (see /api/waiting-on-me's floatHighPriority). Do not
// "restore" a priority-based chip here.
//
// Binding TONE LAW (DAY-REALITY #3, research DON'T-BUILD list): the `target` variant is
// NEVER red and NEVER contains the word "overdue" — a task promised to nobody, however
// late, is quiet outline "target: <the real date>", never a guilt display. Enforced by a
// unit test that runs every variant/date combination (including far-past-due) through
// reasonChipForPick.

export type ReasonChipVariant = 'progress' | 'promised' | 'target' | 'picked';

export interface ReasonChip {
  variant: ReasonChipVariant;
  label: string;
}

export interface ReasonChipTaskInput {
  promised_to: string | null;
  due_date: string | null;
}

export interface ReasonChipPickInput {
  started_at?: string | null;
  completed_at?: string | null;
  task?: ReasonChipTaskInput | null;
}

const DAY_MS = 24 * 60 * 60 * 1000;

function parseDateOnly(dateStr: string): Date {
  // dateStr may be a plain YYYY-MM-DD or a full ISO timestamp — only the calendar date
  // matters for labeling, so slice to the date portion and parse as UTC-midnight to avoid
  // timezone drift shifting the day.
  return new Date(`${dateStr.slice(0, 10)}T00:00:00.000Z`);
}

function daysBetween(fromDateStr: string, toDateStr: string): number {
  const from = parseDateOnly(fromDateStr).getTime();
  const to = parseDateOnly(toDateStr).getTime();
  return Math.round((to - from) / DAY_MS);
}

const WEEKDAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function formatMonthDay(dateStr: string): string {
  const d = parseDateOnly(dateStr);
  const month = d.toLocaleString('en-US', { month: 'short', timeZone: 'UTC' });
  return `${month} ${d.getUTCDate()}`;
}

/** Assertive-chip date label: today/tomorrow/short-weekday(2-6 days out)/MMM d otherwise —
 *  including past-due, which renders as the real date, never "overdue" or a negative count. */
export function dueLabel(dueDateStr: string, todayDateStr: string): string {
  const delta = daysBetween(todayDateStr, dueDateStr);
  if (delta === 0) return 'today';
  if (delta === 1) return 'tomorrow';
  if (delta >= 2 && delta <= 6) return WEEKDAY_SHORT[parseDateOnly(dueDateStr).getUTCDay()];
  return formatMonthDay(dueDateStr);
}

function startOfWeek(dateStr: string): Date {
  const d = parseDateOnly(dateStr);
  const day = d.getUTCDay(); // 0=Sun..6=Sat
  const mondayOffset = day === 0 ? -6 : 1 - day;
  d.setUTCDate(d.getUTCDate() + mondayOffset);
  return d;
}

/** Quiet-chip date label: today/tomorrow/"this week"/"next week"/MMM d otherwise. Never
 *  red, never "overdue" — a far-past-due internal target still just shows the real date. */
export function targetLabel(dueDateStr: string, todayDateStr: string): string {
  const delta = daysBetween(todayDateStr, dueDateStr);
  if (delta === 0) return 'today';
  if (delta === 1) return 'tomorrow';
  if (delta < 0) return formatMonthDay(dueDateStr);

  const thisWeekStart = startOfWeek(todayDateStr).getTime();
  const thisWeekEnd = thisWeekStart + 7 * DAY_MS;
  const nextWeekEnd = thisWeekEnd + 7 * DAY_MS;
  const dueMs = parseDateOnly(dueDateStr).getTime();

  if (dueMs >= thisWeekStart && dueMs < thisWeekEnd) return 'this week';
  if (dueMs >= thisWeekEnd && dueMs < nextWeekEnd) return 'next week';
  return formatMonthDay(dueDateStr);
}

/** The one honest reason a pick is showing right now (rule table in the module header). */
export function reasonChipForPick(pick: ReasonChipPickInput, opts: { todayDateStr: string }): ReasonChip {
  if (pick.started_at && !pick.completed_at) {
    return { variant: 'progress', label: 'in progress' };
  }
  const task = pick.task;
  if (task?.promised_to && task.due_date) {
    return { variant: 'promised', label: `promised: due ${dueLabel(task.due_date, opts.todayDateStr)}` };
  }
  if (task?.promised_to) {
    return { variant: 'promised', label: 'promised' };
  }
  if (task?.due_date) {
    return { variant: 'target', label: `target: ${targetLabel(task.due_date, opts.todayDateStr)}` };
  }
  return { variant: 'picked', label: 'picked this morning' };
}

/** Same rule, for a bare task (no pick wrapper) — used by the Due-soon door / row, which
 *  reads straight off Task rows rather than TodayPicks. */
export function reasonChipForTask(task: ReasonChipTaskInput, opts: { todayDateStr: string }): ReasonChip {
  return reasonChipForPick({ task }, opts);
}

/** Clarity Phase 8 (shakedown) — the promised-to-a-person tasks due exactly today, in full
 *  (not just a count): the signals rail's "N promised tasks due today" chip expands into
 *  this exact list, so the chip's count and its expanded contents can never disagree — one
 *  predicate, walked once. Reuses the identical `!!promised_to` presence test as the chip
 *  rules above. */
export function promisedDueTodayTasks<T extends { promised_to: string | null; due_date: string | null }>(
  tasks: T[],
  todayDateStr: string
): T[] {
  return tasks.filter(
    (t) => !!t.promised_to && !!t.due_date && daysBetween(todayDateStr, t.due_date) === 0
  );
}

/** True count of promised-to-a-person tasks due exactly today — used by the signals rail
 *  and nowhere else; delegates to promisedDueTodayTasks so the count can never drift from
 *  the list the rail's expand panel renders. */
export function countPromisedDueToday(
  tasks: Array<{ promised_to: string | null; due_date: string | null }>,
  todayDateStr: string
): number {
  return promisedDueTodayTasks(tasks, todayDateStr).length;
}

export interface DueSoonDoorSummary {
  count: number;
  subtext: 'promised' | 'targets' | null;
}

/** The Due-soon door's count + subtext, deduped by task id across any two lists that might
 *  both reference the same task (e.g. today's picks + the due-soon row). */
export function dueSoonDoorSummary(
  tasks: Array<{ id: string; promised_to: string | null; due_date: string | null }>
): DueSoonDoorSummary {
  const byId = new Map(tasks.filter((t) => !!t.due_date).map((t) => [t.id, t]));
  const deduped = Array.from(byId.values());
  if (deduped.length === 0) return { count: 0, subtext: null };
  const anyPromised = deduped.some((t) => !!t.promised_to);
  const allInternal = deduped.every((t) => !t.promised_to);
  return {
    count: deduped.length,
    subtext: anyPromised ? 'promised' : allInternal ? 'targets' : null,
  };
}

// Clarity Phase 1 — Arc status is NEVER stored (see prisma/schema.prisma Arc model doc
// comment). It is always derived from the arc's tasks + its explicit closed_at ritual.
//
// Precedence (first match wins):
//   1. empty    — the arc has no tasks at all.
//   2. complete — closed_at is set (explicit "close thread"), OR every task is
//                 done/abandoned.
//   3. open     — anything else.
import type { TaskStatus } from '@prisma/client';

export type ArcStatus = 'empty' | 'open' | 'complete';

// Exported (Clarity Phase 4c) so sumOpenEstimatedMinutes below — and any other caller
// needing the exact same "open" definition — never drifts from getArcStatus's own.
export const TERMINAL_TASK_STATUSES: TaskStatus[] = ['done', 'abandoned'];

export interface ArcStatusInput {
  closed_at: Date | null;
  tasks: Array<{ status: TaskStatus }>;
}

export function getArcStatus(arc: ArcStatusInput): ArcStatus {
  if (arc.tasks.length === 0) return 'empty';

  const allTerminal = arc.tasks.every((t) => TERMINAL_TASK_STATUSES.includes(t.status));
  if (arc.closed_at || allTerminal) return 'complete';

  return 'open';
}

// Clarity Phase 3 — The Oracle Face: the arc board's progress bar. "Never a 0%-guilt
// display" per the evidence-bound design rules — an empty/fresh arc reads as 0, not as a
// failure state; the presentation layer (not this pure function) is what keeps it visually
// quiet below ~50%. done + abandoned both count as "resolved" here (same terminal
// definition getArcStatus uses above) since an abandoned task is closed, not pending.
export function getArcProgressPercent(tasks: Array<{ status: TaskStatus | string }>): number {
  if (tasks.length === 0) return 0;
  const terminal = TERMINAL_TASK_STATUSES as string[];
  const resolved = tasks.filter((t) => terminal.includes(t.status)).length;
  return Math.round((resolved / tasks.length) * 100);
}

// Clarity Phase 4c — the arc board header's time estimate: the sum of the arc's OPEN
// (not done/abandoned — same terminal definition as getArcStatus/getArcProgressPercent
// above) tasks' estimated_minutes. A task with no estimate contributes 0, not NaN —
// estimation is optional per-task (task-estimation.md), so an un-estimated open task
// should never poison the whole arc's total.
export function sumOpenEstimatedMinutes(
  tasks: Array<{ status: TaskStatus | string; estimated_minutes: number | null }>
): number {
  const terminal = TERMINAL_TASK_STATUSES as string[];
  return tasks
    .filter((t) => !terminal.includes(t.status))
    .reduce((sum, t) => sum + (t.estimated_minutes ?? 0), 0);
}

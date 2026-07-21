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

const TERMINAL_TASK_STATUSES: TaskStatus[] = ['done', 'abandoned'];

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

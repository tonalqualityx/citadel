import { AskSeverity } from '@prisma/client';

// Shared client_blocking/launch_blocking/internal -> Task.priority mapping. Originally
// inline in app/api/session-tasks/route.ts; Clarity Phase 4a's create-task endpoint
// (app/api/email-asks/[id]/create-task/route.ts) reuses this exact mapping per the spec's
// "severity->priority mapping reused" instruction rather than a second copy.
export const SEVERITY_TO_PRIORITY: Record<AskSeverity, number> = {
  client_blocking: 1,
  launch_blocking: 2,
  internal: 3,
};

/** Absent severity defaults to priority 3 (lowest urgency), same as session-tasks always did. */
export function priorityForSeverity(severity: AskSeverity | null | undefined): number {
  return severity ? SEVERITY_TO_PRIORITY[severity] : 3;
}

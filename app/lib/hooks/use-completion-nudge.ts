import { toast } from 'sonner';
import { apiClient } from '@/lib/api/client';
import { showToast } from '@/lib/hooks/use-toast';

// Clarity Phase 7 (Seeing Stone Reckoning P2) — the completion nudge (spec Q12). Fires
// wherever a task/arc status transition's PATCH response carries a `completion_nudge` key
// (Phase 1: only on the transition INTO a closed state that has an attached email — see
// the API's own doc comments on /api/tasks/[id] and /api/arcs/[id]). Retention-critical
// per Mike's own framing (SOUL.md): follow-through on client work stops depending on
// memory. Draft-only forever — this never sends anything, only queues a task for Bast to
// draft a Gmail DRAFT on the original thread.

export const BAST_USER_ID = 'ca5335e7-a374-4eff-92dc-fd67ceef2297';

export interface CompletionNudge {
  thread_id: string | null;
  subject: string;
  from_email: string;
}

/** True presence check, not truthiness — Phase 1's contract is "the key exists only when
 *  there's a real nudge" (never a present-but-null placeholder), but checking presence
 *  explicitly is the documented, defensive convention this phase follows throughout. */
export function hasCompletionNudge(data: unknown): data is { completion_nudge: CompletionNudge } {
  return (
    !!data &&
    typeof data === 'object' &&
    'completion_nudge' in data &&
    !!(data as { completion_nudge?: unknown }).completion_nudge
  );
}

async function queueDoneReplyDraft(nudge: CompletionNudge): Promise<void> {
  await apiClient.post('/tasks', {
    title: `Draft done-reply: ${nudge.subject}`,
    assignee_id: BAST_USER_ID,
    priority: 2,
    description: [
      `Thread: ${nudge.thread_id ?? '(none)'}`,
      `Subject: ${nudge.subject}`,
      `From: ${nudge.from_email}`,
      '',
      'The work this thread asked for just closed. Draft a Gmail DRAFT (never send — draft-only, always) on this thread telling them it is done. Leave it in Drafts for Mike to review and send.',
    ].join('\n'),
  });
}

/**
 * The non-blocking prompt itself: "This closed work started from an email — want a
 * done-reply drafted?" Accept queues the draft task; dismiss (including the toast just
 * timing out) does nothing — no nagging, no re-prompting, per the spec's explicit ruling.
 */
export function showCompletionNudge(nudge: CompletionNudge): void {
  toast('This closed work started from an email', {
    description: `Want a done-reply drafted for "${nudge.subject}"?`,
    action: {
      label: 'Draft it',
      onClick: () =>
        queueDoneReplyDraft(nudge)
          .then(() => showToast.success('Queued a done-reply draft for Bast'))
          .catch((error) => showToast.apiError(error, 'Failed to queue the done-reply draft')),
    },
    duration: 20_000,
  });
}

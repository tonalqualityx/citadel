/**
 * Every change a session makes through the triage-desk lane leaves a mark on the card: a TriageChange line written by the server
 * ("<what> by a session", lib/tasks/triage-rev.ts) that also raises the revision (lib/tasks/triage-rev-hook.ts). It is NOT a comment: a comment
 * typed by any lane can never look like a change line (isChangeLineImitation refuses it), and the card renders its change lines from the
 * TriageChange rows only.
 */
import { bumpTriageRev } from '@/lib/tasks/triage-rev-hook';

/** One plain line (no line breaks, at most 200 characters), as the change line's "what". */
function oneLine(s: string): string {
  return s.replace(/\s+/g, ' ').trim().slice(0, 200);
}

/** For a change that no other recorder already wrote a line for (the looks-done mark). */
export async function recordSessionChange(_userId: string, taskId: string, what: string): Promise<void> {
  await bumpTriageRev(taskId, 'session', oneLine(what));
}

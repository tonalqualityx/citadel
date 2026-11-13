/**
 * The one place a Triage card's revision is raised when a session changes it through the triage-desk lane. It writes a server-made change line
 * (TriageChange, shown as "<what> by a session") and raises triage_rev, so a Release tap read before the change is refused.
 *
 *   taskId  the Triage card
 *   who     who changed it: 'session' for the triage-desk lane
 *   what    a one-line description of the change in plain words ("Marked looks done")
 */
import { prisma } from '@/lib/db/prisma';
import { recordTriageChange } from './triage-rev';

export async function bumpTriageRev(taskId: string, who: string, what: string): Promise<void> {
  const by = who === 'session' ? 'a session' : who;
  await recordTriageChange(prisma, taskId, 'session', `${what} by ${by}`, { by, userId: null, lane: who === 'session' ? 'triage-desk' : null });
}

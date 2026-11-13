/**
 * An agent or a person asks Dox a question by mentioning him in a comment on a task (Addendum 7). The mention marks the task `asked-dox` and
 * stamps the project's next_step_refresh_requested_at, so Dox's next pass for that project is triggered at once rather than at the next sweep.
 * Dox's own comments never count (he cannot ask himself), and a card still in Triage is left alone (the conversation there is a different one).
 */
import type { PrismaClient } from '@prisma/client';
import { DOX_USER_ID, isDoxLaneValue } from './identity';

export const ASKED_DOX_TAG = 'asked-dox';

/** True when a comment mentions Dox: his id is among the mentioned users, or the text carries an @Dox. */
export function mentionsDox(mentionedUserIds: readonly string[], content: string): boolean {
  return mentionedUserIds.includes(DOX_USER_ID) || /(^|[^\w@])@dox\b/i.test(content);
}

export async function markAskedDox(
  db: PrismaClient,
  task: { id: string; status: string; project_id: string | null; tags: string[] },
  author: { userId: string; lane?: string | null },
  comment: { mentionedUserIds: readonly string[]; content: string },
  now: Date = new Date(),
): Promise<boolean> {
  if (author.userId === DOX_USER_ID || isDoxLaneValue(author.lane)) return false;
  if (task.status === 'triage') return false;
  if (!mentionsDox(comment.mentionedUserIds, comment.content)) return false;
  if (!task.tags.includes(ASKED_DOX_TAG)) {
    const fresh = await db.task.findUnique({ where: { id: task.id }, select: { tags: true } });
    const tags = fresh?.tags ?? task.tags;
    if (!tags.includes(ASKED_DOX_TAG)) await db.task.update({ where: { id: task.id }, data: { tags: [...tags, ASKED_DOX_TAG] } });
  }
  if (task.project_id) {
    await db.project.updateMany({ where: { id: task.project_id, is_deleted: false }, data: { next_step_refresh_requested_at: now } });
  }
  return true;
}

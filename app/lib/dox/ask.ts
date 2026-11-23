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
  const fresh = await db.task.findUnique({ where: { id: task.id }, select: { tags: true } });
  const tags = fresh?.tags ?? task.tags;
  // Every mention marks the task as newly asked, a repeat on a task already tagged included: the scheduler offers an asked-dox task to Dox only
  // when it changed after his last pass, and a second client email handed to him on the same home card must reach him too.
  await db.task.update({
    where: { id: task.id },
    data: tags.includes(ASKED_DOX_TAG) ? { updated_at: now } : { tags: [...tags, ASKED_DOX_TAG], updated_at: now },
  });
  if (task.project_id) {
    await db.project.updateMany({ where: { id: task.project_id, is_deleted: false }, data: { next_step_refresh_requested_at: now } });
  }
  return true;
}

/**
 * Someone answered a question Dox asked. Dox has no inbox: without this the answer sat on the card until the next scheduled sweep, and on a
 * card that is already closed (a setup card after setup) nothing would ever bring him back to it. The card is marked `asked-dox` and the
 * project's refresh is stamped, the same signal a mention sends, so his next pass on the project is an event sweep with this card named.
 * A card still in Triage, or with no project, is left alone.
 */
export async function flagAnswerForDox(
  db: PrismaClient,
  taskId: string,
  question: { asked_by_user_id: string | null; asked_by_lane: string | null },
  answerer: { userId: string; lane?: string | null },
  now: Date = new Date(),
): Promise<boolean> {
  const askedByDox = question.asked_by_user_id === DOX_USER_ID || isDoxLaneValue(question.asked_by_lane);
  if (!askedByDox) return false;
  if (answerer.userId === DOX_USER_ID || isDoxLaneValue(answerer.lane)) return false;
  const task = await db.task.findUnique({ where: { id: taskId }, select: { id: true, status: true, project_id: true, tags: true } });
  if (!task || task.status === 'triage' || !task.project_id) return false;
  const tags = task.tags;
  await db.task.update({ where: { id: task.id }, data: tags.includes(ASKED_DOX_TAG) ? { updated_at: now } : { tags: [...tags, ASKED_DOX_TAG], updated_at: now } });
  await db.project.updateMany({ where: { id: task.project_id, is_deleted: false }, data: { next_step_refresh_requested_at: now } });
  return true;
}

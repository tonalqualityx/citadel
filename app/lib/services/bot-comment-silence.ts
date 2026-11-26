/**
 * A comment written by a bot user (Bast and its lanes, Dox, the worker, the Designer Portal worker) never notifies Mike.
 *
 * Handbook 12c: Mike hears about work only when he has to act or review. When he must act, the agent files his own
 * Citadel task (12c item 2), and that task's assignment notice is what reaches him. A comment from a bot, on his task
 * or anywhere else, is a record: no assignee notice, no mention notice, no Slack ping.
 * [Mike, 2026-11-26, after a worker cleanup pass commented on 22 of his tasks: "Also, my slack notifications are losing
 * their shit. What's happening?"]
 *
 * People's own comments are unchanged, and a bot comment still notifies anyone else who would hear of it (Sabeen on a
 * handoff, a PM on a question).
 */
import { BOT_USER_IDS, MIKE_USER_ID } from '@/lib/oracle/projects/gate-constants';

export { MIKE_USER_ID };

export function isBotUser(userId: string | null | undefined): boolean {
  return !!userId && BOT_USER_IDS.includes(userId);
}

/** True when a comment by `authorId` must not notify `recipientId`. */
export function botCommentSilentFor(authorId: string | null | undefined, recipientId: string | null | undefined): boolean {
  return recipientId === MIKE_USER_ID && isBotUser(authorId);
}

export const MIKE_ASK_TAG_PREFIX = 'mike-ask:';

type AskDb = {
  task: {
    findFirst: (args: any) => Promise<{ id: string } | null>; // eslint-disable-line @typescript-eslint/no-explicit-any
    create: (args: any) => Promise<{ id: string }>; // eslint-disable-line @typescript-eslint/no-explicit-any
  };
  comment: { create: (args: any) => Promise<unknown> }; // eslint-disable-line @typescript-eslint/no-explicit-any
};

/**
 * A bot comment that tags Mike is an ask for him to act. It never notifies him as a comment; it reaches him by handbook 12c
 * item 2 instead: his own Citadel task, holding the link to the card and the ask, whose assignment notice Citadel sends.
 * One task per card: while his task for this card is open, a later ask is added to it as a comment (which notifies nobody).
 * Returns the id of his task.
 */
export async function routeBotAskToMike(
  db: AskDb,
  args: {
    authorId: string;
    task: { id: string; title: string; project_id?: string | null; client_id?: string | null; site_id?: string | null };
    content: string;
    notifyAssigned: (taskId: string, assigneeId: string, assignerName: string) => Promise<unknown>;
    authorName: string;
  },
): Promise<{ task_id: string; created: boolean }> {
  const tag = `${MIKE_ASK_TAG_PREFIX}${args.task.id}`;
  const open = await db.task.findFirst({
    where: { assignee_id: MIKE_USER_ID, tags: { has: tag }, is_deleted: false, status: { notIn: ['done', 'abandoned'] } },
    select: { id: true },
  });
  if (open) {
    await db.comment.create({ data: { task_id: open.id, user_id: args.authorId, content: args.content, mentioned_user_ids: [], is_internal: true } });
    return { task_id: open.id, created: false };
  }
  const base = process.env.NEXT_PUBLIC_APP_URL || 'https://citadel.becomeindelible.com';
  const title = `Act on: ${args.task.title}`.slice(0, 500);
  const description = [
    `The card: ${base}/tasks/${args.task.id}`,
    '',
    `${args.authorName} asked:`,
    args.content,
    '',
    'Finalized by: nothing; this task is your step.',
  ].join('\n');
  const created = await db.task.create({
    data: {
      title,
      description,
      status: 'not_started',
      assignee_id: MIKE_USER_ID,
      created_by_id: args.authorId,
      project_id: args.task.project_id ?? null,
      client_id: args.task.client_id ?? null,
      site_id: args.task.site_id ?? null,
      tags: [tag],
    },
    select: { id: true },
  });
  await args.notifyAssigned(created.id, MIKE_USER_ID, args.authorName);
  return { task_id: created.id, created: true };
}

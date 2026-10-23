/**
 * The conversation on a work page (portal phase B slice 2, spec sections 3.1 to 3.3).
 *
 * The thread is the task's comments. What the client sees is decided in ONE place,
 * `isThreadMessage`: a comment is shown when it is not deleted, not internal, and either a client
 * wrote it (`author_contact_id`), staff flagged it for the client (`client_visible`) or it is one
 * of the older questions staff marked for the client (`client_question`). Everything else, the
 * worker's notes and old unflagged comments included, stays hidden.
 *
 * Staff replies carry the author "Indelible" and never a name (spec decision 6). Bast never
 * appears: a client-visible comment that names Bast is refused at write time (`bastWordError`).
 */
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { ApiError } from '@/lib/api/errors';
import { BAST_USER_ID } from '@/lib/oracle/projects/gate-constants';
import { taskAccessWhere, type PortalAccess } from '@/lib/portal/access';
import { clientVisibleTaskWhere } from '@/lib/portal/visibility';
import { onClientMessage } from '@/lib/portal/waits';
import { createNotification } from '@/lib/services/notifications';
import { emailClientMessage, staffQuietLastHour } from '@/lib/portal/staff-notify';
import { actorLaneField } from '@/lib/auth/actor-lane';

export const STAFF_AUTHOR_NAME = 'Indelible';
export const MESSAGE_MAX_CHARS = 4000;
export const MESSAGE_LIMITS = { per_hour: 120, per_day: 200 } as const;

/** Which message limit a contact has hit, or null. The name goes to the client as `limit`. */
export function messageLimitName(lastHour: number, lastDay: number): 'messages_per_hour' | 'messages_per_day' | null {
  if (lastHour >= MESSAGE_LIMITS.per_hour) return 'messages_per_hour';
  if (lastDay >= MESSAGE_LIMITS.per_day) return 'messages_per_day';
  return null;
}
export const MESSAGE_RATE_LIMIT_MESSAGE =
  'You have sent a lot in a short time. Please try again in a few minutes.';

const HOUR = 60 * 60 * 1000;
const DAY = 24 * 60 * 60 * 1000;
const THREAD_LIMIT = 500;

export interface ThreadCommentFields {
  is_deleted?: boolean | null;
  is_internal?: boolean | null;
  client_visible?: boolean | null;
  client_question?: boolean | null;
  author_contact_id?: string | null;
}

/** The one visibility rule for the thread. Pure; `threadCommentWhere` is its Prisma twin. */
export function isThreadMessage(c: ThreadCommentFields): boolean {
  if (c.is_deleted || c.is_internal) return false;
  return Boolean(c.author_contact_id) || c.client_visible === true || c.client_question === true;
}

/** Prisma twin of isThreadMessage, for a task's comments. */
export function threadCommentWhere(): Prisma.CommentWhereInput {
  return {
    is_deleted: false,
    is_internal: false,
    OR: [{ author_contact_id: { not: null } }, { client_visible: true }, { client_question: true }],
  };
}

/** Bast is the machine behind the support desk and never named to a client. */
const BAST_WORD = /\bbast\b/i;

/**
 * Characters that render as nothing (or reorder text) and so could hide a name from a plain
 * search: zero-width spaces and joiners, word joiner, the BOM, soft hyphen, the combining grapheme
 * joiner, and the bidi controls.
 */
const INVISIBLE = /[\u00AD\u034F\u061C\u115F\u1160\u17B4\u17B5\u180B-\u180E\u200B-\u200F\u202A-\u202E\u2060-\u206F\u3164\uFE00-\uFE0F\uFEFF\uFFA0]/g;

/** Fold a text to the form a reader sees: compatibility-normalised (fullwidth to ASCII) and with invisible characters removed. */
export function foldForNameCheck(text: string): string {
  return text.normalize('NFKC').replace(INVISIBLE, '');
}

/** The reason a comment may not be made client-visible, or null. Whole word, any case, after folding. */
export function bastWordError(text: string): string | null {
  return BAST_WORD.test(foldForNameCheck(text))
    ? 'This reply names Bast, so it cannot be shown to the client. Reword it, or keep it as an internal note.'
    : null;
}

export interface ThreadMessage {
  id: string;
  author: { kind: 'client' | 'staff'; name: string };
  /** True when the signed-in contact wrote it. */
  mine: boolean;
  text: string;
  created_at: Date | string;
}

interface ThreadRow extends ThreadCommentFields {
  id: string;
  content: string;
  created_at: Date | string;
  author_contact?: { name: string | null } | null;
}

export function toThreadMessage(row: ThreadRow, contactIds: string[]): ThreadMessage {
  const fromClient = Boolean(row.author_contact_id);
  const name = fromClient ? row.author_contact?.name?.trim() || 'A member of your team' : STAFF_AUTHOR_NAME;
  return {
    id: row.id,
    author: { kind: fromClient ? 'client' : 'staff', name },
    mine: fromClient && contactIds.includes(row.author_contact_id as string),
    text: row.content,
    created_at: row.created_at,
  };
}

const personIds = (access: PortalAccess) =>
  access.contactIds && access.contactIds.length > 0 ? access.contactIds : [access.contactId];

/** A task the contact may read and write in. Same rule as the work page (the approve rule minus "staged"). */
export function threadTaskWhere(access: PortalAccess, taskId: string): Prisma.TaskWhereInput {
  return {
    id: taskId,
    is_deleted: false,
    AND: [
      { OR: [{ client_id: access.clientId }, { site: { client_id: access.clientId } }] },
      clientVisibleTaskWhere(),
      taskAccessWhere(access),
    ],
  };
}

/** The thread, oldest first. Null when the task is not visible to this contact (answer 404). */
export async function loadThread(
  access: PortalAccess,
  taskId: string,
  opts: { after?: Date | null } = {}
): Promise<ThreadMessage[] | null> {
  const task = await prisma.task.findFirst({ where: threadTaskWhere(access, taskId), select: { id: true } });
  if (!task) return null;
  const rows = await prisma.comment.findMany({
    where: {
      task_id: taskId,
      AND: [threadCommentWhere(), opts.after ? { created_at: { gt: opts.after } } : {}],
    },
    select: {
      id: true,
      content: true,
      created_at: true,
      author_contact_id: true,
      author_contact: { select: { name: true } },
    },
    orderBy: { created_at: 'asc' },
    take: THREAD_LIMIT,
  });
  return rows.map((r) => toThreadMessage(r, personIds(access)));
}

export interface PostedMessage {
  message: ThreadMessage;
  created: boolean;
}

/**
 * A client writes in the thread. One Comment authored by the contact, text verbatim, never
 * internal. `client_ref` makes a double send a no-op. The wait effects (3.5) run in the same
 * transaction; the in-app alert to the assignee runs after it, so a failed alert loses nothing.
 */
export async function postClientMessage(
  access: PortalAccess,
  contact: { id: string; name: string | null },
  taskId: string,
  input: { client_ref: string; text: string },
  opts: { now?: Date } = {}
): Promise<PostedMessage> {
  const now = opts.now ?? new Date();
  if (access.revoked) throw new ApiError('Not found', 404);
  if (input.text.trim().length === 0 || input.text.length > MESSAGE_MAX_CHARS) {
    throw new ApiError(`Messages are 1 to ${MESSAGE_MAX_CHARS} characters.`, 400, 'bad_message');
  }
  const ids = personIds(access);

  const result = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`portal-msg:${input.client_ref}`}))`;

    const task = await tx.task.findFirst({
      where: threadTaskWhere(access, taskId),
      select: {
        id: true,
        title: true,
        client_title: true,
        assignee_id: true,
        client_id: true,
        project_id: true,
        charter_id: true,
        site_id: true,
        client: { select: { name: true } },
      },
    });
    if (!task) throw new ApiError('Not found', 404);

    const select = {
      id: true,
      task_id: true,
      content: true,
      created_at: true,
      author_contact_id: true,
      author_contact: { select: { name: true } },
    } as const;

    const existing = await tx.comment.findUnique({ where: { client_ref: input.client_ref }, select });
    if (existing) {
      // A repeat from the same person on the same task is a no-op. Anything else is not theirs.
      if (existing.task_id !== taskId || !existing.author_contact_id || !ids.includes(existing.author_contact_id)) {
        throw new ApiError('Not found', 404);
      }
      return { row: existing, created: false, task };
    }

    const [recent, today] = await Promise.all([
      tx.comment.count({ where: { author_contact_id: { in: ids }, created_at: { gte: new Date(now.getTime() - HOUR) } } }),
      tx.comment.count({ where: { author_contact_id: { in: ids }, created_at: { gte: new Date(now.getTime() - DAY) } } }),
    ]);
    const messageLimit = messageLimitName(recent, today);
    if (messageLimit) throw new ApiError(MESSAGE_RATE_LIMIT_MESSAGE, 429, 'rate_limited', messageLimit);

    const row = await tx.comment.create({
      data: { ...(await actorLaneField()),
        task_id: taskId,
        // No staff or bot author: the client is the author (author_contact_id), user_id stays null.
        user_id: null,
        content: input.text,
        is_internal: false,
        client_visible: true,
        author_contact_id: contact.id,
        client_ref: input.client_ref,
      },
      select,
    });

    await onClientMessage(
      tx,
      {
        id: task.id,
        client_title: task.client_title ?? task.title,
        assignee_id: task.assignee_id,
        client_id: task.client_id,
        project_id: task.project_id,
        charter_id: task.charter_id,
        site_id: task.site_id,
      },
      { contact_ids: ids, comment_id: row.id },
      now
    );
    return { row, created: true, task };
  });

  if (result.created && result.task.assignee_id && result.task.assignee_id !== BAST_USER_ID) {
    // Decide before the in-app row exists, or that row would always count as recent.
    const quiet = await staffQuietLastHour(result.task.assignee_id, result.task.id, now);
    try {
      const who = contact.name?.trim() || 'A client contact';
      await createNotification({
        userId: result.task.assignee_id,
        type: 'comment_added',
        title: `New message on "${result.task.client_title ?? result.task.title}"`,
        message: `${who} wrote in the portal thread.`,
        entityType: 'task',
        entityId: result.task.id,
      });
    } catch (error) {
      console.error('portal message notification failed', error);
    }
    if (quiet) {
      await emailClientMessage({
        assigneeId: result.task.assignee_id,
        taskId: result.task.id,
        commentId: result.row.id,
        clientName: result.task.client?.name ?? 'A client',
        contactName: contact.name,
        requestTitle: result.task.client_title ?? result.task.title,
        text: input.text,
      });
    }
  }

  return { message: toThreadMessage(result.row, ids), created: result.created };
}

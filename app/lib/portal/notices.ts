/**
 * Portal notices (portal phase B slice 2, spec section 3.4): the outbox behind "there is a new
 * reply on your request".
 *
 * Making a staff comment client-visible, on create or on toggle, calls `queuePortalNotices`. One
 * notice per recipient; a still-queued notice for the same task and contact absorbs a newer reply
 * (one email per burst). The machine-side sender (approval-sender.py, process_portal_notices)
 * takes notices older than the two-minute hold, and `cancelStaleNotices` is the sender's first
 * step: a notice whose reply was unflagged or deleted in the hold never goes out.
 *
 * Nothing here sends mail. The email text is fixed (writing standard 4b: it names the request and
 * what the reader can do in its first lines) and is written by `buildNoticeBody`.
 */
import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { effectiveClientRole, type PortalAccess, type PortalRole } from '@/lib/portal/access';
import { threadTaskWhere } from '@/lib/portal/thread';

export const NOTICE_HOLD_SECONDS = 120;
export const NOTICE_REPLY_MAX_CHARS = 1500;
export const READ_THE_REST = 'Read the rest in your portal';

export const noticeSubject = (clientTitle: string) => `New reply on your request: ${clientTitle}`.slice(0, 255);

export function portalBaseUrl(): string {
  return (process.env.NEXT_PUBLIC_APP_URL || 'https://citadel.becomeindelible.com').replace(/\/+$/, '');
}

export const workPageUrl = (taskId: string) => `${portalBaseUrl()}/portal/work/${taskId}`;

/** The token the sender and the inbound classifier match on. First eight characters of the id. */
export const noticeRef = (noticeId: string) => `PN-${noticeId.slice(0, 8)}`;

function firstNameOf(name: string | null | undefined): string {
  const first = (name ?? '').trim().split(/\s+/)[0];
  return first || 'there';
}

/** Several replies in one burst read as paragraphs. Cut at the limit, never mid-link if avoidable. */
export function joinReplies(replies: string[]): { text: string; cut: boolean } {
  const joined = replies.map((r) => r.trim()).filter(Boolean).join('\n\n');
  if (joined.length <= NOTICE_REPLY_MAX_CHARS) return { text: joined, cut: false };
  const head = joined.slice(0, NOTICE_REPLY_MAX_CHARS);
  const lastSpace = head.lastIndexOf(' ');
  return { text: (lastSpace > NOTICE_REPLY_MAX_CHARS - 80 ? head.slice(0, lastSpace) : head).trimEnd(), cut: true };
}

/** The fixed plain-text body. No dashes, no promises, signed Indelible support. */
export function buildNoticeBody(input: {
  noticeId: string;
  taskId: string;
  contactName: string | null;
  clientTitle: string;
  replies: string[];
}): string {
  const { text, cut } = joinReplies(input.replies);
  return [
    `Hi ${firstNameOf(input.contactName)},`,
    '',
    `There is a new reply on your request "${input.clientTitle}":`,
    '',
    cut ? `${text}\n\n${READ_THE_REST}.` : text,
    '',
    workPageUrl(input.taskId),
    '',
    'You can reply in the portal. Replies to this email reach the team too.',
    '',
    'Indelible support',
    '',
    `Ref: ${noticeRef(input.noticeId)}`,
  ].join('\n');
}

export interface NoticeTask {
  id: string;
  client_title: string;
  client_id: string | null;
  requested_by_contact_id: string | null;
}

/**
 * Who gets the email: the requester plus every contact who wrote in the thread, minus anyone
 * deleted, without an address, or without access to this task. Access is the work page's own
 * rule (`threadTaskWhere`), so the email can never point someone at a page that answers 404.
 */
export async function noticeRecipients(
  task: NoticeTask
): Promise<Array<{ id: string; name: string | null; email: string }>> {
  const authors = await prisma.comment.findMany({
    where: { task_id: task.id, is_deleted: false, author_contact_id: { not: null } },
    select: { author_contact_id: true },
    distinct: ['author_contact_id'],
  });
  const ids = [...new Set([task.requested_by_contact_id, ...authors.map((a) => a.author_contact_id)].filter((x): x is string => !!x))];
  if (ids.length === 0 || !task.client_id) return [];

  const [contacts, client] = await Promise.all([
    prisma.clientContact.findMany({
      where: { id: { in: ids }, is_deleted: false, client: { is_deleted: false } },
      select: { id: true, name: true, email: true, client_id: true, portal_role: true, is_deleted: true },
    }),
    prisma.client.findUnique({ where: { id: task.client_id }, select: { id: true, parent_agency_id: true } }),
  ]);
  if (!client) return [];

  const out: Array<{ id: string; name: string | null; email: string }> = [];
  for (const c of contacts) {
    if (!c.email?.trim()) continue;
    const role: PortalRole = effectiveClientRole(c as Parameters<typeof effectiveClientRole>[0], client);
    const access: PortalAccess = { contactId: c.id, clientId: client.id, role };
    const visible = await prisma.task.count({ where: threadTaskWhere(access, task.id) });
    if (visible > 0) out.push({ id: c.id, name: c.name, email: c.email.trim() });
  }
  return out;
}

/**
 * Queue (or extend) one notice per recipient for a reply that has just become client-visible.
 * Idempotent per comment: a reply already carried by a notice is not added twice.
 */
export async function queuePortalNotices(
  task: NoticeTask,
  comment: { id: string }
): Promise<{ queued: number; absorbed: number }> {
  const recipients = await noticeRecipients(task);
  let queued = 0;
  let absorbed = 0;

  for (const r of recipients) {
    await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`portal-notice:${task.id}:${r.id}`}))`;

      const sameComment = await tx.portalNotice.findFirst({
        where: { task_id: task.id, contact_id: r.id, comment_ids: { has: comment.id }, status: { in: ['queued', 'sending', 'sent'] } },
        select: { id: true },
      });
      if (sameComment) return;

      const open = await tx.portalNotice.findFirst({
        where: { task_id: task.id, contact_id: r.id, status: 'queued' },
        orderBy: { created_at: 'asc' },
      });

      if (open) {
        const ids = [...open.comment_ids, comment.id];
        const replies = await repliesFor(tx, ids);
        await tx.portalNotice.update({
          where: { id: open.id },
          data: {
            comment_ids: ids,
            to_email: r.email,
            body: buildNoticeBody({ noticeId: open.id, taskId: task.id, contactName: r.name, clientTitle: task.client_title, replies }),
          },
        });
        absorbed++;
        return;
      }

      const id = randomUUID();
      const replies = await repliesFor(tx, [comment.id]);
      await tx.portalNotice.create({
        data: {
          id,
          task_id: task.id,
          contact_id: r.id,
          comment_ids: [comment.id],
          to_email: r.email,
          subject: noticeSubject(task.client_title),
          body: buildNoticeBody({ noticeId: id, taskId: task.id, contactName: r.name, clientTitle: task.client_title, replies }),
        },
      });
      queued++;
    });
  }
  return { queued, absorbed };
}

async function repliesFor(tx: Prisma.TransactionClient, ids: string[]): Promise<string[]> {
  const rows = await tx.comment.findMany({
    where: { id: { in: ids }, is_deleted: false, is_internal: false, client_visible: true },
    select: { id: true, content: true, created_at: true },
    orderBy: { created_at: 'asc' },
  });
  return rows.map((r) => r.content);
}

/**
 * Cancel queued notices whose replies are no longer client-visible (unflagged, deleted or made
 * internal during the hold), and drop such replies from a notice that still carries others.
 * Called by the sender's list route before it hands out anything. Returns the number cancelled.
 */
export async function cancelStaleNotices(now: Date = new Date()): Promise<number> {
  const queued = await prisma.portalNotice.findMany({ where: { status: 'queued' } });
  let cancelled = 0;
  for (const n of queued) {
    const live = await prisma.comment.findMany({
      where: { id: { in: n.comment_ids }, is_deleted: false, is_internal: false, client_visible: true },
      select: { id: true, content: true, created_at: true },
      orderBy: { created_at: 'asc' },
    });
    if (live.length === 0) {
      const res = await prisma.portalNotice.updateMany({
        where: { id: n.id, status: 'queued' },
        data: { status: 'cancelled', cancelled_at: now },
      });
      cancelled += res.count;
      continue;
    }
    // Rebuild the body from what is still shared, so an edited or partly retracted burst never
    // goes out with stale text.
    const [task, contact] = await Promise.all([
      prisma.task.findUnique({ where: { id: n.task_id }, select: { title: true, client_title: true } }),
      prisma.clientContact.findUnique({ where: { id: n.contact_id }, select: { name: true } }),
    ]);
    const body = buildNoticeBody({
      noticeId: n.id,
      taskId: n.task_id,
      contactName: contact?.name ?? null,
      clientTitle: task?.client_title ?? task?.title ?? 'your request',
      replies: live.map((l) => l.content),
    });
    if (body !== n.body || live.length !== n.comment_ids.length) {
      await prisma.portalNotice.updateMany({
        where: { id: n.id, status: 'queued' },
        data: { comment_ids: live.map((l) => l.id), body },
      });
    }
  }
  return cancelled;
}

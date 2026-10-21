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

type Db = Prisma.TransactionClient | typeof prisma;

interface ContactRow {
  id: string;
  name: string | null;
  email: string;
  client_id: string;
  portal_role: PortalRole;
  is_deleted: boolean;
}

/**
 * Can this contact open this task's work page right now? The work page's own rule
 * (`threadTaskWhere`) with the role the contact holds on the task's client. Used when the notice is
 * queued AND again when it is claimed for sending, so a revoked contact never gets the email.
 */
async function contactCanOpen(db: Db, c: ContactRow, task: { id: string; client_id: string | null }): Promise<boolean> {
  if (c.is_deleted || !c.email?.trim() || !task.client_id) return false;
  const client = await db.client.findUnique({ where: { id: task.client_id }, select: { id: true, parent_agency_id: true, is_deleted: true } });
  if (!client || client.is_deleted) return false;
  const role: PortalRole = effectiveClientRole(c as Parameters<typeof effectiveClientRole>[0], client);
  const access: PortalAccess = { contactId: c.id, clientId: client.id, role };
  return (await db.task.count({ where: threadTaskWhere(access, task.id) })) > 0;
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

  const contacts = await prisma.clientContact.findMany({
    where: { id: { in: ids }, is_deleted: false, client: { is_deleted: false } },
    select: { id: true, name: true, email: true, client_id: true, portal_role: true, is_deleted: true },
  });

  const out: Array<{ id: string; name: string | null; email: string }> = [];
  for (const c of contacts) {
    if (await contactCanOpen(prisma, c as ContactRow, task)) out.push({ id: c.id, name: c.name, email: c.email.trim() });
  }
  return out;
}

const lockKey = (taskId: string, contactId: string) => `portal-notice:${taskId}:${contactId}`;

/**
 * Queue (or extend) one notice per recipient for a reply that has just become client-visible.
 * Idempotent per comment: a reply already carried by a notice is not added twice.
 *
 * A still-queued notice for the same task and contact absorbs the reply, with a conditional update
 * (`status = 'queued'`). If the sender claimed it in the meantime the update matches nothing and a
 * NEW notice is created, so a reply is never folded into an email that is already going out.
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
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${lockKey(task.id, r.id)}))`;

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
        const folded = await tx.portalNotice.updateMany({
          where: { id: open.id, status: 'queued' },
          data: {
            comment_ids: ids,
            to_email: r.email,
            body: buildNoticeBody({ noticeId: open.id, taskId: task.id, contactName: r.name, clientTitle: task.client_title, replies }),
          },
        });
        if (folded.count === 1) {
          absorbed++;
          return;
        }
        // Claimed by the sender between the read and the write: this reply gets its own notice.
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

async function repliesFor(tx: Db, ids: string[]): Promise<string[]> {
  const rows = await tx.comment.findMany({
    where: { id: { in: ids }, is_deleted: false, is_internal: false, client_visible: true },
    select: { id: true, content: true, created_at: true },
    orderBy: { created_at: 'asc' },
  });
  return rows.map((r) => r.content);
}

export type RefreshResult =
  | { state: 'cancelled'; reason: 'no_replies' | 'no_access' }
  | { state: 'queued'; notice: { id: string; to_email: string; subject: string; body: string } };

/**
 * Bring ONE queued notice in line with the world, inside the caller's transaction: cancel it when
 * every reply was withdrawn or the recipient no longer has access (deleted, revoked, project
 * hidden), otherwise rebuild the body from the replies still shared and the address on file.
 * The sender's list pass and its claim both call this, so what is sent is what was just checked.
 */
export async function refreshQueuedNotice(
  db: Db,
  n: { id: string; task_id: string; contact_id: string; comment_ids: string[]; to_email: string; subject: string; body: string },
  now: Date = new Date()
): Promise<RefreshResult> {
  const cancel = async (reason: 'no_replies' | 'no_access', note: string | null) => {
    await db.portalNotice.updateMany({
      where: { id: n.id, status: 'queued' },
      data: { status: 'cancelled', cancelled_at: now, ...(note ? { send_error: note } : {}) },
    });
    return { state: 'cancelled', reason } as const;
  };

  const live = await db.comment.findMany({
    where: { id: { in: n.comment_ids }, is_deleted: false, is_internal: false, client_visible: true },
    select: { id: true, content: true, created_at: true },
    orderBy: { created_at: 'asc' },
  });
  if (live.length === 0) return cancel('no_replies', null);

  const [task, contact] = await Promise.all([
    db.task.findUnique({ where: { id: n.task_id }, select: { id: true, title: true, client_title: true, client_id: true, is_deleted: true, site: { select: { client_id: true } } } }),
    db.clientContact.findUnique({ where: { id: n.contact_id }, select: { id: true, name: true, email: true, client_id: true, portal_role: true, is_deleted: true } }),
  ]);
  const clientId = task?.client_id ?? task?.site?.client_id ?? null;
  if (!task || task.is_deleted || !contact || !(await contactCanOpen(db, contact as ContactRow, { id: task.id, client_id: clientId }))) {
    return cancel('no_access', 'recipient no longer has access to this request');
  }

  const toEmail = contact.email.trim();
  const body = buildNoticeBody({
    noticeId: n.id,
    taskId: n.task_id,
    contactName: contact.name,
    clientTitle: task.client_title ?? task.title,
    replies: live.map((l) => l.content),
  });
  const subject = noticeSubject(task.client_title ?? task.title);
  if (body !== n.body || toEmail !== n.to_email || subject !== n.subject || live.length !== n.comment_ids.length) {
    await db.portalNotice.updateMany({
      where: { id: n.id, status: 'queued' },
      data: { comment_ids: live.map((l) => l.id), body, to_email: toEmail, subject },
    });
  }
  return { state: 'queued', notice: { id: n.id, to_email: toEmail, subject, body } };
}

/**
 * Cancel queued notices that have nothing left to say, and refresh the rest. Called by the
 * sender's list route. Each notice is handled under the same advisory lock the queue and the
 * claim use. Returns the number cancelled.
 */
export async function cancelStaleNotices(now: Date = new Date()): Promise<number> {
  const queued = await prisma.portalNotice.findMany({ where: { status: 'queued' } });
  let cancelled = 0;
  for (const n of queued) {
    const result = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${lockKey(n.task_id, n.contact_id)}))`;
      const fresh = await tx.portalNotice.findUnique({ where: { id: n.id } });
      if (!fresh || fresh.status !== 'queued') return null;
      return refreshQueuedNotice(tx, fresh, now);
    });
    if (result?.state === 'cancelled') cancelled++;
  }
  return cancelled;
}

/**
 * The sender's claim: under the queue's advisory lock, refresh the notice (cancel it if its
 * replies were withdrawn or the recipient lost access), then move queued -> sending. Returns the
 * notice exactly as it must be sent, or why it cannot be: the sender sends THESE fields, never the
 * copy it read from the list.
 */
export async function claimNotice(
  id: string,
  now: Date = new Date()
): Promise<
  | { ok: true; notice: { id: string; status: 'sending'; send_attempt_at: Date; to_email: string; subject: string; body: string } }
  | { ok: false; reason: 'not_found' | 'not_queued' | 'withdrawn' | 'no_access' }
> {
  const existing = await prisma.portalNotice.findUnique({ where: { id }, select: { task_id: true, contact_id: true } });
  if (!existing) return { ok: false, reason: 'not_found' };
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${lockKey(existing.task_id, existing.contact_id)}))`;
    const n = await tx.portalNotice.findUnique({ where: { id } });
    if (!n) return { ok: false, reason: 'not_found' } as const;
    if (n.status !== 'queued') return { ok: false, reason: 'not_queued' } as const;
    const fresh = await refreshQueuedNotice(tx, n, now);
    if (fresh.state === 'cancelled') return { ok: false, reason: fresh.reason === 'no_access' ? 'no_access' : 'withdrawn' } as const;
    const claimed = await tx.portalNotice.updateMany({
      where: { id, status: 'queued' },
      data: { status: 'sending', send_attempt_at: now },
    });
    if (claimed.count !== 1) return { ok: false, reason: 'not_queued' } as const;
    return {
      ok: true,
      notice: { id, status: 'sending' as const, send_attempt_at: now, to_email: fresh.notice.to_email, subject: fresh.notice.subject, body: fresh.notice.body },
    } as const;
  });
}

/**
 * Tell the person who owns a portal request that it arrived. Mike knows before the client does.
 *
 * A request filed through the portal lands on a person (never Bast) with a first-response clock,
 * and until this module nothing told that person. Three paths:
 *  1. a new request filed onto a human assignee: one in-app notification and one email;
 *  2. a client message on a task with a human assignee: the in-app notification stays in
 *     thread.ts, and one email goes out only when that person has had no notification about the
 *     task in the last hour;
 *  3. the emergency path is untouched: it keeps its own critical alert in file-request.ts, so an
 *     emergency-tagged task is skipped here.
 *
 * Best effort: a failed alert or email never undoes the request, and callers wrap nothing. Every
 * function swallows and logs its own errors. Idempotent per task: the in-app row is looked up
 * first and the email carries a dedupe key, so a second call (a retry, the one-off backfill)
 * sends nothing new.
 */
import { prisma } from '@/lib/db/prisma';
import { BAST_USER_ID } from '@/lib/oracle/projects/gate-constants';
import { createInAppNotificationOnly } from '@/lib/services/notifications';
import { sendEmail } from '@/lib/services/email';
import { portalBaseUrl } from '@/lib/portal/notices';

const HOUR = 60 * 60 * 1000;
export const REQUEST_NOTIFICATION_PREFIX = 'New portal request';
const TZ = 'America/New_York';

export const staffTaskUrl = (taskId: string) => `${portalBaseUrl()}/tasks/${taskId}`;

/** "Thursday, October 22, 2026 at 4:00 PM Eastern". */
export function formatEastern(d: Date): string {
  const text = new Intl.DateTimeFormat('en-US', {
    timeZone: TZ,
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(d);
  // "Thursday, October 22, 2026 at 4:00 PM" in current ICU; older ICU omits "at".
  return `${text.includes(' at ') ? text : text.replace(/, (\d{1,2}:\d{2})/, ' at $1')} Eastern`;
}

/** Quote client words under a plain header. No dashes in what we write; their words stay theirs. */
function quote(text: string): string {
  return text
    .trim()
    .split(/\r?\n/)
    .map((l) => `> ${l}`)
    .join('\n');
}

interface IntakeAnswer {
  prompt?: string;
  value?: string;
}

export interface RequestEmail {
  subject: string;
  text: string;
}

export function buildRequestEmail(input: {
  clientName: string;
  contactName: string | null;
  kind: string;
  siteName: string | null;
  answers: IntakeAnswer[];
  dueAt: Date | null;
  taskId: string;
}): RequestEmail {
  const who = input.contactName?.trim() || 'a contact';
  const words = input.answers
    .filter((a) => a.value && a.value.trim())
    .map((a) => (a.prompt ? `${a.prompt}\n${quote(a.value!)}` : quote(a.value!)))
    .join('\n\n');
  const lines = [
    `${input.clientName} sent a new request through the client portal. It is assigned to you and nobody else has been told.`,
    '',
    'Client wrote:',
    words || '(no answers were stored)',
    '',
    `From: ${who}`,
    `Kind: ${input.kind}`,
    `Site: ${input.siteName ?? 'not tied to a site'}`,
    `First response due: ${input.dueAt ? formatEastern(input.dueAt) : 'no clock was found for this request'}`,
    '',
    `Open the task: ${staffTaskUrl(input.taskId)}`,
  ];
  return { subject: `${input.clientName}: new request in the portal`, text: lines.join('\n') };
}

/** Path 1. Returns what it did, for tests and the one-off script. */
export async function notifyNewPortalRequest(
  taskId: string
): Promise<{ notified: boolean; emailed: boolean; reason?: string }> {
  try {
    const task = await prisma.task.findUnique({
      where: { id: taskId },
      select: {
        id: true,
        title: true,
        client_title: true,
        tags: true,
        source: true,
        assignee_id: true,
        client_intake: true,
        client: { select: { name: true } },
        site: { select: { name: true } },
        assignee: { select: { id: true, email: true, is_active: true } },
        requested_by_contact: { select: { name: true } },
      },
    });
    if (!task) return { notified: false, emailed: false, reason: 'no task' };
    if (task.source !== 'portal') return { notified: false, emailed: false, reason: 'not a portal task' };
    if (!task.assignee_id || task.assignee_id === BAST_USER_ID) return { notified: false, emailed: false, reason: 'assignee is Bast or empty' };
    if (task.tags.includes('emergency')) return { notified: false, emailed: false, reason: 'emergency path owns this' };

    const clientName = task.client?.name ?? 'A client';
    const requestTitle = task.client_title ?? task.title;
    const intake = (task.client_intake ?? {}) as { type?: string; answers?: IntakeAnswer[] };

    let notified = false;
    const already = await prisma.notification.findFirst({
      where: {
        user_id: task.assignee_id,
        entity_type: 'task',
        entity_id: task.id,
        type: 'system_alert',
        title: { startsWith: REQUEST_NOTIFICATION_PREFIX },
      },
      select: { id: true },
    });
    if (!already) {
      await createInAppNotificationOnly({
        userId: task.assignee_id,
        type: 'system_alert',
        title: `${REQUEST_NOTIFICATION_PREFIX} from ${clientName}: ${requestTitle}`.slice(0, 255),
        message: `Open the task: ${staffTaskUrl(task.id)}`,
        entityType: 'task',
        entityId: task.id,
        priority: 'high',
      });
      notified = true;
    }

    let emailed = false;
    if (task.assignee?.email && task.assignee.is_active !== false) {
      const wait = await prisma.wait.findFirst({
        where: { task_id: task.id, template_key: 'portal.first_response' },
        orderBy: { created_at: 'asc' },
        select: { due_at: true },
      });
      const mail = buildRequestEmail({
        clientName,
        contactName: task.requested_by_contact?.name ?? null,
        kind: intake.type ?? 'request',
        siteName: task.site?.name ?? null,
        answers: Array.isArray(intake.answers) ? intake.answers : [],
        dueAt: wait?.due_at ?? null,
        taskId: task.id,
      });
      // The dedupe key makes a repeat a no-op in the outbox. Internal recipient: no external flag.
      await sendEmail({
        to: task.assignee.email,
        subject: mail.subject,
        text: mail.text,
        kind: 'notification',
        dedupeKey: `portal-request:${task.id}`,
      });
      emailed = true;
    }
    return { notified, emailed };
  } catch (error) {
    console.error('portal request staff notification failed', error);
    return { notified: false, emailed: false, reason: 'error' };
  }
}

/** True when the person has had no notification about this task in the last hour. */
export async function staffQuietLastHour(userId: string, taskId: string, now: Date = new Date()): Promise<boolean> {
  try {
    const recent = await prisma.notification.findFirst({
      where: { user_id: userId, entity_type: 'task', entity_id: taskId, created_at: { gte: new Date(now.getTime() - HOUR) } },
      select: { id: true },
    });
    return !recent;
  } catch (error) {
    console.error('portal quiet check failed', error);
    return false;
  }
}

/** Path 2, the email half. The caller decides `quiet` before it creates the in-app row. */
export async function emailClientMessage(input: {
  assigneeId: string;
  taskId: string;
  commentId: string;
  clientName: string;
  contactName: string | null;
  requestTitle: string;
  text: string;
}): Promise<boolean> {
  try {
    const user = await prisma.user.findUnique({ where: { id: input.assigneeId }, select: { email: true, is_active: true } });
    if (!user?.email || user.is_active === false) return false;
    const who = input.contactName?.trim() || 'a contact';
    const body = [
      `${input.clientName} wrote a new message in the client portal on the request "${input.requestTitle}". The request is assigned to you.`,
      '',
      'Client wrote:',
      quote(input.text),
      '',
      `From: ${who}`,
      '',
      `Open the task: ${staffTaskUrl(input.taskId)}`,
    ].join('\n');
    await sendEmail({
      to: user.email,
      subject: `${input.clientName}: new message in the portal`,
      text: body,
      kind: 'notification',
      dedupeKey: `portal-message:${input.commentId}`,
    });
    return true;
  } catch (error) {
    console.error('portal message email failed', error);
    return false;
  }
}

/**
 * The chat sweep (phase C spec 7.2, 2.5, 7.3; slice C4). The runner calls `POST /api/portal-chat/sweep`
 * every 60 seconds; the pass is idempotent, so a missed or doubled call changes nothing.
 *
 * 1. Away email: a conversation whose latest client-visible message is Bast's own open question (or a
 *    summary waiting for a yes) and has gone quiet gets ONE email: 10 minutes after the reply and
 *    after the last typing signal, or 3 minutes after the tab closed. One per reply
 *    (`away_sent_for_comment_id`), never a reminder.
 * 2. Staff replies: a staff reply on a chat task, after the same 120-second hold, goes by the same
 *    lane when the client is away, and not at all when the client is watching.
 * 3. Stalls: a client message in model mode with no reply after 3 minutes gets the fixed line and a
 *    person; an email job that expired or failed does the same, so a client's email is never dropped.
 * 4. Question chats: a numbers or status question closes as done 24 hours after Bast answered it.
 * 5. The "awaiting the client" clock closes when the client has answered.
 */
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { expireStaleJobs } from '@/lib/engine/queue';
import { onChatAwayEmail, onChatClientAnswered } from '@/lib/portal/waits';
import { postInternalNote } from '@/lib/portal/chat/assistant-comment';
import { handOff } from '@/lib/portal/chat/handoff';
import { CANNED_LINE } from '@/lib/portal/chat/copy';
import { chatSwitchesOn } from '@/lib/portal/chat/switches';
import { readSlots } from '@/lib/portal/chat/slots';
import {
  AWAY_HIDDEN_MS, AWAY_SILENCE_MS, STAFF_HOLD_MS, awayKey, buildAwayBody, buildStaffBody, clientIsWatching, emailFixedLine, frameFor,
  loadContactRow, openAskForEmail, queueChatEmail,
} from '@/lib/portal/chat/mailer';
import { OPEN_STATES } from '@/lib/waits/sweeper';

const STALL_MS = 3 * 60_000;
const QUESTION_CLOSE_MS = 24 * 60 * 60_000;
const STAFF_WINDOW_MS = 60 * 60_000;
const EMAIL_JOB_WINDOW_MS = 60 * 60_000;

export interface SweepResult {
  away: number;
  staff: number;
  stalled: number;
  email_failed: number;
  closed: number;
  waits_closed: number;
}

type ConvoFull = Prisma.ChatConversationGetPayload<object>;

/** The contact an email to this conversation goes to: whoever wrote last, else who opened it. */
async function contactFor(convo: ConvoFull) {
  const last = await prisma.comment.findFirst({
    where: { task_id: convo.task_id, author_contact_id: { not: null }, is_deleted: false },
    orderBy: { created_at: 'desc' },
    select: { author_contact_id: true },
  });
  return loadContactRow(prisma, last?.author_contact_id ?? convo.opened_by_contact_id);
}

const visibleCommentWhere = { is_deleted: false, is_internal: false, OR: [{ author_contact_id: { not: null } }, { client_visible: true }] } satisfies Prisma.CommentWhereInput;

async function awayPass(now: Date): Promise<number> {
  const candidates = await prisma.chatConversation.findMany({
    where: { state: { in: ['clarifying', 'confirming'] } },
    take: 200,
  });
  let sent = 0;
  for (const c of candidates) {
    if (!c.open_ask && c.state !== 'confirming') continue;
    const latest = await prisma.comment.findFirst({
      where: { task_id: c.task_id, ...visibleCommentWhere },
      orderBy: { created_at: 'desc' },
      select: { id: true, created_at: true, author_contact_id: true, source: true, user_id: true },
    });
    // The latest word is Bast's own, and the client has not answered it.
    if (!latest || latest.author_contact_id || latest.source !== 'assistant') continue;
    if (c.away_sent_for_comment_id === latest.id) continue;
    const since = (t: Date | null) => (t ? now.getTime() - t.getTime() : Infinity);
    const quiet = since(latest.created_at) >= AWAY_SILENCE_MS && since(c.last_typing_at) >= AWAY_SILENCE_MS;
    const closed = c.page_hidden_at !== null && since(c.page_hidden_at) >= AWAY_HIDDEN_MS && since(latest.created_at) >= AWAY_HIDDEN_MS;
    if (!quiet && !closed) continue;

    const switches = await chatSwitchesOn({ contactId: c.opened_by_contact_id, clientId: c.client_id, siteId: c.site_id });
    if (!switches.on) continue;

    const did = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`portal-chat-convo:${c.id}`}))`;
      const fresh = await tx.chatConversation.findUnique({ where: { id: c.id } });
      if (!fresh || !['clarifying', 'confirming'].includes(fresh.state) || fresh.away_sent_for_comment_id === latest.id) return false;
      const newest = await tx.comment.findFirst({ where: { task_id: c.task_id, ...visibleCommentWhere }, orderBy: { created_at: 'desc' }, select: { id: true } });
      if (newest?.id !== latest.id) return false; // the client answered while we looked
      const contact = await contactFor(fresh);
      if (!contact) return false;
      const frame = await frameFor(tx, fresh, contact);
      const asked = await openAskForEmail(fresh);
      const summary = fresh.state === 'confirming' ? fresh.summary_text ?? readSlots(fresh.slots).summary?.text ?? null : null;
      if (!asked && !summary) return false;
      const text = buildAwayBody({ ...frame, question: asked?.question ?? '', choices: asked?.choices ?? [], summary });
      const res = await queueChatEmail(tx, { convo: fresh, contact, kind: 'away', clientTitle: frame.clientTitle, text, dedupeKey: awayKey(fresh.id, latest.id) });
      await tx.chatConversation.update({ where: { id: fresh.id }, data: { away_sent_for_comment_id: latest.id } });
      if (!res.queued) {
        if (res.reason !== 'duplicate') {
          await postInternalNote(tx, fresh.task_id, `The away email was not sent: ${res.reason === 'no_email' ? 'the contact has no email address' : 'the contact no longer has access to this request'}.`, { away_email: res.reason });
        }
        return false;
      }
      const task = await tx.task.findUniqueOrThrow({
        where: { id: fresh.task_id },
        select: { id: true, title: true, client_title: true, assignee_id: true, client_id: true, project_id: true, charter_id: true, site_id: true, requested_by_contact_id: true },
      });
      await onChatAwayEmail(tx, { ...task, client_title: task.client_title ?? task.title }, latest.id, now);
      return true;
    });
    if (did) sent++;
  }
  return sent;
}

async function staffPass(now: Date): Promise<number> {
  const since = new Date(now.getTime() - STAFF_WINDOW_MS);
  const pending = await prisma.comment.findMany({
    where: {
      created_at: { gte: since },
      author_contact_id: null,
      is_deleted: false,
      is_internal: false,
      client_visible: true,
      OR: [{ source: null }, { source: { notIn: ['assistant'] } }],
      chat_meta: { equals: Prisma.DbNull },
      task: { chat_conversation: { isNot: null } },
    },
    orderBy: { created_at: 'asc' },
    select: { id: true, task_id: true, content: true, created_at: true, user_id: true },
  });
  const byTask = new Map<string, typeof pending>();
  for (const p of pending) byTask.set(p.task_id, [...(byTask.get(p.task_id) ?? []), p]);
  let sent = 0;
  for (const [taskId, rows] of byTask) {
    const newest = rows[rows.length - 1];
    if (now.getTime() - newest.created_at.getTime() < STAFF_HOLD_MS) continue; // the hold: a newer reply restarts it
    const convo = await prisma.chatConversation.findUnique({ where: { task_id: taskId } });
    if (!convo) continue;

    const mark = async (status: string) => {
      for (const r of rows) await prisma.comment.updateMany({ where: { id: r.id, chat_meta: { equals: Prisma.DbNull } }, data: { chat_meta: { email_notice: status } } });
    };
    // Withdrawn during the hold (made internal, deleted, unshared): nothing goes.
    const live = await prisma.comment.findMany({ where: { id: { in: rows.map((r) => r.id) }, is_deleted: false, is_internal: false, client_visible: true }, orderBy: { created_at: 'asc' }, select: { id: true, content: true } });
    if (live.length === 0) {
      await mark('withdrawn');
      continue;
    }
    const answeredAfter = await prisma.comment.count({ where: { task_id: taskId, author_contact_id: { not: null }, created_at: { gt: newest.created_at }, is_deleted: false } });
    if (answeredAfter > 0 || clientIsWatching(convo, now)) {
      await mark(answeredAfter > 0 ? 'client_replied' : 'watching');
      continue;
    }
    const contact = await contactFor(convo);
    const task = await prisma.task.findUnique({ where: { id: taskId }, select: { id: true } });
    if (!contact || !task) {
      await mark('no_contact');
      continue;
    }
    const frame = await frameFor(prisma, convo, contact);
    const text = buildStaffBody({ ...frame, replies: live.map((l) => l.content) });
    const res = await queueChatEmail(prisma, { convo, contact, kind: 'staff', clientTitle: frame.clientTitle, text, dedupeKey: `chatstaff:${convo.id}:${newest.id}` });
    if (res.queued) {
      sent++;
      await mark('queued');
    } else {
      await mark(res.reason === 'duplicate' ? 'queued' : res.reason);
      if (res.reason !== 'duplicate') {
        await prisma.$transaction((tx) => postInternalNote(tx, taskId, `A staff reply was not emailed: ${res.reason === 'no_email' ? 'the contact has no email address' : 'the contact no longer has access to this request'}.`, { staff_email: res.reason }));
      }
    }
  }
  return sent;
}

async function stallPass(now: Date): Promise<{ stalled: number; email_failed: number }> {
  let stalled = 0;
  let emailFailed = 0;
  await expireStaleJobs(now);
  const cutoff = new Date(now.getTime() - STALL_MS);
  const open = await prisma.chatConversation.findMany({ where: { state: { in: ['clarifying', 'confirming'] }, mode: 'model' }, take: 200 });
  for (const c of open) {
    const jobs = await prisma.engineJob.count({ where: { conversation_id: c.id, status: { in: ['queued', 'claimed'] } } });
    if (jobs > 0) continue;
    const latest = await prisma.comment.findFirst({ where: { task_id: c.task_id, ...visibleCommentWhere }, orderBy: { created_at: 'desc' }, select: { author_contact_id: true, created_at: true } });
    if (!latest?.author_contact_id || latest.created_at > cutoff) continue;
    const r = await handOff(c.id, { reason: 'unclear', draft: '', say: CANNED_LINE, now });
    if (!r.already) stalled++;
  }

  // A client's email must never be dropped: its job expired or failed, so a person reads it.
  const since = new Date(now.getTime() - EMAIL_JOB_WINDOW_MS);
  const dead = await prisma.engineJob.findMany({
    where: { type: 'chat_email_reply', status: { in: ['expired', 'failed'] }, queued_at: { gte: since }, conversation_id: { not: null } },
    select: { id: true, conversation_id: true, contact_id: true, queued_at: true },
  });
  for (const j of dead) {
    const c = await prisma.chatConversation.findUnique({ where: { id: j.conversation_id! } });
    if (!c || ['with_person', 'closed'].includes(c.state)) continue;
    const answered = await prisma.comment.count({ where: { task_id: c.task_id, created_at: { gt: j.queued_at }, is_deleted: false, is_internal: false, author_contact_id: null, client_visible: true } });
    if (answered > 0) continue;
    const r = await handOff(c.id, { reason: 'unclear', draft: '', say: CANNED_LINE, now });
    if (!r.already) {
      emailFailed++;
      if (j.contact_id) await emailFixedLine({ conversationId: c.id, contactId: j.contact_id, text: CANNED_LINE, key: `job:${j.id}`, now });
    }
  }
  return { stalled, email_failed: emailFailed };
}

async function closeQuestionChats(now: Date): Promise<number> {
  const rows = await prisma.chatConversation.findMany({
    where: { state: { in: ['clarifying', 'filed'] }, task: { tags: { has: 'chat-question' } } },
    include: { task: { select: { id: true, tags: true, status: true } } },
    take: 200,
  });
  let closed = 0;
  for (const c of rows) {
    const at = readSlots(c.slots).question_closed_at;
    if (!at || now.getTime() - new Date(at).getTime() < QUESTION_CLOSE_MS) continue;
    const newer = await prisma.comment.count({ where: { task_id: c.task_id, author_contact_id: { not: null }, created_at: { gt: new Date(at) }, is_deleted: false } });
    if (newer > 0) continue;
    await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`portal-chat-convo:${c.id}`}))`;
      const tags = c.task.tags.filter((t) => !['chat-clarifying', 'awaiting-clarification'].includes(t));
      await tx.task.update({ where: { id: c.task_id }, data: { status: 'done', completed_at: now, tags } });
      await tx.chatConversation.update({ where: { id: c.id }, data: { state: 'closed', open_ask: Prisma.DbNull } });
    });
    closed++;
  }
  return closed;
}

/** Close the "awaiting the client" clock where the client has written since it opened. */
async function reconcileWaits(now: Date): Promise<number> {
  const waits = await prisma.wait.findMany({
    where: { template_key: 'portal.awaiting_client', state: { in: [...OPEN_STATES] }, task: { chat_conversation: { isNot: null } } },
    select: { id: true, task_id: true, created_at: true },
    take: 200,
  });
  let n = 0;
  for (const w of waits) {
    if (!w.task_id) continue;
    const answered = await prisma.comment.count({ where: { task_id: w.task_id, author_contact_id: { not: null }, created_at: { gt: w.created_at }, is_deleted: false } });
    if (answered > 0) n += await onChatClientAnswered(prisma, w.task_id, now);
  }
  return n;
}

export async function runSweep(now: Date = new Date()): Promise<SweepResult> {
  const stalls = await stallPass(now);
  const waits_closed = await reconcileWaits(now);
  const away = await awayPass(now);
  const staff = await staffPass(now);
  const closed = await closeQuestionChats(now);
  return { away, staff, stalled: stalls.stalled, email_failed: stalls.email_failed, closed, waits_closed };
}

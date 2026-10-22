/**
 * The chat's email leg (phase C spec 7.2, 7.3; slice C4).
 *
 * Every message here is an `EmailOutbox` row of kind `portal_chat`, sent by the bast@ drain as
 * "Indelible Support", with `Reply-To: bast+c-{token}@becomeindelible.com` so the client's answer
 * comes back to the chat. Three kinds of email:
 *
 *  - the away email: Bast's own open question (or the summary awaiting a yes), one per question,
 *    deterministic, no model runs and there are no reminders;
 *  - Bast's reply to an email the client sent (the `chat_email_reply` job result);
 *  - a staff reply on the task while the client is away.
 *
 * The model's part (a question, a reply) was gated when it was applied. This module appends only
 * fixed template lines after that, so the frame can carry a link, a reference and numbers that the
 * copy gate would reject in model text. The frame is standalone (writing standard 4b): it names the
 * request and what the reader can do in its first lines.
 */
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { contactCanOpen, workPageUrl, type ContactRow } from '@/lib/portal/notices';
import { readAsk, readSlots, resolveChoices, type Choice } from '@/lib/portal/chat/slots';

export const AWAY_SILENCE_MS = 10 * 60_000;
export const AWAY_HIDDEN_MS = 3 * 60_000;
export const WATCHING_MS = 2 * 60_000;
export const STAFF_HOLD_MS = 120_000;
export const BAST_ACCOUNT = 'bast@becomeindelible.com';
export const OUTBOX_KIND = 'portal_chat';

export const chatReplyTo = (token: string) => `bast+c-${token}@becomeindelible.com`;
export const chatRef = (token: string) => `IC-${token.slice(0, 6).toUpperCase()}`;

const firstNameOf = (name: string | null | undefined) => (name ?? '').trim().split(/\s+/)[0] || 'there';
const hostOf = (url: string | null | undefined) => {
  try {
    return url ? new URL(url).hostname.replace(/^www\./, '') : null;
  } catch {
    return null;
  }
};
const oneLine = (s: string) => s.replace(/\s+/g, ' ').trim();

export interface FrameInput {
  firstName: string;
  clientTitle: string;
  domain: string | null;
  workUrl: string;
  token: string;
}

const signature = (f: FrameInput) => ['Indelible Support', `Ref: ${chatRef(f.token)}`];

/** Choices as a numbered list. "Another page" cannot be answered by email, so it is left out. */
export function numberedChoices(choices: Array<Pick<Choice, 'label'>>): string[] {
  return choices.map((c, i) => `${i + 1}. ${oneLine(c.label)}`);
}

export interface AwayInput extends FrameInput {
  question: string;
  choices: Array<Pick<Choice, 'label'>>;
  /** Set when a summary is waiting for a yes instead of a question. */
  summary?: string | null;
  /** The client's own last message, quoted so the email stands alone (writing standard 4b). */
  clientLast?: string | null;
}

const CLIENT_QUOTE_MAX = 400;
const requestLine = (f: FrameInput) => `"${f.clientTitle}"${f.domain ? ` (${f.domain})` : ''}`;

/** The client's words, quoted on one line and cut at a readable length. */
export function quoteClient(text: string | null | undefined): string | null {
  const t = oneLine(text ?? '');
  if (!t) return null;
  return `"${t.length > CLIENT_QUOTE_MAX ? `${t.slice(0, CLIENT_QUOTE_MAX).trimEnd()}...` : t}"`;
}

/** The answer line: "the number" only when there are numbered choices to pick from. */
export const answerLine = (hasChoices: boolean) =>
  hasChoices ? 'Reply with the number, or answer in the portal:' : 'Reply to this email with your answer, or answer in the portal:';

/**
 * The away email (spec 7.3, amended 2026-10-21). It goes only for a request blocked on the client
 * (`awayEmailEligible`). It stands alone: the request by name, the client's own last message, then
 * the assistant's exact question (or the summary waiting for a yes). Only the question and the summary
 * are model text, and both were gated when they were applied; the rest is this fixed frame and the
 * client's own words.
 */
export function buildAwayBody(i: AwayInput): string {
  const quoted = quoteClient(i.clientLast);
  const wrote = quoted ? ['You wrote:', quoted, ''] : [];
  const head = i.summary
    ? [
        `Your request ${requestLine(i)} is written up and needs your check before it goes to the team.`,
        '',
        ...wrote,
        'Here is the request as we have it:',
        i.summary.trim(),
        '',
        "Reply 'send' to send it to the team as written, or tell us what to change. You can also answer in the portal:",
      ]
    : [
        `Your request ${requestLine(i)} needs one answer before the team can pick it up.`,
        '',
        ...wrote,
        'Our question:',
        i.question.trim(),
        ...(i.choices.length ? ['', ...numberedChoices(i.choices)] : []),
        '',
        answerLine(i.choices.length > 0),
      ];
  return [`Hi ${i.firstName},`, '', ...head, i.workUrl, '', ...signature(i)].join('\n');
}

export interface ReplyInput extends FrameInput {
  reply: string;
  sources: Array<{ label: string }>;
  question?: string | null;
  choices?: Array<Pick<Choice, 'label'>>;
  summary?: string | null;
}

/** Bast's reply to an email from the client: its words in place of the first lines, source lines under any number. */
export function buildReplyBody(i: ReplyInput): string {
  const lines = [`Hi ${i.firstName},`, '', i.reply.trim()];
  for (const s of i.sources) lines.push('', `Source: ${s.label}`);
  const asked = i.question && !oneLine(i.reply).includes(oneLine(i.question)) ? i.question.trim() : null;
  if (asked) lines.push('', asked);
  if (i.choices?.length) lines.push('', ...numberedChoices(i.choices));
  if (i.summary) lines.push('', i.summary.trim(), '', "Reply 'send' to send it to the team as written, or tell us what to change.");
  const open = Boolean(asked || i.choices?.length || i.summary);
  lines.push('', open ? answerLine(Boolean(i.choices?.length)) : 'If you need anything else, reply to this email or open the portal:', i.workUrl, '', ...signature(i));
  return lines.join('\n');
}

const STAFF_MAX_CHARS = 1500;

/** A staff reply while the client is away; several replies in one burst read as paragraphs. */
export function buildStaffBody(i: FrameInput & { replies: string[] }): string {
  const joined = i.replies.map((r) => r.trim()).filter(Boolean).join('\n\n');
  const cut = joined.length > STAFF_MAX_CHARS;
  const text = cut ? `${joined.slice(0, STAFF_MAX_CHARS).trimEnd()}\n\nRead the rest in your portal.` : joined;
  return [
    `Hi ${i.firstName},`,
    '',
    `There is a new reply from the team on your request "${i.clientTitle}"${i.domain ? ` (${i.domain})` : ''}:`,
    '',
    text,
    '',
    'Reply to this email, or answer in the portal:',
    i.workUrl,
    '',
    ...signature(i),
  ].join('\n');
}

export type Db = Prisma.TransactionClient | typeof prisma;

interface ConvoRow {
  id: string;
  task_id: string;
  client_id: string;
  site_id: string | null;
  email_token: string;
  gmail_thread_id: string | null;
  last_outbound_gmail_id: string | null;
}

/** Is the client in the portal right now? A visible, recently seen tab. */
export function clientIsWatching(c: { last_seen_at: Date | null; page_hidden_at: Date | null }, now: Date): boolean {
  return Boolean(c.last_seen_at && !c.page_hidden_at && now.getTime() - c.last_seen_at.getTime() < WATCHING_MS);
}

export async function frameFor(db: Db, convo: ConvoRow, contact: { name: string | null }, taskId: string = convo.task_id): Promise<FrameInput> {
  const task = await db.task.findUnique({ where: { id: taskId }, select: { title: true, client_title: true, site: { select: { url: true } } } });
  const site = task?.site ?? (convo.site_id ? await db.site.findUnique({ where: { id: convo.site_id }, select: { url: true } }) : null);
  return {
    firstName: firstNameOf(contact.name),
    clientTitle: oneLine(task?.client_title ?? task?.title ?? 'your request').slice(0, 200),
    domain: hostOf(site?.url),
    workUrl: workPageUrl(taskId),
    token: convo.email_token,
  };
}

const BASE_SUBJECT = (title: string) => `One question about your request: ${title}`.slice(0, 480);
const FIRST_SUBJECT = { away: BASE_SUBJECT, confirm: (t: string) => `Check your request before it goes to the team: ${t}`.slice(0, 480), reply: (t: string) => `Your request: ${t}`.slice(0, 480), staff: (t: string) => `New reply on your request: ${t}`.slice(0, 480) };

/** The thread's subject: the first chat email's subject with "Re: ", so every message lands in one Gmail thread. */
async function subjectFor(db: Db, convo: ConvoRow, kind: keyof typeof FIRST_SUBJECT, clientTitle: string): Promise<string> {
  const first = await db.emailOutbox.findFirst({ where: { kind: OUTBOX_KIND, task_id: convo.task_id }, orderBy: { created_at: 'asc' }, select: { subject: true } });
  if (first) return `Re: ${first.subject.replace(/^(re:\s*)+/i, '')}`.slice(0, 500);
  return FIRST_SUBJECT[kind](clientTitle);
}

export type QueueResult = { queued: true; id: string } | { queued: false; reason: 'no_email' | 'no_access' | 'duplicate' };

/**
 * Queue one chat email to a contact. `allow_external` is set only when `to` is the contact's own
 * address AND the contact can open the task (the drain's claim checks both again).
 */
export async function queueChatEmail(
  db: Db,
  input: { convo: ConvoRow; contact: ContactRow; kind: keyof typeof FIRST_SUBJECT; clientTitle: string; text: string; dedupeKey: string }
): Promise<QueueResult> {
  const to = input.contact.email?.trim();
  if (!to) return { queued: false, reason: 'no_email' };
  const task = await db.task.findUnique({ where: { id: input.convo.task_id }, select: { id: true, client_id: true } });
  if (!task || !(await contactCanOpen(db, input.contact, task))) return { queued: false, reason: 'no_access' };
  const dup = await db.emailOutbox.findUnique({ where: { dedupe_key: input.dedupeKey }, select: { id: true } });
  if (dup) return { queued: false, reason: 'duplicate' };
  const subject = await subjectFor(db, input.convo, input.kind, input.clientTitle);
  const row = await db.emailOutbox.create({
    data: {
      to,
      subject,
      text: input.text,
      from_account: BAST_ACCOUNT,
      kind: OUTBOX_KIND,
      allow_external: true,
      reply_to: chatReplyTo(input.convo.email_token),
      reply_to_gmail_id: input.convo.last_outbound_gmail_id,
      dedupe_key: input.dedupeKey.slice(0, 128),
      task_id: input.convo.task_id,
    },
    select: { id: true },
  });
  return { queued: true, id: row.id };
}

export const awayKey = (conversationId: string, commentId: string) => `chat:${conversationId}:${commentId}`;

/** The choice labels of a conversation's open ask, for the email (rendered from the database, like the portal). */
export async function openAskForEmail(convo: { id: string; client_id: string; site_id: string | null; slots: unknown; open_ask: unknown }) {
  const ask = readAsk(convo.open_ask);
  if (!ask) return null;
  const { choices } = await resolveChoices(convo, readSlots(convo.slots), ask.slot, ask.choice_ids);
  return { question: ask.question, choices: choices.filter((c) => c.id !== 'another_page') };
}

export async function loadContactRow(db: Db, contactId: string): Promise<ContactRow | null> {
  const c = await db.clientContact.findUnique({ where: { id: contactId }, select: { id: true, name: true, email: true, client_id: true, portal_role: true, is_deleted: true } });
  return (c as ContactRow | null) ?? null;
}

/**
 * Bast's reply to an email the client sent (a `chat_email_reply` result): in the thread, from
 * bast@, unless the client is in the portal at this moment. Marks the reply as the one the client
 * was told about, so the walk-away sweep never sends the same question again.
 */
export async function emailAssistantReply(input: { conversationId: string; commentId: string; contactId: string; now?: Date; textOverride?: string }): Promise<QueueResult | { queued: false; reason: 'watching' | 'gone' }> {
  const now = input.now ?? new Date();
  const convo = await prisma.chatConversation.findUnique({ where: { id: input.conversationId } });
  const comment = await prisma.comment.findUnique({ where: { id: input.commentId }, select: { id: true, content: true, chat_meta: true, task_id: true } });
  const contact = await loadContactRow(prisma, input.contactId);
  if (!convo || !comment || comment.task_id !== convo.task_id || !contact) return { queued: false, reason: 'gone' };
  if (clientIsWatching(convo, now)) return { queued: false, reason: 'watching' };
  const frame = await frameFor(prisma, convo, contact);
  const meta = (comment.chat_meta ?? {}) as { sources?: Array<{ label?: string }> };
  const asked = await openAskForEmail(convo);
  const slots = readSlots(convo.slots);
  const summary = convo.state === 'confirming' ? convo.summary_text ?? slots.summary?.text ?? null : null;
  const text = buildReplyBody({
    ...frame,
    reply: input.textOverride ?? comment.content,
    sources: (meta.sources ?? []).filter((s): s is { label: string } => typeof s.label === 'string' && s.label.length > 0),
    question: asked?.question,
    choices: asked?.choices,
    summary,
  });
  const res = await queueChatEmail(prisma, { convo, contact, kind: 'reply', clientTitle: frame.clientTitle, text, dedupeKey: awayKey(convo.id, comment.id) });
  if (res.queued || res.reason === 'duplicate') {
    await prisma.chatConversation.update({ where: { id: convo.id }, data: { away_sent_for_comment_id: comment.id } });
  }
  return res;
}

/** A fixed line (for example the canned hand-off line) to a client who wrote by email, in the thread. */
export async function emailFixedLine(input: { conversationId: string; contactId: string; text: string; key: string; now?: Date }): Promise<QueueResult | { queued: false; reason: 'gone' }> {
  const convo = await prisma.chatConversation.findUnique({ where: { id: input.conversationId } });
  const contact = await loadContactRow(prisma, input.contactId);
  if (!convo || !contact) return { queued: false, reason: 'gone' };
  const frame = await frameFor(prisma, convo, contact);
  const text = buildReplyBody({ ...frame, reply: input.text, sources: [] });
  return queueChatEmail(prisma, { convo, contact, kind: 'reply', clientTitle: frame.clientTitle, text, dedupeKey: `chatfixed:${convo.id}:${input.key}` });
}

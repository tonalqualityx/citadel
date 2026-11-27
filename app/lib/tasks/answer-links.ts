/**
 * Signed one-time answer links for card questions (project "Reports for Mike", task 2; Mike, 2026-11-25: "My tap is still my answer, even if I
 * don't type words."). A report page on reports.becomeindelible.com is static files, so the tap has to land in Citadel itself.
 *
 *   mintAnswerLinks   POST /api/tasks/:id/questions/:qid/links   one link per option, plus a "talk it through" link, minted together as a batch
 *   inspectAnswerLink GET  /api/question-links/:token            reads only: is the link still good, and what would it record
 *   redeemAnswerLink     POST /api/question-links/:token            records it: the option as Mike's answer, or the question held for a chat
 *
 * The URL token is `<link id>.<HMAC-SHA256 of the id>`, keyed from the server secret, so an altered link matches nothing and a link can only come
 * from Citadel. Each row is single use; answering with any link of a batch spends the rest of that batch. A link answers only the wording the report
 * showed (a hash of the question and its options is kept at mint), and only questions for Mike (never a question we sent a client) can be minted.
 *
 * One exception to single use: while the answer on the question is still the one a tap from this batch recorded, another option link of the same
 * batch changes it (Mike answers big reports over several sittings and may change his mind; task 0c524c21: "a changed answer gets its own toast
 * line"). An answer given on the card or in the chat, or from another report, is never changed from a report.
 *
 * An option link records the option as Mike's answer, through the same steps as his own answer on the card: the answer fields, an internal
 * comment ("From Mike, <date>: \"tapped <option> on the report page\" (<report link>)"), the held-for-questions hold lifted when it was the last
 * open question, the asker told, and the cards the question blocked released. The "talk it through" link never answers and never defaults: it
 * marks the question held for a chat and makes it wait (if_nobody_action = wait, no go-ahead date), so neither the go-ahead sweep nor a Triage
 * release lets the recommendation go ahead on its own.
 */
import { createHash, createHmac, randomUUID, timingSafeEqual } from 'crypto';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { ApiError } from '@/lib/api/errors';
import type { AuthPayload } from '@/lib/auth/middleware';
import { BAST_USER_ID, BOT_USER_IDS, MIKE_USER_ID } from '@/lib/oracle/projects/gate-constants';
import { createNotification } from '@/lib/services/notifications';
import { releaseQuestionDependents } from '@/lib/services/dependencies';
import { flagAnswerForDox } from '@/lib/dox/ask';
import { recordTriageChange } from './triage-rev';
import { HELD_ANSWER_PREFIX, assertCanRead, mayAnswerQuestions, releaseHoldIfLast } from './questions';
import { citationDate, optionOf, sourcedAnswerComment, type QuestionOption } from './question-context';

type Auth = Pick<AuthPayload, 'userId' | 'role' | 'via' | 'lane' | 'laneEnforced'>;
type TaskHead = { id: string; status: string; tags: string[] };

export const LINK_DAYS_DEFAULT = 30;
export const LINK_DAYS_MAX = 90;
export const TALK_LABEL = 'Talk it through';

export const mintLinksSchema = z
  .object({
    report_url: z
      .string({ error: 'report_url is required: the report page the buttons sit on.' })
      .trim()
      .max(500)
      .url('report_url must be a full https link.')
      .refine((u) => u.startsWith('https://'), 'report_url must be a full https link.'),
    expires_in_days: z.number().int().min(1).max(LINK_DAYS_MAX).optional(),
  })
  .strict();
export type MintLinksBody = z.infer<typeof mintLinksSchema>;

// ---------------------------------------------------------------------------------------------------------------------------------------------
// Signing

function linkKey(): Buffer {
  const secret = process.env.QUESTION_LINK_SECRET || process.env.JWT_SECRET;
  if (!secret) throw new ApiError('Answer links are not set up on this server.', 500, 'link_secret_missing');
  // A key of its own, derived from the server secret, so a link signature is never usable as anything else.
  return createHmac('sha256', secret).update('citadel:question-answer-link:v1').digest();
}

function sign(id: string): string {
  return createHmac('sha256', linkKey()).update(id).digest('base64url');
}

const TOKEN_RE = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.([A-Za-z0-9_-]{43})$/;

export function tokenFor(id: string): string {
  return `${id}.${sign(id)}`;
}

/** The link id a token carries, or null when the token is malformed or its signature does not match (an altered link). */
export function verifyToken(token: string): string | null {
  const m = TOKEN_RE.exec(token);
  if (!m) return null;
  const want = Buffer.from(sign(m[1]));
  const got = Buffer.from(m[2]);
  if (want.length !== got.length || !timingSafeEqual(want, got)) return null;
  return m[1];
}

/** The wording a link answers: the question and its options. A change to either makes the link record nothing. */
export function wordingHash(q: { question: string; options: unknown }): string {
  return createHash('sha256').update(JSON.stringify([q.question, q.options ?? null])).digest('hex');
}

// ---------------------------------------------------------------------------------------------------------------------------------------------
// Minting

/** Mike, the chat lane or the front session (the people who may answer), or Bast's own worker key (the report tool). Never Dox or another lane. */
export function mayMintLinks(auth: Auth): boolean {
  if (mayAnswerQuestions(auth)) return true;
  return auth.userId === BAST_USER_ID && (!auth.lane || auth.lane === 'bast');
}

export interface MintedLinks {
  question_id: string;
  question: string;
  report_url: string;
  expires_at: string;
  options: Array<{ option_id: string; label: string; recommended: boolean; url: string }>;
  talk_it_through: { label: string; url: string };
}

export async function mintAnswerLinks(task: TaskHead, qid: string, auth: Auth, body: MintLinksBody, baseUrl: string, now: Date = new Date()): Promise<MintedLinks> {
  if (!mayMintLinks(auth)) throw new ApiError('Only Mike, the chat, the front session or the worker mint answer links.', 403, 'mint_not_allowed');
  await assertCanRead(task, auth);
  if (!/^[0-9a-f-]{36}$/i.test(qid)) throw new ApiError('Question not found', 404);
  const row = await prisma.taskQuestion.findFirst({ where: { id: qid, task_id: task.id } });
  if (!row) throw new ApiError('Question not found', 404);
  if (row.asked_of_contact_id) throw new ApiError('That question is for a client, so its answer is not Mike\'s to tap.', 422, 'not_mikes_question');
  if (row.state !== 'open') throw new ApiError('Only an open question gets answer links.', 409, 'not_open');
  linkKey(); // fail before writing anything when the server has no secret
  const options = (Array.isArray(row.options) ? row.options : []) as QuestionOption[];
  const expires = new Date(now.getTime() + (body.expires_in_days ?? LINK_DAYS_DEFAULT) * 86_400_000);
  const batch = randomUUID();
  const hash = wordingHash(row);
  const base = { question_id: row.id, batch_id: batch, report_url: body.report_url, wording_hash: hash, expires_at: expires, minted_by_id: auth.userId };
  const optionRows = options.map((o) => ({ ...base, id: randomUUID(), kind: 'option', option_id: o.id }));
  const holdRow = { ...base, id: randomUUID(), kind: 'hold', option_id: null };
  await prisma.questionAnswerLink.createMany({ data: [...optionRows, holdRow] });
  const root = baseUrl.replace(/\/+$/, '');
  const url = (id: string) => `${root}/api/question-links/${tokenFor(id)}`;
  return {
    question_id: row.id,
    question: row.question,
    report_url: body.report_url,
    expires_at: expires.toISOString(),
    options: options.map((o, i) => ({ option_id: o.id, label: o.label, recommended: o.id === row.recommended_option_id, url: url(optionRows[i].id) })),
    talk_it_through: { label: TALK_LABEL, url: url(holdRow.id) },
  };
}

// ---------------------------------------------------------------------------------------------------------------------------------------------
// Using

export type LinkCode =
  | 'ready'
  | 'answered'
  | 'held'
  | 'altered'
  | 'used'
  | 'expired'
  | 'withdrawn'
  | 'already_answered'
  | 'already_defaulted'
  | 'changed'
  | 'reanswered'
  | 'foreign_origin';

export interface LinkOutcome {
  ok: boolean;
  code: LinkCode;
  /** HTTP status the routes answer with. */
  status: number;
  title: string;
  message: string;
  question?: string;
  /** What the link records (inspect) or recorded (use): the option label, or "Talk it through". */
  label?: string;
  task_id?: string;
  released_task_ids?: string[];
  /** Whether this link's choice is the question's current state: its option is the answer, or (talk it through) the question is held for a chat.
   *  The report page reads it so a reopened report shows the earlier answer as picked. */
  selected?: boolean;
  /** The report page the link was minted for, so the plain-link page can lead back to it. */
  report_url?: string;
}

const NOTHING = 'Nothing was recorded.';

function refused(code: LinkCode, status: number, title: string, message: string, extra: Partial<LinkOutcome> = {}): LinkOutcome {
  return { ok: false, code, status, title, message, ...extra };
}

const ALTERED = refused('altered', 400, 'This link is not valid', `The link does not match one Citadel made. ${NOTHING}`);

type LinkRow = NonNullable<Awaited<ReturnType<typeof loadLink>>>;

async function loadLink(id: string) {
  return prisma.questionAnswerLink.findUnique({
    where: { id },
    include: { question: { include: { task: { select: { id: true, is_deleted: true } } } } },
  });
}

function labelOf(link: { kind: string; option_id: string | null }, options: unknown): string | null {
  if (link.kind === 'hold') return TALK_LABEL;
  const opt = optionOf(options, link.option_id);
  return opt ? opt.label : null;
}

type QuestionState = { state: string; answer_option_id: string | null; held_for_chat_at: Date | null };

/** Whether the link's choice is what the question holds now: the answered option, or the hold while the question is still open. */
export function isSelected(link: { kind: string; option_id: string | null }, q: QuestionState): boolean {
  if (link.kind === 'hold') return q.state === 'open' && q.held_for_chat_at !== null;
  return q.state === 'answered' && link.option_id !== null && q.answer_option_id === link.option_id;
}

function withState(o: LinkOutcome, link: { kind: string; option_id: string | null; report_url: string }, q: QuestionState): LinkOutcome {
  return { ...o, selected: isSelected(link, q), report_url: link.report_url };
}

type Db = Pick<typeof prisma, 'questionAnswerLink'>;

/**
 * Whether this option link may change the answer: the question is answered, the answer is still the one a link of this same batch recorded (its
 * use time is the answer time, so an answer given later on the card or in the chat breaks the match), and this link names a different option.
 */
export async function mayChangeAnswer(db: Db, link: { batch_id: string; kind: string; option_id: string | null }, q: { state: string; answer_option_id: string | null; answered_at: Date | null }): Promise<boolean> {
  if (link.kind !== 'option' || !link.option_id || q.state !== 'answered' || !q.answer_option_id || !q.answered_at) return false;
  if (link.option_id === q.answer_option_id) return false;
  const owner = await db.questionAnswerLink.findFirst({
    where: { batch_id: link.batch_id, kind: 'option', option_id: q.answer_option_id, used_at: q.answered_at, used_outcome: { in: ['answered', 'reanswered'] } },
    select: { id: true },
  });
  return owner !== null;
}

/** Every refusal that can be read without writing, in the order a person would want to hear it. Null when the link would record. */
function refusalOf(link: LinkRow, q: LinkRow['question'], now: Date, changeable = false): LinkOutcome | null {
  const extra = { question: q.question, task_id: q.task_id ?? undefined };
  if (!q.task || q.task.is_deleted) return ALTERED;
  if (link.used_at && !changeable) {
    const now_ = q.state === 'answered' && q.answer_text ? ` The answer on the card is: ${q.answer_text}.` : q.held_for_chat_at ? ' The question is held for a chat.' : '';
    return refused('used', 410, 'This link was already used', `Each button works once.${now_} ${NOTHING}`, extra);
  }
  if (link.expires_at.getTime() <= now.getTime()) return refused('expired', 410, 'This link has expired', `${NOTHING} Answer on the card or in the chat instead.`, extra);
  if (q.state === 'withdrawn') return refused('withdrawn', 409, 'That question was withdrawn', `It no longer needs an answer. ${NOTHING}`, extra);
  if (q.state === 'answered' && !changeable) return refused('already_answered', 409, 'That question is already answered', `The answer on the card is: ${q.answer_text ?? ''}. ${NOTHING}`, extra);
  if (link.kind === 'hold' && q.state === 'defaulted') {
    return refused('already_defaulted', 409, 'That question already went ahead', `Nobody answered in time, so the recommendation went ahead. ${NOTHING} Answer with a button or in the chat to change it.`, extra);
  }
  if (wordingHash(q) !== link.wording_hash || !labelOf(link, q.options)) {
    return refused('changed', 409, 'That question changed after the report was made', `${NOTHING} Read it again on the card or in the chat, then answer.`, extra);
  }
  return null;
}

/** Reads only (the GET page): whether the link is still good and what it would record. Opening it never records anything by itself. */
export async function inspectAnswerLink(token: string, now: Date = new Date()): Promise<LinkOutcome> {
  const id = verifyToken(token);
  if (!id) return ALTERED;
  const link = await loadLink(id);
  if (!link) return ALTERED;
  const change = await mayChangeAnswer(prisma, link, link.question);
  const no = refusalOf(link, link.question, now, change);
  if (no) return no === ALTERED ? no : withState(no, link, link.question);
  const label = labelOf(link, link.question.options)!;
  const title = link.kind === 'hold' ? 'Holding this for a chat' : change ? `Changing your answer to: ${label}` : `Recording your answer: ${label}`;
  return withState(
    { ok: true, code: 'ready', status: 200, title, message: '', question: link.question.question, label, task_id: link.question.task_id ?? undefined },
    link,
    link.question,
  );
}

/** Records the link: the option as Mike's answer, or the question held for a chat. Single use, atomic with the answer itself. */
export async function redeemAnswerLink(token: string, now: Date = new Date()): Promise<LinkOutcome> {
  const id = verifyToken(token);
  if (!id) return ALTERED;
  const first = await loadLink(id);
  if (!first) return ALTERED;
  const taskId = first.question.task_id;
  if (!taskId) return ALTERED;
  const early = refusalOf(first, first.question, now, await mayChangeAnswer(prisma, first, first.question));
  if (early) return early === ALTERED ? early : withState(early, first, first.question);

  const out = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM tasks WHERE id = ${taskId}::uuid FOR UPDATE`;
    // Read again under the lock: a second tap, an edit or an answer may have landed since.
    const link = await tx.questionAnswerLink.findUnique({ where: { id }, include: { question: { include: { task: { select: { id: true, is_deleted: true } } } } } });
    if (!link) return { outcome: ALTERED };
    const q = link.question;
    const change = await mayChangeAnswer(tx, link, q);
    const no = refusalOf(link, q, now, change);
    if (no) return { outcome: no === ALTERED ? no : withState(no, link, q) };
    const date = citationDate(now);

    if (change) {
      // A changed answer: this link becomes the one that holds the answer; the batch stays spent otherwise.
      const was = q.answer_text ?? '';
      const opt = optionOf(q.options, link.option_id)!;
      await tx.questionAnswerLink.update({ where: { id }, data: { used_at: now, used_outcome: 'reanswered' } });
      const sourced = sourcedAnswerComment(q.question, opt.label, { who: 'Mike', said: `changed the answer from ${was} to ${opt.label} on the report page`, at: date, url: link.report_url });
      const othersWaiting = await tx.taskQuestion.count({ where: { task_id: taskId, state: 'open', if_nobody_action: 'wait', id: { not: q.id } } });
      const quiet = othersWaiting > 0;
      const comment = await tx.comment.create({
        data: {
          task_id: taskId,
          user_id: quiet ? BAST_USER_ID : MIKE_USER_ID,
          content: quiet ? `${HELD_ANSWER_PREFIX}${sourced}` : sourced,
          mentioned_user_ids: [],
          is_internal: true,
          client_visible: false,
          client_question: false,
          chat_meta: { question: { id: q.id } },
        },
        select: { id: true },
      });
      await tx.taskQuestion.update({
        where: { id: q.id },
        data: { answer_option_id: opt.id, answer_text: opt.label, answered_at: now, answered_by_id: MIKE_USER_ID, answer_comment_id: comment.id },
      });
      await recordTriageChange(tx, taskId, 'question', 'Answer changed by Mike (report page)', { userId: MIKE_USER_ID, lane: null, by: 'Mike' });
      return {
        outcome: { ok: true, code: 'reanswered' as const, status: 200, title: `Changed: ${opt.label}`, message: `Your answer is now ${opt.label}. It was ${was}.`, question: q.question, label: opt.label, task_id: taskId, selected: true, report_url: link.report_url },
        answered: { questionId: q.id, askerId: q.asked_by_user_id, askerLane: q.asked_by_lane, question: q.question },
        changed: true,
      };
    }

    const claimed = await tx.questionAnswerLink.updateMany({ where: { id, used_at: null }, data: { used_at: now, used_outcome: link.kind === 'hold' ? 'held' : 'answered' } });
    if (claimed.count !== 1) return { outcome: refused('used', 410, 'This link was already used', `Each button works once. ${NOTHING}`, { question: q.question, task_id: taskId }) };

    if (link.kind === 'hold') {
      await tx.taskQuestion.update({ where: { id: q.id }, data: { held_for_chat_at: now, held_report_url: link.report_url, if_nobody_action: 'wait', default_at: null } });
      // Written as Bast: a hold is not an answer, so it must not wake the worker as a human reply would.
      await tx.comment.create({
        data: {
          task_id: taskId,
          user_id: BAST_USER_ID,
          content: `Mike tapped "${TALK_LABEL}" on the report page (${link.report_url}) on ${date}. "${q.question}" waits for a chat with him and will not go ahead on its own.`,
          mentioned_user_ids: [],
          is_internal: true,
          client_visible: false,
          client_question: false,
          chat_meta: { question: { id: q.id } },
        },
      });
      await recordTriageChange(tx, taskId, 'question', 'Question held for a chat by Mike (report page)', { userId: MIKE_USER_ID, lane: null, by: 'Mike' });
      return { outcome: { ok: true, code: 'held' as const, status: 200, title: 'Held for a chat', message: 'This question will wait for a conversation with you. It will not go ahead on its own.', question: q.question, label: TALK_LABEL, task_id: taskId, selected: true, report_url: link.report_url } };
    }

    const opt = optionOf(q.options, link.option_id)!;
    // One answer spends the batch: the other buttons for this question stop working.
    await tx.questionAnswerLink.updateMany({ where: { batch_id: link.batch_id, id: { not: id }, used_at: null }, data: { used_at: now, used_outcome: 'spent' } });
    const words = opt.label;
    const sourced = sourcedAnswerComment(q.question, words, { who: 'Mike', said: `tapped ${opt.label} on the report page`, at: date, url: link.report_url });
    // Same rule as his answer on the card: while another `wait` question is open the card must not wake, so the note is written as Bast.
    const othersWaiting = await tx.taskQuestion.count({ where: { task_id: taskId, state: 'open', if_nobody_action: 'wait', id: { not: q.id } } });
    const quiet = othersWaiting > 0;
    const comment = await tx.comment.create({
      data: {
        task_id: taskId,
        user_id: quiet ? BAST_USER_ID : MIKE_USER_ID,
        content: quiet ? `${HELD_ANSWER_PREFIX}${sourced}` : sourced,
        mentioned_user_ids: [],
        is_internal: true,
        client_visible: false,
        client_question: false,
        chat_meta: { question: { id: q.id } },
      },
      select: { id: true },
    });
    await tx.taskQuestion.update({
      where: { id: q.id },
      data: { state: 'answered', answer_option_id: opt.id, answer_text: words, answered_at: now, answered_by_id: MIKE_USER_ID, answer_comment_id: comment.id, defaulted_at: null },
    });
    await releaseHoldIfLast(tx, taskId);
    await recordTriageChange(tx, taskId, 'question', 'Question answered by Mike (report page)', { userId: MIKE_USER_ID, lane: null, by: 'Mike' });
    return {
      outcome: { ok: true, code: 'answered' as const, status: 200, title: `Recorded: ${opt.label}`, message: 'Your answer is on the card, and the work waiting on it can go ahead.', question: q.question, label: opt.label, task_id: taskId, selected: true, report_url: link.report_url },
      answered: { questionId: q.id, askerId: q.asked_by_user_id, askerLane: q.asked_by_lane, question: q.question },
    };
  });

  if (!('answered' in out) || !out.answered) return out.outcome;
  const a = out.answered;
  if (a.askerId && a.askerId !== MIKE_USER_ID && !BOT_USER_IDS.includes(a.askerId)) {
    try {
      await createNotification({ userId: a.askerId, type: 'comment_added', title: 'changed' in out && out.changed ? 'Mike changed his answer' : 'Mike answered your question', message: a.question, entityType: 'task', entityId: taskId, actorUserId: MIKE_USER_ID });
    } catch {
      // the answer is saved; a missed notice is not a failed answer
    }
  }
  try {
    await flagAnswerForDox(prisma, taskId, { asked_by_user_id: a.askerId, asked_by_lane: a.askerLane }, { userId: MIKE_USER_ID, lane: null }, now);
  } catch {
    // the answer is saved; the scheduled Dox sweep still reads the card
  }
  // A changed answer released its cards the first time; Dox and the asker are told again so the work follows the new answer.
  if ('changed' in out && out.changed) return out.outcome;
  const released = await releaseQuestionDependents(a.questionId);
  return { ...out.outcome, released_task_ids: released };
}

// ---------------------------------------------------------------------------------------------------------------------------------------------
// Pages (plain HTML: the link is opened from a report page with no Citadel session)

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

function page(title: string, body: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><meta name="referrer" content="no-referrer"><title>${esc(title)}</title><style>
body{margin:0;font:18px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif;background:#f6f5f2;color:#1d1d1f}
main{max-width:34rem;margin:0 auto;padding:2.5rem 1.25rem}
.card{background:#fff;border-radius:14px;padding:1.5rem;border-left:6px solid var(--tone,#2f6f4f);box-shadow:0 1px 3px rgba(0,0,0,.08)}
h1{font-size:1.4rem;line-height:1.3;margin:0 0 .75rem}
p{margin:.5rem 0}.q{color:#555;font-size:1rem}
button{font:inherit;font-weight:600;padding:.8rem 1.4rem;border-radius:10px;border:0;background:#2f6f4f;color:#fff;cursor:pointer;width:100%;margin-top:1rem}
a.back{display:block;box-sizing:border-box;text-align:center;font-weight:600;padding:.8rem 1.4rem;border-radius:10px;border:2px solid #1d1d1f;color:#1d1d1f;text-decoration:none;margin-top:1rem}
</style></head><body><main>${body}</main></body></html>`;
}

/** A link back to the report the button sat on, only for an https report page. */
function backLink(reportUrl: string | undefined): string {
  if (!reportUrl || !/^https:\/\/[^\s"'<>]+$/.test(reportUrl)) return '';
  return `<a class="back" href="${esc(reportUrl)}">Back to the report</a>`;
}

/** The confirmation or refusal page for a used link (POST). */
export function outcomePage(o: LinkOutcome): string {
  const tone = o.ok ? (o.code === 'held' ? '#8a6d1f' : '#2f6f4f') : '#a33a2b';
  const q = o.question ? `<p class="q">Question: ${esc(o.question)}</p>` : '';
  return page(o.title, `<div class="card" style="--tone:${tone}"><h1>${esc(o.title)}</h1>${q}<p>${esc(o.message)}</p>${backLink(o.report_url)}</div>`);
}

/**
 * The page a GET shows. A link that would still record posts itself back at once (one tap from the report), so opening it in a browser records
 * the answer; a mail scanner or link preview that fetches the URL without running scripts records nothing. Without scripts the button does it.
 */
export function inspectPage(o: LinkOutcome, token: string): string {
  if (!o.ok) return outcomePage(o);
  const action = `/api/question-links/${esc(token)}`;
  const q = o.question ? `<p class="q">Question: ${esc(o.question)}</p>` : '';
  return page(
    o.title,
    `<div class="card"><h1>${esc(o.title)}</h1>${q}<form id="f" method="post" action="${action}"><button type="submit">${esc(o.label === TALK_LABEL ? 'Hold it for a chat' : `Record: ${o.label ?? ''}`)}</button></form></div><script>document.getElementById('f').submit()</script>`,
  );
}

export const LINK_PAGE_HEADERS = {
  'Content-Type': 'text/html; charset=utf-8',
  'Cache-Control': 'no-store',
  'Referrer-Policy': 'no-referrer',
  'X-Robots-Tag': 'noindex, nofollow',
} as const;

// ---------------------------------------------------------------------------------------------------------------------------------------------
// Calls from the report page itself (a tap answers in place; Mike, 2026-11-27: "Perhaps we should update the process so the buttons change to
// visually show my selection and a toast tab pops up?")

/** The one site whose pages may call these links from a script and read the answer. */
export const REPORTS_ORIGIN = 'https://reports.becomeindelible.com';

/** CORS headers for a call from the reports site; none for any other caller, so another site's script can never read the answer. */
export function corsHeadersFor(origin: string | null): Record<string, string> {
  const h: Record<string, string> = { Vary: 'Origin' };
  if (origin === REPORTS_ORIGIN) h['Access-Control-Allow-Origin'] = REPORTS_ORIGIN;
  return h;
}

/**
 * Whether a POST may record from where it came. The report site, Citadel itself (the plain-link page posts back to its own host), and a request
 * with no origin or the opaque "null" one (the plain-link page sends no referrer, so its form post carries Origin: null) may. A script or form on
 * any other site may not, even holding a good link.
 */
export function postOriginAllowed(origin: string | null, ownHosts: Array<string | null | undefined>): boolean {
  if (origin === null || origin === '' || origin === 'null' || origin === REPORTS_ORIGIN) return true;
  let host: string;
  try {
    host = new URL(origin).host;
  } catch {
    return false;
  }
  return ownHosts.some((h) => !!h && h.toLowerCase() === host.toLowerCase());
}

export const FOREIGN_ORIGIN: LinkOutcome = refused('foreign_origin', 403, 'This link cannot be used from that site', `Answer buttons work from the report page only. ${NOTHING}`);

/**
 * Card questions (operating model, Questions tab): the database side.
 *
 *   listQuestions    GET   a card's questions, each with a ready-made `citation` line when Mike answered it
 *   addQuestion      POST  one question, only with every Context part (question-context.ts); at most 10 open per card
 *   patchQuestion    PATCH change the Context, or withdraw, while the question is open
 *   answerQuestion   POST  Mike's answer, in ONE transaction: answer fields, an internal comment (this is what wakes a parked
 *                    worker task), the marker tag and `needs-mike` removed when it was the last open question, and the asker told
 *
 * Who may do what:
 *   read    while the card is in triage: Mike, the chat lane, bot keys, and a question's asker; everyone else gets a 404.
 *           After release: anyone who can see the task (contractors and designers still cannot see triage cards).
 *   answer  Mike's own signed-in session, or the enforced bast-chat lane relaying his words ("From Mike, through the chat: ").
 *           Nobody else. A `defaulted` question is never his words and never has a citation.
 *
 * The client portal never reads this table.
 */
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { ApiError } from '@/lib/api/errors';
import type { AuthPayload } from '@/lib/auth/middleware';
import { MIKE_USER_ID, BOT_USER_IDS } from '@/lib/oracle/projects/gate-constants';
import { mayLeaveTriage } from '@/lib/services/task-patch';
import { CHAT_LANE } from '@/lib/bast-chat/task-filter';
import { createNotification } from '@/lib/services/notifications';
import { CHAT_ANSWER_PREFIX } from './checklist-answers';
import {
  OPEN_QUESTIONS_MAX,
  answerComment,
  answerWords,
  citationLine,
  optionOf,
  questionContextSchema,
  type QuestionAnswerBody,
  type QuestionContext,
  type QuestionPatch,
} from './question-context';

/** Tags that tie a parked card to its open questions. Only `held-for-questions` is ours; removing `needs-mike` rides on it. */
export const HELD_TAG = 'held-for-questions';
export const NEEDS_MIKE_TAG = 'needs-mike';

export const QUESTION_MESSAGES = {
  notFound: 'Question not found',
  notYours: 'Only Mike answers these. Ask him, or have him answer on the card.',
  closed: 'That question is withdrawn.',
  notOpen: 'Only an open question can be changed.',
  tooMany: `A card holds at most ${OPEN_QUESTIONS_MAX} open questions. Ask the most important ones first.`,
  duplicate: 'That question is already on this card.',
  badOption: 'That is not one of the options.',
} as const;

type Auth = Pick<AuthPayload, 'userId' | 'role' | 'via' | 'lane' | 'laneEnforced'>;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isChatLane(auth: Auth): boolean {
  return auth.via === 'api_key' && auth.lane === CHAT_LANE && auth.laneEnforced === true;
}

/** Mike's own signed-in session, or the enforced chat lane relaying his words. The same rule as leaving triage. */
export function mayAnswerQuestions(auth: Auth): boolean {
  return mayLeaveTriage(auth);
}

type TaskHead = { id: string; status: string; tags: string[] };
type QuestionRow = Prisma.TaskQuestionGetPayload<object>;

/**
 * Who may read (and ask on) this card's questions. `checkTaskAccess` has already run, so a contractor who cannot see the task
 * is gone; this adds the question-specific rule. Throws a 404 (never a 403: a card in triage does not admit it exists).
 */
export async function assertCanRead(task: TaskHead, auth: Auth): Promise<void> {
  if (auth.role === 'designer' || (auth.role === 'tech' && task.status === 'triage')) throw new ApiError('Task not found', 404);
  if (task.status !== 'triage') return;
  if (auth.userId === MIKE_USER_ID || isChatLane(auth) || BOT_USER_IDS.includes(auth.userId)) return;
  const asked = await prisma.taskQuestion.findFirst({ where: { task_id: task.id, asked_by_user_id: auth.userId }, select: { id: true } });
  if (!asked) throw new ApiError('Task not found', 404);
}

/** Asking is open to any staff who can see the card (a pm or admin filing on a triage card becomes its asker, and reads it back). */
export function assertCanAsk(task: TaskHead, auth: Auth): void {
  if (auth.role === 'designer' || (auth.role === 'tech' && task.status === 'triage')) throw new ApiError('Task not found', 404);
}

function isOwnerish(auth: Auth, row: Pick<QuestionRow, 'asked_by_user_id'>): boolean {
  return auth.userId === MIKE_USER_ID || isChatLane(auth) || BOT_USER_IDS.includes(auth.userId) || row.asked_by_user_id === auth.userId;
}

export interface QuestionOut {
  id: string;
  task_id: string;
  position: number;
  question: string;
  what_it_is: string;
  sources: unknown;
  checked: string;
  unknown: string;
  options: unknown;
  recommended_option_id: string | null;
  recommend_why: string | null;
  if_nobody: string;
  if_nobody_action: 'go_with_recommendation' | 'wait';
  state: 'open' | 'answered' | 'defaulted' | 'withdrawn';
  asked_by_user_id: string | null;
  asked_by_lane: string | null;
  chat_conversation_id: string | null;
  answer_option_id: string | null;
  answer_text: string | null;
  answered_at: string | null;
  answered_by_id: string | null;
  /** Mike's exact words and date, ready to quote. Null unless he answered. */
  citation: string | null;
  /** True when the card was released without an answer: the recommendation went ahead, and this is NOT his word. */
  released_without_answer: boolean;
  defaulted_at: string | null;
  withdrawn_reason: string | null;
  created_at: string;
}

export function formatQuestion(q: QuestionRow): QuestionOut {
  return {
    id: q.id,
    task_id: q.task_id,
    position: q.position,
    question: q.question,
    what_it_is: q.what_it_is,
    sources: q.sources,
    checked: q.checked,
    unknown: q.unknown,
    options: q.options,
    recommended_option_id: q.recommended_option_id,
    recommend_why: q.recommend_why,
    if_nobody: q.if_nobody,
    if_nobody_action: q.if_nobody_action,
    state: q.state,
    asked_by_user_id: q.asked_by_user_id,
    asked_by_lane: q.asked_by_lane,
    chat_conversation_id: q.chat_conversation_id,
    answer_option_id: q.answer_option_id,
    answer_text: q.answer_text,
    answered_at: q.answered_at ? q.answered_at.toISOString() : null,
    answered_by_id: q.answered_by_id,
    citation: citationLine(q),
    released_without_answer: q.state === 'defaulted',
    defaulted_at: q.defaulted_at ? q.defaulted_at.toISOString() : null,
    withdrawn_reason: q.withdrawn_reason,
    created_at: q.created_at.toISOString(),
  };
}

export async function listQuestions(task: TaskHead, auth: Auth): Promise<{ questions: QuestionOut[]; open_count: number }> {
  await assertCanRead(task, auth);
  const rows = await prisma.taskQuestion.findMany({ where: { task_id: task.id }, orderBy: [{ position: 'asc' }, { created_at: 'asc' }] });
  return { questions: rows.map(formatQuestion), open_count: rows.filter((r) => r.state === 'open').length };
}

export async function addQuestion(task: TaskHead, auth: Auth, body: QuestionContext, chatConversationId?: string | null): Promise<QuestionOut> {
  assertCanAsk(task, auth);
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM tasks WHERE id = ${task.id}::uuid FOR UPDATE`;
    const open = await tx.taskQuestion.count({ where: { task_id: task.id, state: 'open' } });
    if (open >= OPEN_QUESTIONS_MAX) throw new ApiError(QUESTION_MESSAGES.tooMany, 409, 'too_many_open');
    const same = await tx.taskQuestion.findUnique({ where: { task_id_question: { task_id: task.id, question: body.question } }, select: { id: true } });
    if (same) throw new ApiError(QUESTION_MESSAGES.duplicate, 409, 'duplicate_question');
    const last = await tx.taskQuestion.aggregate({ where: { task_id: task.id }, _max: { position: true } });
    const row = await tx.taskQuestion.create({
      data: {
        task_id: task.id,
        position: (last._max.position ?? -1) + 1,
        question: body.question,
        what_it_is: body.what_it_is,
        sources: body.sources as unknown as Prisma.InputJsonValue,
        checked: body.checked,
        unknown: body.unknown,
        options: body.options && body.options.length > 0 ? (body.options as unknown as Prisma.InputJsonValue) : Prisma.DbNull,
        recommended_option_id: body.options && body.options.length > 0 ? body.recommended_option_id ?? null : null,
        recommend_why: body.recommend_why?.trim() || null,
        if_nobody: body.if_nobody,
        if_nobody_action: body.if_nobody_action,
        asked_by_user_id: auth.userId,
        asked_by_lane: auth.lane ? auth.lane.slice(0, 40) : null,
        chat_conversation_id: chatConversationId ?? null,
      },
    });
    return formatQuestion(row);
  });
}

function mergeContext(row: QuestionRow, patch: QuestionPatch): unknown {
  const pick = <K extends keyof QuestionPatch>(k: K, current: unknown) => (patch[k] !== undefined ? patch[k] : current);
  return {
    question: pick('question', row.question),
    what_it_is: pick('what_it_is', row.what_it_is),
    sources: pick('sources', row.sources),
    checked: pick('checked', row.checked),
    unknown: pick('unknown', row.unknown),
    options: pick('options', row.options),
    recommended_option_id: pick('recommended_option_id', row.recommended_option_id),
    recommend_why: pick('recommend_why', row.recommend_why),
    if_nobody: pick('if_nobody', row.if_nobody),
    if_nobody_action: pick('if_nobody_action', row.if_nobody_action),
  };
}

/** Withdraw (reason kept) or change the Context of an open question. The merged result must still pass every Context check. */
export async function patchQuestion(task: TaskHead, qid: string, auth: Auth, patch: QuestionPatch): Promise<QuestionOut> {
  await assertCanRead(task, auth);
  if (!UUID_RE.test(qid)) throw new ApiError(QUESTION_MESSAGES.notFound, 404);
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM tasks WHERE id = ${task.id}::uuid FOR UPDATE`;
    const row = await tx.taskQuestion.findFirst({ where: { id: qid, task_id: task.id } });
    if (!row) throw new ApiError(QUESTION_MESSAGES.notFound, 404);
    if (!isOwnerish(auth, row)) throw new ApiError(QUESTION_MESSAGES.notFound, 404);
    if (row.state === 'withdrawn') throw new ApiError(QUESTION_MESSAGES.closed, 409, 'withdrawn');
    if (row.state !== 'open') throw new ApiError(QUESTION_MESSAGES.notOpen, 409, 'not_open');
    let updated: QuestionRow;
    if (patch.withdraw) {
      updated = await tx.taskQuestion.update({ where: { id: row.id }, data: { state: 'withdrawn', withdrawn_at: new Date(), withdrawn_reason: (patch.reason ?? '').trim() || 'Withdrawn by the asker.' } });
      await releaseHoldIfLast(tx, task.id);
    } else {
      const merged = questionContextSchema.parse(mergeContext(row, patch));
      const hasOptions = !!merged.options && merged.options.length > 0;
      updated = await tx.taskQuestion.update({
        where: { id: row.id },
        data: {
          question: merged.question,
          what_it_is: merged.what_it_is,
          sources: merged.sources as unknown as Prisma.InputJsonValue,
          checked: merged.checked,
          unknown: merged.unknown,
          options: hasOptions ? (merged.options as unknown as Prisma.InputJsonValue) : Prisma.DbNull,
          recommended_option_id: hasOptions ? merged.recommended_option_id ?? null : null,
          recommend_why: merged.recommend_why?.trim() || null,
          if_nobody: merged.if_nobody,
          if_nobody_action: merged.if_nobody_action,
        },
      });
    }
    return formatQuestion(updated);
  });
}

/**
 * When no open question is left on the card, the marker tag and `needs-mike` come off, but only if the marker tag is there:
 * a `needs-mike` that something else put on the card is never ours to remove.
 */
async function releaseHoldIfLast(tx: Prisma.TransactionClient, taskId: string): Promise<boolean> {
  const stillOpen = await tx.taskQuestion.count({ where: { task_id: taskId, state: 'open' } });
  if (stillOpen > 0) return false;
  const t = await tx.task.findUnique({ where: { id: taskId }, select: { tags: true } });
  if (!t || !t.tags.includes(HELD_TAG)) return false;
  await tx.task.update({ where: { id: taskId }, data: { tags: t.tags.filter((x) => x !== HELD_TAG && x !== NEEDS_MIKE_TAG) } });
  return true;
}

export interface AnswerResult {
  question: QuestionOut;
  comment_id: string;
  hold_released: boolean;
}

/** Mike's answer. Answering again replaces the answer (the newer one wins); every answer stays as its own comment. */
export async function answerQuestion(task: TaskHead, qid: string, auth: Auth, body: QuestionAnswerBody, now: Date = new Date()): Promise<AnswerResult> {
  await assertCanRead(task, auth);
  if (!mayAnswerQuestions(auth)) throw new ApiError(QUESTION_MESSAGES.notYours, 403, 'not_mike');
  if (!UUID_RE.test(qid)) throw new ApiError(QUESTION_MESSAGES.notFound, 404);
  const machine = isChatLane(auth);
  const text = (body.text ?? '').trim();
  const out = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM tasks WHERE id = ${task.id}::uuid FOR UPDATE`;
    const row = await tx.taskQuestion.findFirst({ where: { id: qid, task_id: task.id } });
    if (!row) throw new ApiError(QUESTION_MESSAGES.notFound, 404);
    if (row.state === 'withdrawn') throw new ApiError(QUESTION_MESSAGES.closed, 409, 'withdrawn');
    let opt = null;
    if (body.option_id) {
      opt = optionOf(row.options, body.option_id);
      if (!opt) throw new ApiError(QUESTION_MESSAGES.badOption, 400, 'bad_option');
    }
    const words = answerWords(opt, text);
    const base = answerComment(row.question, words);
    const comment = await tx.comment.create({
      data: {
        task_id: task.id,
        user_id: auth.userId,
        content: machine ? `${CHAT_ANSWER_PREFIX}${base}` : base,
        mentioned_user_ids: [],
        is_internal: true,
        client_visible: false,
        client_question: false,
        chat_meta: { question: { id: row.id } },
        ...(auth.lane ? { actor_lane: auth.lane.slice(0, 40) } : {}),
      },
      select: { id: true },
    });
    const updated = await tx.taskQuestion.update({
      where: { id: row.id },
      data: {
        state: 'answered',
        answer_option_id: opt ? opt.id : null,
        answer_text: words,
        answered_at: now,
        answered_by_id: MIKE_USER_ID,
        answer_comment_id: comment.id,
        defaulted_at: null,
      },
    });
    const released = await releaseHoldIfLast(tx, task.id);
    return { updated, commentId: comment.id, released, askerId: row.asked_by_user_id };
  });

  const asker = out.askerId;
  if (asker && asker !== MIKE_USER_ID && asker !== auth.userId && !BOT_USER_IDS.includes(asker)) {
    try {
      await createNotification({
        userId: asker,
        type: 'comment_added',
        title: 'Mike answered your question',
        message: out.updated.question,
        entityType: 'task',
        entityId: task.id,
        actorUserId: auth.userId,
      });
    } catch {
      // the answer is saved; a missed notice is not a failed answer
    }
  }
  return { question: formatQuestion(out.updated), comment_id: out.commentId, hold_released: out.released };
}

/** Open questions waiting on Mike, per task, for the home screen and the tab count. */
export async function openQuestionCounts(db: Pick<typeof prisma, 'taskQuestion'>, taskIds: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (taskIds.length === 0) return out;
  const rows = await db.taskQuestion.groupBy({ by: ['task_id'], where: { task_id: { in: taskIds }, state: 'open' }, _count: { _all: true } });
  for (const r of rows) out.set(r.task_id, r._count._all);
  return out;
}

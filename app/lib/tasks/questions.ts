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
 *   answer  Mike's own signed-in session, or the enforced bast-chat lane relaying his words ("From Mike, through the chat: "), or the front
 *           session relaying his words with its enforced front-session lane key or Mike's own API key ("From Mike, through the front
 *           session: "; Mike, 2026-11-24: "make a quick task for bast to fix that issue in Citadel so we can answer questions from here").
 *           Dox records an answer someone else gave (a client email, most often) with its source: who, their words, when. That answer
 *           is Dox's record, never Mike's word: no citation, and it never lifts a `needs-mike` hold. Nobody else answers.
 *           A `defaulted` question is never his words and never has a citation.
 *
 * A question we sent a client (Mike, 2026-11-19) carries who it was for (asked_of_contact) and the email that carried it (sent). Any question can
 * block cards (blocks), exactly as a blocker task does (Mike, 2026-11-19: "I mean that in the way that dependencies block tasks"): asking holds
 * each active card in `blocked`; an answer, a withdrawal, or a go-ahead question's default_at passing releases the cards whose other blockers are
 * satisfied too (lib/services/dependencies.ts). The unblock sweep never releases a card an open question still holds.
 *
 * The client portal never reads this table.
 */
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { ApiError } from '@/lib/api/errors';
import type { AuthPayload } from '@/lib/auth/middleware';
import { actorOf, recordTriageChange } from './triage-rev';
import { MIKE_USER_ID, BOT_USER_IDS, BAST_USER_ID } from '@/lib/oracle/projects/gate-constants';
import { releaseQuestionDependents, releaseTasksIfReleasable } from '@/lib/services/dependencies';
import { isMikeOwnKey, mayLeaveTriage } from '@/lib/services/task-patch';
import { isFrontSessionCaller } from '@/lib/front-session/identity';
import { CHAT_LANE } from '@/lib/bast-chat/task-filter';
import { createNotification } from '@/lib/services/notifications';
import { CHAT_ANSWER_PREFIX } from './checklist-answers';
import { isDoxLaneValue } from '@/lib/dox/identity';
import { flagAnswerForDox } from '@/lib/dox/ask';
import {
  OPEN_QUESTIONS_MAX,
  QUESTION_CHANGED_MESSAGE,
  answerComment,
  answerWords,
  citationLine,
  optionOf,
  questionContextSchema,
  sourcedAnswerComment,
  QUESTION_TZ,
  type ClientQuestionInput,
  type QuestionAnswerBody,
  type QuestionContext,
  type QuestionPatch,
} from './question-context';

/** Tags that tie a parked card to its open questions. Only `held-for-questions` is ours; removing `needs-mike` rides on it. */
export const HELD_TAG = 'held-for-questions';
export const NEEDS_MIKE_TAG = 'needs-mike';
/** Second marker: present only when release itself put `needs-mike` on the card. Answering removes `needs-mike` only with this marker. */
export const HELD_NEEDS_MIKE_MARK = 'held-for-questions:needs-mike';
/** Comment prefix for an answer saved while another `wait` question is still open: written as Bast so the worker's gate does not read it as a human reply. */
export const HELD_ANSWER_PREFIX = 'From Mike, on the card (other questions still waiting): ';

export const QUESTION_MESSAGES = {
  notFound: 'Question not found',
  notYours: 'Only Mike answers these. Ask him, or have him answer on the card.',
  closed: 'That question is withdrawn.',
  notOpen: 'Only an open question can be changed.',
  tooMany: `A card holds at most ${OPEN_QUESTIONS_MAX} open questions. Ask the most important ones first.`,
  duplicate: 'That question is already on this card.',
  badOption: 'That is not one of the options.',
  changed: QUESTION_CHANGED_MESSAGE,
} as const;

type Auth = Pick<AuthPayload, 'userId' | 'role' | 'via' | 'lane' | 'laneEnforced'>;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isChatLane(auth: Auth): boolean {
  return auth.via === 'api_key' && auth.lane === CHAT_LANE && auth.laneEnforced === true;
}

/** The comment prefix on an answer the front session relays (its own lane key, or Mike's own API key, which it files and sorts with). */
export const FRONT_SESSION_ANSWER_PREFIX = 'From Mike, through the front session: ';

/** The front session relaying Mike's words: its enforced front-session lane key, or Mike's own API key (his user, no lane). */
export function isFrontSessionAnswer(auth: Auth): boolean {
  return isFrontSessionCaller(auth) || isMikeOwnKey(auth);
}

/**
 * Mike's own signed-in session, or the enforced chat lane relaying his words (the same rule as leaving triage), or the front session relaying
 * them (Mike, 2026-11-24: "this is going to be my primary method for interacting with the citadel"). Every other key is refused.
 */
export function mayAnswerQuestions(auth: Auth): boolean {
  return mayLeaveTriage(auth) || isFrontSessionAnswer(auth);
}

type TaskHead = { id: string; status: string; tags: string[] };
type QuestionRow = Prisma.TaskQuestionGetPayload<object>;

/** Who a client question was for, and the cards it blocks: loaded with every question this module returns. */
export const QUESTION_INCLUDE = {
  asked_of_contact: { select: { id: true, name: true, email: true } },
  blocks: { where: { is_deleted: false }, select: { id: true, title: true, status: true }, orderBy: { created_at: 'asc' } },
} satisfies Prisma.TaskQuestionInclude;
type QuestionRowFull = QuestionRow & {
  asked_of_contact?: { id: string; name: string | null; email: string } | null;
  blocks?: Array<{ id: string; title: string; status: string }>;
};

/**
 * Who may read (and ask on) this card's questions. `checkTaskAccess` has already run, so a contractor who cannot see the task
 * is gone; this adds the question-specific rule. Throws a 404 (never a 403: a card in triage does not admit it exists).
 */
export async function assertCanRead(task: TaskHead, auth: Auth): Promise<void> {
  if (auth.role === 'designer' || (auth.role === 'tech' && task.status === 'triage')) throw new ApiError('Task not found', 404);
  if (task.status !== 'triage') return;
  // The worker lane reads questions on cards it works, never on a triage card.
  if (auth.lane === 'bast') throw new ApiError('Task not found', 404);
  if (auth.userId === MIKE_USER_ID || isChatLane(auth) || BOT_USER_IDS.includes(auth.userId)) return;
  const asked = await prisma.taskQuestion.findFirst({ where: { task_id: task.id, asked_by_user_id: auth.userId }, select: { id: true } });
  if (!asked) throw new ApiError('Task not found', 404);
}

/** Asking is open to any staff who can see the card (a pm or admin filing on a triage card becomes its asker, and reads it back). */
export function assertCanAsk(task: TaskHead, auth: Auth): void {
  if (auth.role === 'designer' || (auth.role === 'tech' && task.status === 'triage')) throw new ApiError('Task not found', 404);
  // The worker lane logs client questions on released cards only; a Triage card is Mike's and the chat's.
  if (auth.lane === 'bast' && task.status === 'triage') throw new ApiError('Task not found', 404);
}

function isOwnerish(auth: Auth, row: Pick<QuestionRow, 'asked_by_user_id'>): boolean {
  return auth.userId === MIKE_USER_ID || isChatLane(auth) || BOT_USER_IDS.includes(auth.userId) || row.asked_by_user_id === auth.userId;
}

export interface QuestionOut {
  id: string;
  /** The card the question is on. Null for a project question (project_id is set instead). */
  task_id: string | null;
  /** Set only on a project question: one asked on the project itself, with no card. */
  project_id: string | null;
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
  /** Dox: the underlying cause this question is about (one open question per cause). Null for a question with no cause key. */
  cause_key: string | null;
  /** True only on the answer to a POST that found its cause already open: this is the existing question, nothing new was created. */
  deduped?: boolean;
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
  /** The row's updated_at as the client saw it. Send it back with an answer; a changed row answers 409. */
  version: string;
  /** A question we sent a client contact: who it was for. Null on a question for Mike. */
  asked_of_contact: { id: string; name: string | null; email: string } | null;
  /** The email that carried it. */
  sent: { account: string; message_id: string; thread_id: string | null; at: string | null } | null;
  /** Go-ahead questions only: when the recommendation goes ahead if nobody answers. */
  default_at: string | null;
  nudge_drafted_at: string | null;
  /** The cards waiting on the answer. */
  blocks: Array<{ id: string; title: string; status: string }>;
}

export function formatQuestion(q: QuestionRowFull): QuestionOut {
  return {
    id: q.id,
    task_id: q.task_id,
    project_id: q.project_id,
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
    cause_key: q.cause_key,
    answer_option_id: q.answer_option_id,
    answer_text: q.answer_text,
    answered_at: q.answered_at ? q.answered_at.toISOString() : null,
    answered_by_id: q.answered_by_id,
    citation: citationLine(q),
    released_without_answer: q.state === 'defaulted',
    defaulted_at: q.defaulted_at ? q.defaulted_at.toISOString() : null,
    withdrawn_reason: q.withdrawn_reason,
    created_at: q.created_at.toISOString(),
    version: q.updated_at.toISOString(),
    asked_of_contact: q.asked_of_contact ? { id: q.asked_of_contact.id, name: q.asked_of_contact.name, email: q.asked_of_contact.email } : null,
    sent: q.sent_account && q.sent_message_id
      ? { account: q.sent_account, message_id: q.sent_message_id, thread_id: q.sent_thread_id, at: q.sent_at ? q.sent_at.toISOString() : null }
      : null,
    default_at: q.default_at ? q.default_at.toISOString() : null,
    nudge_drafted_at: q.nudge_drafted_at ? q.nudge_drafted_at.toISOString() : null,
    blocks: (q.blocks ?? []).map((t) => ({ id: t.id, title: t.title, status: t.status })),
  };
}

export async function listQuestions(task: TaskHead, auth: Auth): Promise<{ questions: QuestionOut[]; open_count: number }> {
  await assertCanRead(task, auth);
  const rows = await prisma.taskQuestion.findMany({ where: { task_id: task.id }, orderBy: [{ position: 'asc' }, { created_at: 'asc' }], include: QUESTION_INCLUDE });
  return { questions: rows.map(formatQuestion), open_count: rows.filter((r) => r.state === 'open').length };
}

export const CAUSE_KEY_MAX = 120;
export const CAUSE_SCOPES = ['card', 'project'] as const;
export type CauseScope = (typeof CAUSE_SCOPES)[number];
export interface QuestionCause {
  /** One live question per cause: a repeat finds the existing one, open or already answered (never a withdrawn one). A new key (the cause changed) is a new question. */
  key: string;
  /** `card` (default): one question per card per cause. `project`: one question across the whole project, setup card included. */
  scope?: CauseScope;
}

export const BLOCK_MESSAGES = {
  notFound: 'One or more cards to block were not found.',
  outside: 'A question blocks cards in its own project only, or its own card.',
  contact: 'That contact was not found.',
  defaultNeedsGo: 'A go-ahead date belongs to a question that goes with the recommendation when nobody answers.',
} as const;

/** The cards a question may block: each exists, and is the question's own card or a card in the same project. Returns them de-duplicated. */
async function validateBlocks(tx: Prisma.TransactionClient, homeId: string, projectId: string | null, ids: string[]): Promise<string[]> {
  const unique = Array.from(new Set(ids));
  if (unique.length === 0) return [];
  const rows = await tx.task.findMany({ where: { id: { in: unique }, is_deleted: false }, select: { id: true, project_id: true } });
  if (rows.length !== unique.length) throw new ApiError(BLOCK_MESSAGES.notFound, 404, 'block_not_found');
  for (const r of rows) {
    if (r.id !== homeId && (!projectId || r.project_id !== projectId)) throw new ApiError(BLOCK_MESSAGES.outside, 422, 'block_outside_project');
  }
  return unique;
}

/**
 * An open question holds its cards: each card not yet started moves to `blocked`. A card already in progress or staged for the client keeps its
 * status (blocking it would park a live session's work, and the release would bring a staged card back as not_started); Triage, done and abandoned
 * cards are never touched. The link stays, so the card's Blocked by list still shows the question.
 */
async function holdForQuestion(tx: Prisma.TransactionClient, ids: string[]): Promise<string[]> {
  if (ids.length === 0) return [];
  const waiting = await tx.task.findMany({ where: { id: { in: ids }, status: 'not_started' }, select: { id: true } });
  if (waiting.length === 0) return [];
  await tx.task.updateMany({ where: { id: { in: waiting.map((t) => t.id) }, status: 'not_started' }, data: { status: 'blocked' } });
  return waiting.map((t) => t.id);
}

/** Blocking cards is a staff decision: Mike, the chat lane, bot keys, or a pm or admin, and never from a question on a Triage card. */
function assertMayBlock(task: TaskHead, auth: Auth & { role?: string }): void {
  const staff = auth.userId === MIKE_USER_ID || isChatLane(auth) || BOT_USER_IDS.includes(auth.userId) || auth.role === 'pm' || auth.role === 'admin';
  if (!staff) throw new ApiError('Only staff block cards with a question.', 403, 'block_not_allowed');
  if (task.status === 'triage') throw new ApiError('A question on a Triage card does not block other cards.', 422, 'block_from_triage');
}

export async function addQuestion(
  task: TaskHead,
  auth: Auth,
  body: QuestionContext,
  chatConversationId?: string | null,
  cause?: QuestionCause | null,
  client?: ClientQuestionInput | null,
): Promise<QuestionOut> {
  assertCanAsk(task, auth);
  if (client?.default_at && body.if_nobody_action !== 'go_with_recommendation') throw new ApiError(BLOCK_MESSAGES.defaultNeedsGo, 400, 'default_at_needs_go');
  if ((client?.blocks ?? []).length > 0) assertMayBlock(task, auth as Auth & { role?: string });
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM tasks WHERE id = ${task.id}::uuid FOR UPDATE`;
    const home = await tx.task.findUnique({ where: { id: task.id }, select: { project_id: true } });
    if (cause) {
      // A project-level cause is one item for the whole project, so two cards cannot both raise it: a transaction-wide lock on the key serialises them.
      if (cause.scope === 'project') await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"dox-cause:" + cause.key}))`;
      const where: Prisma.TaskQuestionWhereInput =
        cause.scope === 'project' && home?.project_id
          ? { cause_key: cause.key, state: { not: 'withdrawn' }, OR: [{ task: { project_id: home.project_id, is_deleted: false } }, { project_id: home.project_id }] }
          : { cause_key: cause.key, state: { not: 'withdrawn' }, task_id: task.id };
      const existing = await tx.taskQuestion.findFirst({ where, orderBy: { created_at: 'asc' }, include: QUESTION_INCLUDE });
      if (existing) return { ...formatQuestion(existing), deduped: true };
    }
    const open = await tx.taskQuestion.count({ where: { task_id: task.id, state: 'open' } });
    if (open >= OPEN_QUESTIONS_MAX) throw new ApiError(QUESTION_MESSAGES.tooMany, 409, 'too_many_open');
    // Unique among non-withdrawn rows only (the task row lock above makes this check safe); a withdrawn question can be asked again.
    const same = await tx.taskQuestion.findFirst({ where: { task_id: task.id, question: body.question, state: { not: 'withdrawn' } }, select: { id: true } });
    if (same) throw new ApiError(QUESTION_MESSAGES.duplicate, 409, 'duplicate_question');
    const blockIds = await validateBlocks(tx, task.id, home?.project_id ?? null, client?.blocks ?? []);
    if (client?.asked_of_contact_id) {
      const contact = await tx.clientContact.findFirst({ where: { id: client.asked_of_contact_id, is_deleted: false }, select: { id: true } });
      if (!contact) throw new ApiError(BLOCK_MESSAGES.contact, 404, 'contact_not_found');
    }
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
        cause_key: cause?.key ?? null,
        asked_of_contact_id: client?.asked_of_contact_id ?? null,
        sent_account: client?.sent?.account ?? null,
        sent_message_id: client?.sent?.message_id ?? null,
        sent_thread_id: client?.sent?.thread_id ?? null,
        sent_at: client?.sent?.at ? new Date(client.sent.at) : null,
        default_at: client?.default_at ? new Date(client.default_at) : null,
        ...(blockIds.length > 0 ? { blocks: { connect: blockIds.map((id) => ({ id })) } } : {}),
      },
      include: QUESTION_INCLUDE,
    });
    await holdForQuestion(tx, blockIds);
    const actor = await actorOf(auth, tx as never);
    await recordTriageChange(tx, task.id, 'question', `Question added by ${actor.by}`, actor);
    // The cards just moved to blocked: read them again so the answer shows their state now.
    const fresh = blockIds.length > 0 ? await tx.taskQuestion.findUnique({ where: { id: row.id }, include: QUESTION_INCLUDE }) : null;
    return formatQuestion(fresh ?? row);
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
  const { nudge_drafted: nudged, ...contextPatch } = patch;
  const onlyNudge = nudged === true && Object.keys(contextPatch).length === 0;
  const out = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM tasks WHERE id = ${task.id}::uuid FOR UPDATE`;
    const row = await tx.taskQuestion.findFirst({ where: { id: qid, task_id: task.id } });
    if (!row) throw new ApiError(QUESTION_MESSAGES.notFound, 404);
    if (!isOwnerish(auth, row)) throw new ApiError(QUESTION_MESSAGES.notFound, 404);
    // The worker lane changes or withdraws only the questions it logged itself; on anyone else's it may only stamp a drafted nudge.
    if (auth.lane === 'bast' && row.asked_by_lane !== 'bast' && !onlyNudge) throw new ApiError(QUESTION_MESSAGES.notFound, 404);
    if (row.state === 'withdrawn') throw new ApiError(QUESTION_MESSAGES.closed, 409, 'withdrawn');
    if (row.state !== 'open') throw new ApiError(QUESTION_MESSAGES.notOpen, 409, 'not_open');
    let updated: QuestionRowFull;
    const nudgeStamp = nudged ? { nudge_drafted_at: new Date() } : {};
    if (patch.withdraw) {
      updated = await tx.taskQuestion.update({ where: { id: row.id }, data: { state: 'withdrawn', withdrawn_at: new Date(), withdrawn_reason: (patch.reason ?? '').trim() || 'Withdrawn by the asker.', ...nudgeStamp }, include: QUESTION_INCLUDE });
      await releaseHoldIfLast(tx, task.id);
    } else if (onlyNudge) {
      updated = await tx.taskQuestion.update({ where: { id: row.id }, data: nudgeStamp, include: QUESTION_INCLUDE });
    } else {
      const merged = questionContextSchema.parse(mergeContext(row, contextPatch));
      const hasOptions = !!merged.options && merged.options.length > 0;
      if (merged.question !== row.question) {
        const same = await tx.taskQuestion.findFirst({ where: { task_id: task.id, question: merged.question, state: { not: 'withdrawn' }, id: { not: row.id } }, select: { id: true } });
        if (same) throw new ApiError(QUESTION_MESSAGES.duplicate, 409, 'duplicate_question');
      }
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
          // A go-ahead date means nothing on a question that waits: it goes when the question stops going ahead on its own.
          ...(merged.if_nobody_action === 'wait' ? { default_at: null } : {}),
          ...nudgeStamp,
        },
        include: QUESTION_INCLUDE,
      });
    }
    const actor = await actorOf(auth, tx as never);
    const what = patch.withdraw ? 'withdrawn' : onlyNudge ? 'nudge drafted' : 'changed';
    await recordTriageChange(tx, task.id, 'question', `Question ${what} by ${actor.by}`, actor);
    return updated;
  });
  // A withdrawn question holds nothing: release the cards it blocked whose other blockers are satisfied.
  if (patch.withdraw) {
    await releaseQuestionDependents(out.id);
    return formatQuestion((await prisma.taskQuestion.findUnique({ where: { id: out.id }, include: QUESTION_INCLUDE })) ?? out);
  }
  return formatQuestion(out);
}

/**
 * When no open question is left on the card, the marker tag comes off, and `needs-mike` with it only if release itself added it
 * (the second marker is present): a `needs-mike` that something else put on the card is never ours to remove.
 */
async function releaseHoldIfLast(tx: Prisma.TransactionClient, taskId: string): Promise<boolean> {
  const stillOpen = await tx.taskQuestion.count({ where: { task_id: taskId, state: 'open' } });
  if (stillOpen > 0) return false;
  const t = await tx.task.findUnique({ where: { id: taskId }, select: { tags: true } });
  if (!t || !t.tags.includes(HELD_TAG)) return false;
  const ours = t.tags.includes(HELD_NEEDS_MIKE_MARK);
  await tx.task.update({ where: { id: taskId }, data: { tags: t.tags.filter((x) => x !== HELD_TAG && x !== HELD_NEEDS_MIKE_MARK && !(ours && x === NEEDS_MIKE_TAG)) } });
  return true;
}

export interface AnswerResult {
  question: QuestionOut;
  comment_id: string;
  hold_released: boolean;
  /** Cards this question blocked that the answer released (every other blocker satisfied too). */
  released_task_ids: string[];
}

/** Mike's answer. Answering again replaces the answer (the newer one wins); every answer stays as its own comment. */
/** The Dox lane's own enforced key (lib/dox/guard.ts narrows where it may answer). */
export function isDoxAnswer(auth: Auth): boolean {
  return auth.via === 'api_key' && auth.laneEnforced === true && isDoxLaneValue(auth.lane);
}

/** Any way of naming Mike in an answer's source: Dox never records his word (it comes from his session or the chat). */
export const MIKE_NAMES_RE = /\b(mike|michael|dion|reshi)\b/i;

export const ANSWER_SOURCE_MESSAGE = 'Dox records an answer with its source: who gave it, their words and the date (source: { who, said, at, url? }).';

export async function answerQuestion(task: TaskHead, qid: string, auth: Auth, body: QuestionAnswerBody, now: Date = new Date()): Promise<AnswerResult> {
  await assertCanRead(task, auth);
  const viaDox = isDoxAnswer(auth);
  if (!mayAnswerQuestions(auth) && !viaDox) throw new ApiError(QUESTION_MESSAGES.notYours, 403, 'not_mike');
  if (viaDox) {
    if (!body.source) throw new ApiError(ANSWER_SOURCE_MESSAGE, 422, 'answer_source_required');
    if (MIKE_NAMES_RE.test(body.source.who)) throw new ApiError('Dox does not record Mike\'s word: Mike answers on the card or through the chat.', 422, 'answer_source_mike');
  }
  if (!UUID_RE.test(qid)) throw new ApiError(QUESTION_MESSAGES.notFound, 404);
  const machine = isChatLane(auth);
  // The front session is a relay like the chat: its answer always carries its prefix and is never rewritten as the quiet Bast note.
  const front = !machine && isFrontSessionAnswer(auth);
  const text = (body.text ?? '').trim();
  const out = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM tasks WHERE id = ${task.id}::uuid FOR UPDATE`;
    const row = await tx.taskQuestion.findFirst({ where: { id: qid, task_id: task.id } });
    if (!row) throw new ApiError(QUESTION_MESSAGES.notFound, 404);
    if (row.state === 'withdrawn') throw new ApiError(QUESTION_MESSAGES.closed, 409, 'withdrawn');
    // Dox closes an open (or defaulted) question; an answer already given, Mike's above all, is never overwritten by his record.
    if (viaDox && row.state === 'answered') throw new ApiError('That question is already answered.', 409, 'already_answered');
    // He answers the wording he saw: if the row changed since he read it, nothing is stored.
    if (row.updated_at.toISOString() !== body.version) throw new ApiError(QUESTION_MESSAGES.changed, 409, 'question_changed');
    let opt = null;
    if (body.option_id) {
      opt = optionOf(row.options, body.option_id);
      if (!opt) throw new ApiError(QUESTION_MESSAGES.badOption, 400, 'bad_option');
    }
    const words = answerWords(opt, text);
    const base = answerComment(row.question, words);
    // While another `wait` question is still open the card must not wake. The gate treats a last comment by a bot user as not human,
    // so this answer is kept as a Bast-authored note that says it is Mike's; the last answer writes the real, waking comment.
    const othersWaiting = await tx.taskQuestion.count({ where: { task_id: task.id, state: 'open', if_nobody_action: 'wait', id: { not: row.id } } });
    // Dox's own user is a bot user already (the gate never reads it as a human reply), so his answer is never re-written as Bast's.
    const quiet = othersWaiting > 0 && !machine && !front && !viaDox;
    const content = viaDox && body.source
      ? sourcedAnswerComment(row.question, words, body.source)
      : machine ? `${CHAT_ANSWER_PREFIX}${base}` : front ? `${FRONT_SESSION_ANSWER_PREFIX}${base}` : quiet ? `${HELD_ANSWER_PREFIX}${base}` : base;
    const comment = await tx.comment.create({
      data: {
        task_id: task.id,
        // Mike's own key writes as Mike, a human reply that wakes the card, so while another wait question is open it writes as Bast too.
        user_id: quiet || (front && othersWaiting > 0) ? BOT_USER_IDS[0] : auth.userId,
        content,
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
        answered_by_id: viaDox ? auth.userId : MIKE_USER_ID,
        answer_comment_id: comment.id,
        defaulted_at: null,
      },
      include: QUESTION_INCLUDE,
    });
    // A hold that carries needs-mike waits for Mike: an answer Dox recorded never lifts it.
    const holdsForMike = viaDox && ((await tx.task.findUnique({ where: { id: task.id }, select: { tags: true } }))?.tags ?? []).includes(NEEDS_MIKE_TAG);
    const released = holdsForMike ? false : await releaseHoldIfLast(tx, task.id);
    const actor = await actorOf(auth, tx as never);
    await recordTriageChange(tx, task.id, 'question', `Question answered by ${actor.by}`, actor);
    return { updated, commentId: comment.id, released, askerId: row.asked_by_user_id, askerLane: row.asked_by_lane };
  });

  const asker = out.askerId;
  if (asker && asker !== MIKE_USER_ID && asker !== auth.userId && !BOT_USER_IDS.includes(asker)) {
    try {
      await createNotification({
        userId: asker,
        type: 'comment_added',
        title: viaDox ? 'An answer was recorded on your question' : 'Mike answered your question',
        message: out.updated.question,
        entityType: 'task',
        entityId: task.id,
        actorUserId: auth.userId,
      });
    } catch {
      // the answer is saved; a missed notice is not a failed answer
    }
  }
  // An answer to a question Dox asked is handed to Dox (the card is marked asked-dox, so his next pass on the project reads it).
  try {
    await flagAnswerForDox(prisma, task.id, { asked_by_user_id: out.askerId, asked_by_lane: out.askerLane }, { userId: auth.userId, lane: auth.lane });
  } catch {
    // the answer is saved; a missed hand-off is not a failed answer (the scheduled sweep still reads the card)
  }
  // An answer releases the cards the question blocked (Mike, 2026-11-19): each whose other blockers are satisfied moves back to not_started.
  const releasedTasks = await releaseQuestionDependents(out.updated.id);
  const fresh = releasedTasks.length > 0 ? await prisma.taskQuestion.findUnique({ where: { id: out.updated.id }, include: QUESTION_INCLUDE }) : null;
  return { question: formatQuestion(fresh ?? out.updated), comment_id: out.commentId, hold_released: out.released, released_task_ids: releasedTasks };
}

/** Open questions waiting on Mike, per task, for the home screen and the tab count. */
export async function openQuestionCounts(db: Pick<typeof prisma, 'taskQuestion'>, taskIds: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (taskIds.length === 0) return out;
  const rows = await db.taskQuestion.groupBy({ by: ['task_id'], where: { task_id: { in: taskIds }, state: 'open' }, _count: { _all: true } });
  for (const r of rows) if (r.task_id) out.set(r.task_id, r._count._all);
  return out;
}

/** Who may change which cards a question blocks: its asker, Mike, the chat lane, bot keys, or a pm or admin. */
function mayEditBlocks(auth: Auth & { role?: string }, row: Pick<QuestionRow, 'asked_by_user_id'>): boolean {
  return isOwnerish(auth, row) || auth.role === 'pm' || auth.role === 'admin';
}

/** POST /api/tasks/:id/questions/:qid/blocks: the question now also blocks these cards. An open question holds each active one at once. */
export async function addQuestionBlocks(task: TaskHead, qid: string, auth: Auth, taskIds: string[]): Promise<QuestionOut> {
  await assertCanRead(task, auth);
  if (!UUID_RE.test(qid)) throw new ApiError(QUESTION_MESSAGES.notFound, 404);
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM tasks WHERE id = ${task.id}::uuid FOR UPDATE`;
    const row = await tx.taskQuestion.findFirst({ where: { id: qid, task_id: task.id } });
    if (!row || !mayEditBlocks(auth, row)) throw new ApiError(QUESTION_MESSAGES.notFound, 404);
    if (auth.lane === 'bast' && row.asked_by_lane !== 'bast') throw new ApiError(QUESTION_MESSAGES.notFound, 404);
    if (row.state === 'withdrawn') throw new ApiError(QUESTION_MESSAGES.closed, 409, 'withdrawn');
    assertMayBlock(task, auth as Auth & { role?: string });
    const home = await tx.task.findUnique({ where: { id: task.id }, select: { project_id: true } });
    const ids = await validateBlocks(tx, task.id, home?.project_id ?? null, taskIds);
    await tx.taskQuestion.update({ where: { id: row.id }, data: { blocks: { connect: ids.map((id) => ({ id })) } } });
    if (row.state === 'open') await holdForQuestion(tx, ids);
    const actor = await actorOf(auth, tx as never);
    await recordTriageChange(tx, task.id, 'question', `Question now blocks ${ids.length} card${ids.length === 1 ? '' : 's'} (${actor.by})`, actor);
    return formatQuestion((await tx.taskQuestion.findUnique({ where: { id: row.id }, include: QUESTION_INCLUDE }))!);
  });
}

/** DELETE /api/tasks/:id/questions/:qid/blocks: the question no longer blocks these cards; each is released if nothing else holds it. */
export async function removeQuestionBlocks(task: TaskHead, qid: string, auth: Auth, taskIds: string[]): Promise<QuestionOut> {
  await assertCanRead(task, auth);
  if (!UUID_RE.test(qid)) throw new ApiError(QUESTION_MESSAGES.notFound, 404);
  const ids = Array.from(new Set(taskIds));
  const out = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM tasks WHERE id = ${task.id}::uuid FOR UPDATE`;
    const row = await tx.taskQuestion.findFirst({ where: { id: qid, task_id: task.id } });
    if (!row || !mayEditBlocks(auth, row)) throw new ApiError(QUESTION_MESSAGES.notFound, 404);
    if (auth.lane === 'bast' && row.asked_by_lane !== 'bast') throw new ApiError(QUESTION_MESSAGES.notFound, 404);
    await tx.taskQuestion.update({ where: { id: row.id }, data: { blocks: { disconnect: ids.map((id) => ({ id })) } } });
    const actor = await actorOf(auth, tx as never);
    await recordTriageChange(tx, task.id, 'question', `Question no longer blocks ${ids.length} card${ids.length === 1 ? '' : 's'} (${actor.by})`, actor);
    return row.id;
  });
  await releaseTasksIfReleasable(ids);
  return formatQuestion((await prisma.taskQuestion.findUnique({ where: { id: out }, include: QUESTION_INCLUDE }))!);
}

export const QUESTION_FOR = ['client', 'mike', 'all'] as const;
export const QUESTION_STATES = ['open', 'answered', 'defaulted', 'withdrawn', 'all'] as const;

export interface QuestionListOut extends QuestionOut {
  /** The question's card. Null for a project question. */
  task: { id: string; title: string; status: string; project_id: string | null; project: { id: string; name: string } | null } | null;
  /** The project the question belongs to: its card's project, or its own for a project question. Null for a card with no project. */
  project: { id: string; name: string } | null;
  /** Who asked it, by name. Null when the asker is not recorded or no longer exists (asked_by_lane may still say which agent lane filed it). */
  asked_by: { id: string; name: string } | null;
}

/**
 * GET /api/questions: questions across cards, oldest first, each with its card and project. No question on a Triage card (those are Mike's
 * and the chat's, read on the card), unless `include_triage` is set by Mike's own session or the chat lane (the project screen's Questions tab:
 * "all open questions attached to a project", Mike, 2026-11-19); for anyone else the flag is ignored. `for`: client (we sent it to a client
 * contact), mike (no contact), all.
 */
export async function listAllQuestions(
  auth: Auth & { role?: string },
  q: { state: (typeof QUESTION_STATES)[number]; for: (typeof QUESTION_FOR)[number]; project_id?: string; limit: number; include_triage?: boolean },
): Promise<{ questions: QuestionListOut[]; total: number }> {
  if (auth.role !== 'pm' && auth.role !== 'admin') throw new ApiError('Insufficient permissions', 403);
  const withTriage = q.include_triage === true && mayAnswerQuestions(auth);
  const where: Prisma.TaskQuestionWhereInput = {
    ...(q.state === 'all' ? {} : { state: q.state }),
    ...(q.for === 'client' ? { asked_of_contact_id: { not: null } } : q.for === 'mike' ? { asked_of_contact_id: null } : {}),
    // A card question (never on a deleted card, and on a Triage card only for Mike), or a project question (asked on the project itself).
    OR: [
      { task: { is_deleted: false, ...(withTriage ? {} : { status: { not: 'triage' as const } }), ...(q.project_id ? { project_id: q.project_id } : {}) } },
      { task_id: null, project: { is_deleted: false }, ...(q.project_id ? { project_id: q.project_id } : {}) },
    ],
  };
  const [rows, total] = await Promise.all([
    prisma.taskQuestion.findMany({
      where,
      orderBy: [{ created_at: 'asc' }],
      take: q.limit,
      include: { ...QUESTION_INCLUDE, project: { select: { id: true, name: true } }, task: { select: { id: true, title: true, status: true, project_id: true, project: { select: { id: true, name: true } } } } },
    }),
    prisma.taskQuestion.count({ where }),
  ]);
  // TaskQuestion carries the asker as a bare id (no relation), so read the names in one query.
  const askerIds = [...new Set(rows.map((r) => r.asked_by_user_id).filter((v): v is string => !!v))];
  const askers = askerIds.length ? await prisma.user.findMany({ where: { id: { in: askerIds } }, select: { id: true, name: true } }) : [];
  const askerById = new Map(askers.map((u) => [u.id, u]));
  return {
    questions: rows.map((r) => ({
      ...formatQuestion(r),
      task: r.task ? { id: r.task.id, title: r.task.title, status: r.task.status, project_id: r.task.project_id, project: r.task.project } : null,
      project: r.task ? r.task.project : r.project,
      asked_by: (r.asked_by_user_id && askerById.get(r.asked_by_user_id)) || null,
    })),
    total,
  };
}

function dayIn(tz: string, d: Date): string {
  return new Intl.DateTimeFormat('en-US', { timeZone: tz, month: 'long', day: 'numeric', year: 'numeric' }).format(d);
}

/** The reason a released card carries when a go-ahead question's date passed with no answer. */
export function defaultReleaseComment(question: string, defaultAt: Date, recommended: string | null, ifNobody: string): string {
  const goes = recommended ? `so the recommendation goes ahead: ${recommended}.` : 'so the recommendation goes ahead.';
  return `Went ahead: nobody answered "${question}" by ${dayIn(QUESTION_TZ, defaultAt)}, ${goes} ${ifNobody}`.trim();
}

/**
 * The go-ahead sweep (run by POST /api/tasks/unblock-sweep before it heals): every open question that goes with the recommendation when nobody
 * answers, whose default_at has passed, becomes `defaulted` (never Mike's word), each card it blocks gets the reason as an internal comment, and
 * the cards are released when nothing else holds them (Mike, 2026-11-19, item 4 of the email loop task).
 */
export async function defaultDueQuestions(now: Date = new Date()): Promise<{ defaulted: string[]; released: string[] }> {
  const due = await prisma.taskQuestion.findMany({
    where: { state: 'open', if_nobody_action: 'go_with_recommendation', default_at: { lte: now }, task: { is_deleted: false, status: { not: 'triage' } } },
    include: { blocks: { where: { is_deleted: false }, select: { id: true } } },
    orderBy: { default_at: 'asc' },
    take: 200,
  });
  const defaulted: string[] = [];
  const released: string[] = [];
  for (const q of due) {
    const homeId = q.task_id;
    if (!homeId) continue; // a project question never carries a go-ahead date
    const flipped = await prisma.$transaction(async (tx) => {
      const n = await tx.taskQuestion.updateMany({ where: { id: q.id, state: 'open' }, data: { state: 'defaulted', defaulted_at: now } });
      if (n.count !== 1) return false;
      const rec = q.recommended_option_id ? optionOf(q.options, q.recommended_option_id) : null;
      const content = defaultReleaseComment(q.question, q.default_at ?? now, rec ? rec.label : null, q.if_nobody);
      const cards = Array.from(new Set([homeId, ...q.blocks.map((b) => b.id)]));
      for (const taskId of cards) {
        await tx.comment.create({
          data: { task_id: taskId, user_id: BAST_USER_ID, content, mentioned_user_ids: [], is_internal: true, client_visible: false, client_question: false, chat_meta: { question: { id: q.id } } },
        });
      }
      await releaseHoldIfLast(tx, homeId);
      return true;
    });
    if (!flipped) continue;
    defaulted.push(q.id);
    released.push(...(await releaseQuestionDependents(q.id)));
  }
  return { defaulted, released };
}

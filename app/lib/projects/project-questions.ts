/**
 * Project questions: a question asked on the project itself, with no card.
 *
 * Why (Mike, 2026-11-23: "Sometimes the answer will determine what tasks get created, so we have a chicken and egg problem"): a card question
 * needs a card, and some questions come before any card can exist. A project question is a task_questions row with project_id set and no
 * task_id. It carries the same Context parts as a card question (lib/tasks/question-context.ts) and reads back in the same shape, so the
 * project screen's Questions tab and GET /api/questions show both kinds together.
 *
 *   listProjectQuestions    GET    the project's own questions, every state
 *   addProjectQuestion      POST   one question; at most OPEN_QUESTIONS_MAX open on a project; an optional cause_key finds the live one again
 *   patchProjectQuestion    PATCH  change the Context, or withdraw, while it is open
 *   answerProjectQuestion   POST   Mike's answer (his session, or the chat lane relaying his words), or Dox recording an answer with its source
 *
 * What a project question does not do: it blocks no cards, is never sent to a client and never goes ahead on a date (those belong to a card
 * question, which has a card to hold and a thread to answer on). An answer writes no comment (there is no card to comment on); when Dox asked
 * the question, the answer stamps the project's refresh request, so his next pass on the project is an event sweep and the snapshot hands him
 * the answer (lib/engagement/snapshot.ts, project_questions).
 */
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { ApiError } from '@/lib/api/errors';
import type { AuthPayload } from '@/lib/auth/middleware';
import { MIKE_USER_ID, BOT_USER_IDS } from '@/lib/oracle/projects/gate-constants';
import { createNotification } from '@/lib/services/notifications';
import { DOX_USER_ID, isDoxLaneValue } from '@/lib/dox/identity';
import {
  ANSWER_SOURCE_MESSAGE,
  MIKE_NAMES_RE,
  QUESTION_INCLUDE,
  QUESTION_MESSAGES,
  formatQuestion,
  isChatLane,
  isDoxAnswer,
  mayAnswerQuestions,
  type QuestionOut,
} from '@/lib/tasks/questions';
import {
  OPEN_QUESTIONS_MAX,
  answerWords,
  optionOf,
  questionContextSchema,
  type QuestionAnswerBody,
  type QuestionContext,
  type QuestionPatch,
} from '@/lib/tasks/question-context';

type Auth = Pick<AuthPayload, 'userId' | 'role' | 'via' | 'lane' | 'laneEnforced'>;
type ProjectHead = { id: string };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const PROJECT_QUESTION_MESSAGES = {
  tooMany: `A project holds at most ${OPEN_QUESTIONS_MAX} open questions of its own. Ask the most important ones first.`,
  duplicate: 'That question is already on this project.',
  noGoAhead: 'A project question waits for its answer: it cannot go with a recommendation on its own.',
} as const;

/** Staff who run projects: a pm or admin, Mike, the chat lane, or a bot key (the lane list decides which bot lanes reach the route at all). */
function isStaff(auth: Auth): boolean {
  return auth.role === 'pm' || auth.role === 'admin' || auth.userId === MIKE_USER_ID || isChatLane(auth) || BOT_USER_IDS.includes(auth.userId);
}

/** Reading and asking are for staff; everyone else gets the same 404 a missing project gives. */
export function assertProjectQuestionStaff(auth: Auth): void {
  if (!isStaff(auth)) throw new ApiError('Project not found', 404);
}

/** The project a question route works on, or a 404. */
export async function loadQuestionProject(projectId: string): Promise<{ id: string; status: string; name: string }> {
  if (!UUID_RE.test(projectId)) throw new ApiError('Project not found', 404);
  const project = await prisma.project.findFirst({ where: { id: projectId, is_deleted: false }, select: { id: true, status: true, name: true } });
  if (!project) throw new ApiError('Project not found', 404);
  return project;
}

export async function listProjectQuestions(project: ProjectHead, auth: Auth): Promise<{ questions: QuestionOut[]; open_count: number }> {
  assertProjectQuestionStaff(auth);
  const rows = await prisma.taskQuestion.findMany({
    where: { project_id: project.id, task_id: null },
    orderBy: [{ position: 'asc' }, { created_at: 'asc' }],
    include: QUESTION_INCLUDE,
  });
  return { questions: rows.map(formatQuestion), open_count: rows.filter((r) => r.state === 'open').length };
}

export async function addProjectQuestion(project: ProjectHead, auth: Auth, body: QuestionContext, causeKey?: string | null): Promise<QuestionOut> {
  assertProjectQuestionStaff(auth);
  if (body.if_nobody_action !== 'wait') throw new ApiError(PROJECT_QUESTION_MESSAGES.noGoAhead, 400, 'project_question_waits');
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM projects WHERE id = ${project.id}::uuid FOR UPDATE`;
    if (causeKey) {
      // One live question per cause across the whole project, its cards included: the same lock a project-scope card question takes.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'dox-cause:' + causeKey}))`;
      const existing = await tx.taskQuestion.findFirst({
        where: { cause_key: causeKey, state: { not: 'withdrawn' }, OR: [{ project_id: project.id }, { task: { project_id: project.id, is_deleted: false } }] },
        orderBy: { created_at: 'asc' },
        include: QUESTION_INCLUDE,
      });
      if (existing) return { ...formatQuestion(existing), deduped: true };
    }
    const open = await tx.taskQuestion.count({ where: { project_id: project.id, task_id: null, state: 'open' } });
    if (open >= OPEN_QUESTIONS_MAX) throw new ApiError(PROJECT_QUESTION_MESSAGES.tooMany, 409, 'too_many_open');
    const same = await tx.taskQuestion.findFirst({ where: { project_id: project.id, task_id: null, question: body.question, state: { not: 'withdrawn' } }, select: { id: true } });
    if (same) throw new ApiError(PROJECT_QUESTION_MESSAGES.duplicate, 409, 'duplicate_question');
    const last = await tx.taskQuestion.aggregate({ where: { project_id: project.id, task_id: null }, _max: { position: true } });
    const hasOptions = !!body.options && body.options.length > 0;
    const row = await tx.taskQuestion.create({
      data: {
        project_id: project.id,
        position: (last._max.position ?? -1) + 1,
        question: body.question,
        what_it_is: body.what_it_is,
        sources: body.sources as unknown as Prisma.InputJsonValue,
        checked: body.checked,
        unknown: body.unknown,
        options: hasOptions ? (body.options as unknown as Prisma.InputJsonValue) : Prisma.DbNull,
        recommended_option_id: hasOptions ? body.recommended_option_id ?? null : null,
        recommend_why: body.recommend_why?.trim() || null,
        if_nobody: body.if_nobody,
        if_nobody_action: 'wait',
        asked_by_user_id: auth.userId,
        asked_by_lane: auth.lane ? auth.lane.slice(0, 40) : null,
        cause_key: causeKey ?? null,
      },
      include: QUESTION_INCLUDE,
    });
    return formatQuestion(row);
  });
}

/** Mike, the chat lane, a bot key, or the person who asked it. */
function isOwnerish(auth: Auth, row: { asked_by_user_id: string | null }): boolean {
  return auth.userId === MIKE_USER_ID || isChatLane(auth) || BOT_USER_IDS.includes(auth.userId) || row.asked_by_user_id === auth.userId;
}

function mergeContext(row: Prisma.TaskQuestionGetPayload<object>, patch: QuestionPatch): unknown {
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

/** Withdraw (reason kept) or change the Context of an open project question. Dox changes the wording of his own questions only. */
export async function patchProjectQuestion(project: ProjectHead, qid: string, auth: Auth, patch: QuestionPatch): Promise<QuestionOut> {
  assertProjectQuestionStaff(auth);
  if (!UUID_RE.test(qid)) throw new ApiError(QUESTION_MESSAGES.notFound, 404);
  // A drafted nudge belongs to a question we sent a client; a project question is never sent.
  const { nudge_drafted: _nudge, ...contextPatch } = patch;
  void _nudge;
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM projects WHERE id = ${project.id}::uuid FOR UPDATE`;
    const row = await tx.taskQuestion.findFirst({ where: { id: qid, project_id: project.id, task_id: null } });
    if (!row || !isOwnerish(auth, row)) throw new ApiError(QUESTION_MESSAGES.notFound, 404);
    if (row.state === 'withdrawn') throw new ApiError(QUESTION_MESSAGES.closed, 409, 'withdrawn');
    if (row.state !== 'open') throw new ApiError(QUESTION_MESSAGES.notOpen, 409, 'not_open');
    if (patch.withdraw) {
      const updated = await tx.taskQuestion.update({
        where: { id: row.id },
        data: { state: 'withdrawn', withdrawn_at: new Date(), withdrawn_reason: (patch.reason ?? '').trim() || 'Withdrawn by the asker.' },
        include: QUESTION_INCLUDE,
      });
      return formatQuestion(updated);
    }
    if (isDoxLaneValue(auth.lane) && !isDoxLaneValue(row.asked_by_lane)) {
      throw new ApiError('Dox changes the wording of his own questions only; another\'s he can withdraw once it is answered elsewhere.', 403, 'dox_question_closed');
    }
    const merged = questionContextSchema.parse(mergeContext(row, contextPatch));
    if (merged.if_nobody_action !== 'wait') throw new ApiError(PROJECT_QUESTION_MESSAGES.noGoAhead, 400, 'project_question_waits');
    if (merged.question !== row.question) {
      const same = await tx.taskQuestion.findFirst({ where: { project_id: project.id, task_id: null, question: merged.question, state: { not: 'withdrawn' }, id: { not: row.id } }, select: { id: true } });
      if (same) throw new ApiError(PROJECT_QUESTION_MESSAGES.duplicate, 409, 'duplicate_question');
    }
    const hasOptions = !!merged.options && merged.options.length > 0;
    const updated = await tx.taskQuestion.update({
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
      },
      include: QUESTION_INCLUDE,
    });
    return formatQuestion(updated);
  });
}

export interface ProjectAnswerResult {
  question: QuestionOut;
  /** Always empty: a project question holds no cards. Present so the screen reads one shape for both kinds of answer. */
  released_task_ids: string[];
  /** True when the answer was handed to Dox (he asked the question): his next pass on the project reads it. */
  handed_to_dox: boolean;
}

/**
 * Mike's answer, or Dox's record of an answer someone else gave (with its source, never as Mike's word). Answering again replaces the answer.
 * No comment is written: there is no card. When Dox asked the question and someone else answered, the project's refresh is stamped.
 */
export async function answerProjectQuestion(project: ProjectHead, qid: string, auth: Auth, body: QuestionAnswerBody, now: Date = new Date()): Promise<ProjectAnswerResult> {
  assertProjectQuestionStaff(auth);
  const viaDox = isDoxAnswer(auth);
  if (!mayAnswerQuestions(auth) && !viaDox) throw new ApiError(QUESTION_MESSAGES.notYours, 403, 'not_mike');
  if (viaDox) {
    if (!body.source) throw new ApiError(ANSWER_SOURCE_MESSAGE, 422, 'answer_source_required');
    if (MIKE_NAMES_RE.test(body.source.who)) throw new ApiError('Dox does not record Mike\'s word: Mike answers on the project or through the chat.', 422, 'answer_source_mike');
  }
  if (!UUID_RE.test(qid)) throw new ApiError(QUESTION_MESSAGES.notFound, 404);
  const text = (body.text ?? '').trim();
  const out = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM projects WHERE id = ${project.id}::uuid FOR UPDATE`;
    const row = await tx.taskQuestion.findFirst({ where: { id: qid, project_id: project.id, task_id: null } });
    if (!row) throw new ApiError(QUESTION_MESSAGES.notFound, 404);
    if (row.state === 'withdrawn') throw new ApiError(QUESTION_MESSAGES.closed, 409, 'withdrawn');
    if (viaDox && row.state === 'answered') throw new ApiError('That question is already answered.', 409, 'already_answered');
    if (row.updated_at.toISOString() !== body.version) throw new ApiError(QUESTION_MESSAGES.changed, 409, 'question_changed');
    let opt = null;
    if (body.option_id) {
      opt = optionOf(row.options, body.option_id);
      if (!opt) throw new ApiError(QUESTION_MESSAGES.badOption, 400, 'bad_option');
    }
    const updated = await tx.taskQuestion.update({
      where: { id: row.id },
      data: {
        state: 'answered',
        answer_option_id: opt ? opt.id : null,
        answer_text: answerWords(opt, text),
        answered_at: now,
        answered_by_id: viaDox ? auth.userId : MIKE_USER_ID,
        defaulted_at: null,
      },
      include: QUESTION_INCLUDE,
    });
    const askedByDox = row.asked_by_user_id === DOX_USER_ID || isDoxLaneValue(row.asked_by_lane);
    const handed = askedByDox && !viaDox;
    if (handed) await tx.project.updateMany({ where: { id: project.id, is_deleted: false }, data: { next_step_refresh_requested_at: now } });
    return { updated, askerId: row.asked_by_user_id, handed };
  });

  const asker = out.askerId;
  if (asker && asker !== MIKE_USER_ID && asker !== auth.userId && !BOT_USER_IDS.includes(asker)) {
    try {
      await createNotification({
        userId: asker,
        type: 'comment_added',
        title: viaDox ? 'An answer was recorded on your question' : 'Mike answered your question',
        message: out.updated.question,
        entityType: 'project',
        entityId: project.id,
        actorUserId: auth.userId,
      });
    } catch {
      // the answer is saved; a missed notice is not a failed answer
    }
  }
  return { question: formatQuestion(out.updated), released_task_ids: [], handed_to_dox: out.handed };
}

// @vitest-environment node
/**
 * POST /api/tasks/:id/questions/:qid/answer from the front session, against a real scratch Postgres (Mike, 2026-11-24, front session chat:
 * "make a quick task for bast to fix that issue in Citadel so we can answer questions from here"). The front session's enforced lane key and
 * Mike's own API key answer with his words, and the comment starts "From Mike, through the front session: "; every other key is refused.
 */
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { NextRequest } from 'next/server';
import type { Mock } from 'vitest';

vi.mock('@/lib/auth/middleware', async (orig) => ({
  ...(await orig<typeof import('@/lib/auth/middleware')>()),
  requireAuth: vi.fn(),
}));

import { prisma } from '@/lib/db/prisma';
import { requireAuth, type AuthPayload } from '@/lib/auth/middleware';
import { SCRATCH } from '@/lib/engine/__tests__/seed';
import { BAST_USER_ID, MIKE_USER_ID } from '@/lib/oracle/projects/gate-constants';
import { FRONT_SESSION_ANSWER_PREFIX, HELD_TAG, HELD_NEEDS_MIKE_MARK, NEEDS_MIKE_TAG } from '@/lib/tasks/questions';
import { POST } from '../route';

const authMock = requireAuth as Mock;
const params = (id: string, qid: string) => ({ params: Promise.resolve({ id, qid }) });
const post = (id: string, qid: string, body: unknown) =>
  POST(new NextRequest(new URL(`http://localhost/api/tasks/${id}/questions/${qid}/answer`), { method: 'POST', body: JSON.stringify(body) } as never), params(id, qid));

describe.skipIf(!SCRATCH)('answering a card question from the front session (real database)', () => {
  const tag = `fsa${Date.now()}`;
  const ids: string[] = [];
  let otherId: string;

  const front = (): AuthPayload => ({ userId: BAST_USER_ID, role: 'pm', email: 'bast@test', via: 'api_key', apiKeyId: 'kf', lane: 'front-session', laneEnforced: true });
  const mikeKey = (): AuthPayload => ({ userId: MIKE_USER_ID, role: 'admin', email: 'mike@test', via: 'api_key', apiKeyId: 'k0' });

  const mkTask = async (title: string, data: Record<string, unknown> = {}) => {
    const t = await prisma.task.create({ data: { title: `${tag} ${title}`, status: 'triage', ...data } as never });
    ids.push(t.id);
    return t.id;
  };
  const mkQuestion = (taskId: string, question: string, position = 0) =>
    prisma.taskQuestion.create({
      data: {
        task_id: taskId,
        position,
        question,
        what_it_is: 'The web copy rules need a decision before the agent rules are written.',
        sources: [],
        checked: 'The guide was read.',
        unknown: 'Which rule set wins.',
        if_nobody: 'The card waits.',
        if_nobody_action: 'wait',
        asked_by_user_id: BAST_USER_ID,
      },
    });
  const comments = (id: string) => prisma.comment.findMany({ where: { task_id: id }, orderBy: { created_at: 'asc' } });

  beforeAll(async () => {
    await prisma.user.upsert({ where: { id: MIKE_USER_ID }, update: {}, create: { id: MIKE_USER_ID, email: `mike-${tag}@example.test`, password_hash: 'x', name: 'Mike', role: 'admin' } });
    await prisma.user.upsert({ where: { id: BAST_USER_ID }, update: {}, create: { id: BAST_USER_ID, email: `bast-${tag}@example.test`, password_hash: 'x', name: 'Bast', role: 'pm' } });
    otherId = (await prisma.user.create({ data: { email: `oth-${tag}@example.test`, password_hash: 'x', name: 'Other', role: 'admin' } })).id;
  });
  afterAll(async () => {
    await prisma.triageChange.deleteMany({ where: { task_id: { in: ids } } });
    await prisma.taskQuestion.deleteMany({ where: { task_id: { in: ids } } });
    await prisma.comment.deleteMany({ where: { task_id: { in: ids } } });
    await prisma.notification.deleteMany({ where: { entity_id: { in: ids } } });
    await prisma.activityLog.deleteMany({ where: { entity_id: { in: ids } } });
    await prisma.task.deleteMany({ where: { id: { in: ids } } });
    await prisma.user.deleteMany({ where: { id: otherId } });
    await prisma.$disconnect();
  });

  it('the front-session lane key answers with Mike\'s words; the comment starts "From Mike, through the front session:"; the hold comes off', async () => {
    const t = await mkTask('front lane', { status: 'not_started', tags: ['keep', HELD_TAG, NEEDS_MIKE_TAG, HELD_NEEDS_MIKE_MARK] });
    const q = await mkQuestion(t, 'Should the agent rules follow the guide word for word?');
    authMock.mockResolvedValue(front());
    const res = await post(t, q.id, { version: q.updated_at.toISOString(), text: 'Yes, word for word.' });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.hold_released).toBe(true);
    const [c] = await comments(t);
    expect(c.id).toBe(body.comment_id);
    expect(c.content).toBe(`${FRONT_SESSION_ANSWER_PREFIX}Answer on "Should the agent rules follow the guide word for word?": Yes, word for word.`);
    expect(c.content.startsWith('From Mike, through the front session: ')).toBe(true);
    expect([c.user_id, c.actor_lane, c.is_internal, c.client_visible, c.client_question]).toEqual([BAST_USER_ID, 'front-session', true, false, false]);
    const row = await prisma.taskQuestion.findUniqueOrThrow({ where: { id: q.id } });
    expect(row).toMatchObject({ state: 'answered', answer_text: 'Yes, word for word.', answered_by_id: MIKE_USER_ID, answer_comment_id: c.id });
    expect(body.question.citation).toContain('"Yes, word for word."');
    expect((await prisma.task.findUniqueOrThrow({ where: { id: t } })).tags).toEqual(['keep']);
  });

  it('the front-session lane key answers on a card still in Triage', async () => {
    const t = await mkTask('front lane triage');
    const q = await mkQuestion(t, 'Is the guide the final word?');
    authMock.mockResolvedValue(front());
    const res = await post(t, q.id, { version: q.updated_at.toISOString(), text: 'It is.' });
    expect(res.status).toBe(200);
    expect((await comments(t))[0].content).toBe(`${FRONT_SESSION_ANSWER_PREFIX}Answer on "Is the guide the final word?": It is.`);
  });

  it('Mike\'s own API key answers with the same prefix, written as Mike; while another wait question is open it is written as Bast', async () => {
    const t = await mkTask('mike key', { status: 'not_started' });
    const a = await mkQuestion(t, 'First question?', 0);
    const b = await mkQuestion(t, 'Second question?', 1);
    authMock.mockResolvedValue(mikeKey());
    const first = await post(t, a.id, { version: a.updated_at.toISOString(), text: 'One.' });
    expect(first.status).toBe(200);
    const last = await post(t, b.id, { version: b.updated_at.toISOString(), text: 'Two.' });
    expect(last.status).toBe(200);
    const [c1, c2] = await comments(t);
    expect(c1.content).toBe(`${FRONT_SESSION_ANSWER_PREFIX}Answer on "First question?": One.`);
    expect(c1.user_id).toBe(BAST_USER_ID); // the card must not wake while the second question still waits
    expect(c2.content).toBe(`${FRONT_SESSION_ANSWER_PREFIX}Answer on "Second question?": Two.`);
    expect(c2.user_id).toBe(MIKE_USER_ID); // the last answer is the waking comment
    for (const id of [a.id, b.id]) expect((await prisma.taskQuestion.findUniqueOrThrow({ where: { id } })).answered_by_id).toBe(MIKE_USER_ID);
  });

  it('every other key is refused with 403 not_mike and nothing is stored', async () => {
    const t = await mkTask('refused', { status: 'not_started' });
    const q = await mkQuestion(t, 'Who may answer this?');
    const others: AuthPayload[] = [
      // another bot key: Bast with no lane, the worker lane, the triage desk
      { userId: BAST_USER_ID, role: 'pm', email: 'bast@test', via: 'api_key', apiKeyId: 'k1' },
      { userId: BAST_USER_ID, role: 'pm', email: 'bast@test', via: 'api_key', apiKeyId: 'k2', lane: 'bast', laneEnforced: true },
      { userId: BAST_USER_ID, role: 'pm', email: 'bast@test', via: 'api_key', apiKeyId: 'k3', lane: 'triage-desk', laneEnforced: true },
      // a front-session scope that is not enforced, or not on an API key, or on someone else's key
      { userId: BAST_USER_ID, role: 'pm', email: 'bast@test', via: 'api_key', apiKeyId: 'k4', lane: 'front-session', laneEnforced: false },
      { userId: BAST_USER_ID, role: 'pm', email: 'bast@test', via: 'session', lane: 'front-session', laneEnforced: true },
      { userId: otherId, role: 'admin', email: 'o@test', via: 'api_key', apiKeyId: 'k5', lane: 'front-session', laneEnforced: true },
      // Mike's key with a lane on it is not his own key; another admin's key and session
      { userId: MIKE_USER_ID, role: 'admin', email: 'mike@test', via: 'api_key', apiKeyId: 'k6', lane: 'bast' },
      { userId: otherId, role: 'admin', email: 'o@test', via: 'api_key', apiKeyId: 'k7' },
      { userId: otherId, role: 'admin', email: 'o@test', via: 'session' },
    ];
    for (const a of others) {
      authMock.mockResolvedValue(a);
      const res = await post(t, q.id, { version: q.updated_at.toISOString(), text: 'Me.' });
      expect(res.status, JSON.stringify(a)).toBe(403);
      expect((await res.json()).code, JSON.stringify(a)).toBe('not_mike');
    }
    expect((await prisma.taskQuestion.findUniqueOrThrow({ where: { id: q.id } })).state).toBe('open');
    expect(await comments(t)).toHaveLength(0);
  });
});

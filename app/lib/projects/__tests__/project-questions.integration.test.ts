// @vitest-environment node
/**
 * Project questions (a question asked on the project itself, with no card), through the real routes against a scratch Postgres: who may ask,
 * read, answer, change and withdraw; that an answer to a question Dox asked is handed to him; and that the lists that show a project's
 * questions (GET /api/questions, the Dox snapshot, the Communication timeline) carry both kinds without breaking a card question.
 */
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { NextRequest } from 'next/server';
import type { Mock } from 'vitest';

vi.mock('@/lib/auth/middleware', async (orig) => ({ ...(await orig<typeof import('@/lib/auth/middleware')>()), requireAuth: vi.fn() }));
vi.mock('@/lib/auth/actor-lane', () => ({ actorLaneField: vi.fn(async () => ({ actor_lane: null })), currentActorLane: vi.fn(async () => null) }));

import { prisma } from '@/lib/db/prisma';
import { requireAuth, type AuthPayload } from '@/lib/auth/middleware';
import { SCRATCH } from '@/lib/engine/__tests__/seed';
import { GET as listProjectQ, POST as askProjectQ } from '@/app/api/projects/[id]/questions/route';
import { PATCH as patchProjectQ } from '@/app/api/projects/[id]/questions/[qid]/route';
import { POST as answerProjectQ } from '@/app/api/projects/[id]/questions/[qid]/answer/route';
import { POST as askCardQ } from '@/app/api/tasks/[id]/questions/route';
import { GET as listAll } from '@/app/api/questions/route';
import { buildProjectSnapshot } from '@/lib/engagement/snapshot';
import { loadProjectCommunication } from '@/lib/projects/communication';
import { chatLane, dox, idParams, makeFixture, mikeSession, type Fx } from '@/lib/dox/__tests__/fixture';

const authMock = requireAuth as Mock;
const as = (a: AuthPayload) => authMock.mockResolvedValue(a);
const session = (id: string, role: 'pm' | 'admin' | 'tech'): AuthPayload => ({ userId: id, role, email: `${role}@test`, via: 'session' });
const qp = (id: string, qid: string) => ({ params: Promise.resolve({ id, qid }) });
const call = (body?: unknown, method = 'POST', url = 'http://localhost/api/x') => new NextRequest(url, { method, body: body === undefined ? undefined : JSON.stringify(body) });
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const json = async (res: Response) => ({ status: res.status, body: (await res.json()) as Record<string, any> });

const CONTEXT = {
  what_it_is: 'The store can ship from our own stock or straight from the printer.',
  sources: [{ who: 'Brian', said: 'I have not decided how orders get shipped yet.', at: '2026-11-20' }],
  checked: 'The signed proposal and the commerce plan: neither says how orders ship.',
  unknown: 'Which way the client wants orders shipped.',
  if_nobody: 'No shipping cards are made until this is answered.',
  if_nobody_action: 'wait' as const,
};
const SOURCE = { who: 'Brian Hernon (client)', said: 'Ship everything straight from the printer.', at: '2026-11-22' };

describe.skipIf(!SCRATCH)('project questions (real database)', () => {
  let fx: Fx;
  let LIVE: string;
  let OTHER: string;
  let SUSPENDED: string;
  let pm: string;
  let techUser: string;

  beforeAll(async () => {
    fx = await makeFixture('pq');
    LIVE = await fx.mkProject('Live', { status: 'in_progress' });
    OTHER = await fx.mkProject('Other', { status: 'in_progress' });
    SUSPENDED = await fx.mkProject('Suspended', { status: 'suspended' });
    pm = await fx.mkStaff('Sabeen', 'pm');
    techUser = await fx.mkStaff('Tess', 'tech');
  });

  afterAll(async () => {
    await prisma.notification.deleteMany({ where: { entity_id: { in: fx.projectIds } } });
    await fx.cleanup();
    await prisma.$disconnect();
  });

  it('a pm asks a question on the project: it has no card, waits for its answer, and reads back', async () => {
    as(session(pm, 'pm'));
    const q = await json(await askProjectQ(call({ ...CONTEXT, question: 'Do orders ship from our stock or from the printer?' }), idParams(LIVE)));
    expect(q.status, JSON.stringify(q.body)).toBe(201);
    expect(q.body).toMatchObject({ task_id: null, project_id: LIVE, state: 'open', if_nobody_action: 'wait', asked_by_user_id: pm, blocks: [] });
    const row = await prisma.taskQuestion.findUniqueOrThrow({ where: { id: q.body.id } });
    expect([row.task_id, row.project_id]).toEqual([null, LIVE]);

    const list = await json(await listProjectQ(call(undefined, 'GET'), idParams(LIVE)));
    expect(list.status).toBe(200);
    expect(list.body.open_count).toBe(1);
    expect(list.body.questions.map((x: { id: string }) => x.id)).toEqual([q.body.id]);
    // another project's list does not carry it
    expect((await json(await listProjectQ(call(undefined, 'GET'), idParams(OTHER)))).body.questions).toEqual([]);
  });

  it('refuses a thin question, the same question twice, a go-ahead question, a tech, and a project that does not exist', async () => {
    as(session(pm, 'pm'));
    const thin = await json(await askProjectQ(call({ ...CONTEXT, checked: 'n/a', question: 'Is this thin?' }), idParams(LIVE)));
    expect(thin.status).toBe(400);
    const twice = await json(await askProjectQ(call({ ...CONTEXT, question: 'Do orders ship from our stock or from the printer?' }), idParams(LIVE)));
    expect([twice.status, twice.body.code]).toEqual([409, 'duplicate_question']);
    const go = await json(
      await askProjectQ(
        call({
          ...CONTEXT,
          question: 'Should the store open before the holidays?',
          options: [
            { id: 'yes', label: 'Open before', consequence: 'The launch moves up two weeks.' },
            { id: 'no', label: 'Open after', consequence: 'The launch stays where it is.' },
          ],
          recommended_option_id: 'no',
          recommend_why: 'The current date is the one the client agreed to.',
          if_nobody_action: 'go_with_recommendation',
        }),
        idParams(LIVE),
      ),
    );
    expect([go.status, go.body.code]).toEqual([400, 'project_question_waits']);
    as(session(techUser, 'tech'));
    expect((await askProjectQ(call({ ...CONTEXT, question: 'May a tech ask here?' }), idParams(LIVE))).status).toBe(404);
    expect((await listProjectQ(call(undefined, 'GET'), idParams(LIVE))).status).toBe(404);
    as(mikeSession());
    expect((await askProjectQ(call({ ...CONTEXT, question: 'Is anybody home?' }), idParams('00000000-0000-4000-8000-000000000000'))).status).toBe(404);
    expect(await prisma.taskQuestion.count({ where: { project_id: LIVE, task_id: null } })).toBe(1);
  });

  it('the database refuses a question with no home, and one with two', async () => {
    const base = { question: 'Where does this live?', what_it_is: 'x', sources: [], checked: 'x', unknown: 'x', if_nobody: 'x', if_nobody_action: 'wait' as const };
    await expect(prisma.taskQuestion.create({ data: { ...base } })).rejects.toThrow();
    const card = await fx.mkTask('Card', { project_id: LIVE, status: 'not_started' });
    await expect(prisma.taskQuestion.create({ data: { ...base, task_id: card, project_id: LIVE } })).rejects.toThrow();
  });

  it('only Mike answers; his answer is stored with no comment, and a pm who asked is told', async () => {
    as(session(pm, 'pm'));
    const q = await json(await askProjectQ(call({ ...CONTEXT, question: 'Who signs off on the store copy?' }), idParams(LIVE)));
    const refused = await json(await answerProjectQ(call({ version: q.body.version, text: 'I do.' }), qp(LIVE, q.body.id)));
    expect([refused.status, refused.body.code]).toEqual([403, 'not_mike']);
    as(mikeSession());
    const stale = await json(await answerProjectQ(call({ version: '2020-01-01T00:00:00.000Z', text: 'Brian does.' }), qp(LIVE, q.body.id)));
    expect([stale.status, stale.body.code]).toEqual([409, 'question_changed']);
    const wrongProject = await answerProjectQ(call({ version: q.body.version, text: 'Brian does.' }), qp(OTHER, q.body.id));
    expect(wrongProject.status).toBe(404);
    const before = await prisma.comment.count();
    const ans = await json(await answerProjectQ(call({ version: q.body.version, text: 'Brian does.' }), qp(LIVE, q.body.id)));
    expect(ans.status, JSON.stringify(ans.body)).toBe(200);
    expect(ans.body).toMatchObject({ released_task_ids: [], handed_to_dox: false, question: { state: 'answered', answer_text: 'Brian does.', project_id: LIVE, task_id: null } });
    expect(ans.body.question.citation).toContain('Brian does.');
    expect(await prisma.comment.count()).toBe(before);
    expect(await prisma.notification.count({ where: { user_id: pm, entity_id: LIVE, entity_type: 'project' } })).toBe(1);
    // the chat lane relays his words the same way
    as(session(pm, 'pm'));
    const q2 = await json(await askProjectQ(call({ ...CONTEXT, question: 'Does the store need gift cards at launch?' }), idParams(LIVE)));
    as(chatLane());
    const viaChat = await json(await answerProjectQ(call({ version: q2.body.version, text: 'Not at launch.' }), qp(LIVE, q2.body.id)));
    expect([viaChat.status, viaChat.body.question.state]).toEqual([200, 'answered']);
  });

  it('Dox asks on a live project only, finds his open cause again, and is handed the answer', async () => {
    as(dox());
    const refused = await json(await askProjectQ(call({ ...CONTEXT, question: 'May Dox ask on a suspended project?' }), idParams(SUSPENDED)));
    expect([refused.status, refused.body.code]).toEqual([403, 'dox_project_closed']);
    const q = await json(await askProjectQ(call({ ...CONTEXT, question: 'Does the store sell to Canada at launch?', cause_key: 'store-canada' }), idParams(LIVE)));
    expect(q.status, JSON.stringify(q.body)).toBe(201);
    expect(q.body.asked_by_lane).toBe('dox');
    const again = await json(await askProjectQ(call({ ...CONTEXT, question: 'Does the store ship to Canada on day one?', cause_key: 'store-canada' }), idParams(LIVE)));
    expect([again.status, again.body.deduped, again.body.id]).toEqual([200, true, q.body.id]);
    // a card question with the same project-scope cause finds the project question too
    const card = await fx.mkTask('Shipping card', { project_id: LIVE, status: 'not_started' });
    const onCard = await json(await askCardQ(call({ ...CONTEXT, question: 'Is Canada in scope for shipping?', cause_key: 'store-canada', cause_scope: 'project' }), idParams(card)));
    expect([onCard.status, onCard.body.deduped, onCard.body.id]).toEqual([200, true, q.body.id]);

    await prisma.project.update({ where: { id: LIVE }, data: { next_step_refresh_requested_at: null } });
    as(mikeSession());
    const ans = await json(await answerProjectQ(call({ version: q.body.version, text: 'Yes, Canada from day one.' }), qp(LIVE, q.body.id)));
    expect(ans.status, JSON.stringify(ans.body)).toBe(200);
    expect(ans.body.handed_to_dox).toBe(true);
    expect((await prisma.project.findUniqueOrThrow({ where: { id: LIVE } })).next_step_refresh_requested_at).not.toBeNull();
    const snap = await buildProjectSnapshot(prisma, LIVE);
    const mine = snap!.project_questions.find((x) => x.id === q.body.id);
    expect(mine).toMatchObject({ state: 'answered', answer_text: 'Yes, Canada from day one.', asked_by_lane: 'dox', cause_key: 'store-canada' });
  });

  it('Dox records a client\'s answer with its source, never as Mike, and never over an answer already given', async () => {
    as(session(pm, 'pm'));
    const q = await json(await askProjectQ(call({ ...CONTEXT, question: 'Which printer fulfils the orders?' }), idParams(LIVE)));
    as(dox());
    expect((await json(await answerProjectQ(call({ version: q.body.version, text: 'Printful.' }), qp(LIVE, q.body.id)))).body.code).toBe('answer_source_required');
    expect((await json(await answerProjectQ(call({ version: q.body.version, text: 'Printful.', source: { ...SOURCE, who: 'Mike Dion' } }), qp(LIVE, q.body.id)))).body.code).toBe('answer_source_mike');
    const ans = await json(await answerProjectQ(call({ version: q.body.version, text: 'Printful.', source: SOURCE }), qp(LIVE, q.body.id)));
    expect(ans.status, JSON.stringify(ans.body)).toBe(200);
    expect(ans.body.question.citation).toBeNull();
    expect(ans.body.handed_to_dox).toBe(false);
    const again = await json(await answerProjectQ(call({ version: ans.body.question.version, text: 'Someone else.', source: SOURCE }), qp(LIVE, q.body.id)));
    expect([again.status, again.body.code]).toEqual([409, 'already_answered']);
  });

  it('the asker changes or withdraws an open question; nobody else\'s pm does, and a closed one stays closed', async () => {
    const otherPm = await fx.mkStaff('Ange', 'pm');
    as(session(pm, 'pm'));
    const q = await json(await askProjectQ(call({ ...CONTEXT, question: 'Is there a wholesale price list?' }), idParams(LIVE)));
    as(session(otherPm, 'pm'));
    expect((await patchProjectQ(call({ withdraw: true }, 'PATCH'), qp(LIVE, q.body.id))).status).toBe(404);
    as(session(pm, 'pm'));
    const changed = await json(await patchProjectQ(call({ question: 'Is there a wholesale price list for the store?' }, 'PATCH'), qp(LIVE, q.body.id)));
    expect([changed.status, changed.body.question]).toEqual([200, 'Is there a wholesale price list for the store?']);
    as(dox());
    const doxEdit = await json(await patchProjectQ(call({ question: 'Does Dox get to reword this one?' }, 'PATCH'), qp(LIVE, q.body.id)));
    expect([doxEdit.status, doxEdit.body.code]).toEqual([403, 'dox_question_closed']);
    const withdrawn = await json(await patchProjectQ(call({ withdraw: true, reason: 'Brian answered it by email.' }, 'PATCH'), qp(LIVE, q.body.id)));
    expect([withdrawn.status, withdrawn.body.state, withdrawn.body.withdrawn_reason]).toEqual([200, 'withdrawn', 'Brian answered it by email.']);
    as(mikeSession());
    expect((await json(await patchProjectQ(call({ withdraw: true }, 'PATCH'), qp(LIVE, q.body.id)))).body.code).toBe('withdrawn');
    expect((await json(await answerProjectQ(call({ version: withdrawn.body.version, text: 'Yes.' }), qp(LIVE, q.body.id)))).body.code).toBe('withdrawn');
  });

  it('GET /api/questions lists a project\'s own questions beside its card questions, each with its project', async () => {
    const P = await fx.mkProject('Listed', { status: 'in_progress' });
    const card = await fx.mkTask('Listed card', { project_id: P, status: 'not_started' });
    as(mikeSession());
    const onCard = await json(await askCardQ(call({ ...CONTEXT, question: 'Is the card question still listed?' }), idParams(card)));
    const onProject = await json(await askProjectQ(call({ ...CONTEXT, question: 'Is the project question listed too?' }), idParams(P)));
    const list = await json(await listAll(call(undefined, 'GET', `http://localhost/api/questions?state=open&for=all&project_id=${P}&include_triage=1`)));
    expect(list.status).toBe(200);
    expect(list.body.total).toBe(2);
    const byId = new Map<string, Record<string, unknown>>(list.body.questions.map((x: { id: string }) => [x.id, x]));
    expect(byId.get(onCard.body.id)).toMatchObject({ task_id: card, project_id: null, task: { id: card, project_id: P }, project: { id: P } });
    expect(byId.get(onProject.body.id)).toMatchObject({ task_id: null, project_id: P, task: null, project: { id: P } });
    // for=client never carries a project question (it is never sent to a client); for=mike does
    const forClient = await json(await listAll(call(undefined, 'GET', `http://localhost/api/questions?for=client&project_id=${P}`)));
    expect(forClient.body.total).toBe(0);
    const forMike = await json(await listAll(call(undefined, 'GET', `http://localhost/api/questions?for=mike&project_id=${P}`)));
    expect(forMike.body.total).toBe(2);
    // with no project filter it is still listed, and a deleted project's question is not
    const all = await json(await listAll(call(undefined, 'GET', 'http://localhost/api/questions?limit=500')));
    expect(all.body.questions.some((x: { id: string }) => x.id === onProject.body.id)).toBe(true);
    await prisma.project.update({ where: { id: P }, data: { is_deleted: true } });
    const afterDelete = await json(await listAll(call(undefined, 'GET', 'http://localhost/api/questions?limit=500')));
    expect(afterDelete.body.questions.some((x: { id: string }) => x.id === onProject.body.id)).toBe(false);
    await prisma.project.update({ where: { id: P }, data: { is_deleted: false } });
  });

  it('the Dox snapshot and the Communication timeline carry a project question without a card', async () => {
    const P = await fx.mkProject('Snapshot', { status: 'in_progress' });
    as(mikeSession());
    const q = await json(await askProjectQ(call({ ...CONTEXT, question: 'Does the snapshot show this question?' }), idParams(P)));
    const snap = await buildProjectSnapshot(prisma, P);
    expect(snap!.questions.find((x) => x.id === q.body.id)).toMatchObject({ task_id: null, task_title: null });
    expect(snap!.project_questions.map((x) => x.id)).toEqual([q.body.id]);
    expect(snap!.project_questions[0]).toMatchObject({ state: 'open', answer_text: null, version: q.body.version });
    const timeline = await loadProjectCommunication(P);
    expect(timeline.counts.question).toBe(1);
    expect(timeline.items.find((i) => i.id === q.body.id)).toMatchObject({ kind: 'question', card: null, href: `/projects/${P}`, state: 'open' });
  });

  it('holds ten open questions on a project and refuses the eleventh', async () => {
    const P = await fx.mkProject('Full', { status: 'in_progress' });
    as(mikeSession());
    for (let i = 0; i < 10; i++) {
      expect((await askProjectQ(call({ ...CONTEXT, question: `Is question number ${i} allowed here?` }), idParams(P))).status).toBe(201);
    }
    const over = await json(await askProjectQ(call({ ...CONTEXT, question: 'Is an eleventh question allowed here?' }), idParams(P)));
    expect([over.status, over.body.code]).toEqual([409, 'too_many_open']);
  });
});

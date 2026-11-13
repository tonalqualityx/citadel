// @vitest-environment node
/**
 * Dox slice 1 against a real scratch Postgres, through the real routes: what the lane may write (and the refusals), the lane stamp on comments
 * and questions, cause_key dedupe, the project snapshot, the brief, and the project dates on the Triage card.
 */
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { NextRequest } from 'next/server';
import type { Mock } from 'vitest';

vi.mock('@/lib/auth/middleware', async (orig) => ({ ...(await orig<typeof import('@/lib/auth/middleware')>()), requireAuth: vi.fn() }));
// The project route's formatter loads a module by a path alias that plain node cannot resolve; the response body is not what these tests read.
vi.mock('@/lib/api/formatters', async (orig) => ({ ...(await orig<typeof import('@/lib/api/formatters')>()), formatProjectResponse: (p: { id: string }) => ({ id: p.id }) }));
// The comment route reads the lane off the bearer key through next/headers; outside a request it is the key's lane we say it is.
vi.mock('@/lib/auth/actor-lane', () => ({ actorLaneField: vi.fn(async () => ({ actor_lane: 'dox' })), currentActorLane: vi.fn(async () => 'dox') }));

import { prisma } from '@/lib/db/prisma';
import { requireAuth, type AuthPayload } from '@/lib/auth/middleware';
import { SCRATCH } from '@/lib/engine/__tests__/seed';
import * as tasksRoute from '@/app/api/tasks/route';
import { PATCH as patchTask } from '@/app/api/tasks/[id]/route';
import { POST as addComment } from '@/app/api/tasks/[id]/comments/route';
import { POST as addQ } from '@/app/api/tasks/[id]/questions/route';
import { POST as answerQ } from '@/app/api/tasks/[id]/questions/[qid]/answer/route';
import { PATCH as patchProject } from '@/app/api/projects/[id]/route';
import { GET as getTriage, PATCH as patchTriage } from '@/app/api/tasks/[id]/triage/route';
import { GET as briefSnapshot } from '@/app/api/engagement-briefs/[id]/snapshot/route';
import { GET as projectSnapshot } from '@/app/api/projects/[id]/engagement-snapshot/route';
import { POST as startBrief } from '@/app/api/projects/[id]/engagement-brief/route';
import { PUT as putBrief } from '@/app/api/engagement-briefs/route';
import * as waitsRoute from '@/app/api/waits/route';
import { PATCH as patchWait } from '@/app/api/waits/[id]/route';
import { dox, mikeSession, chatLane, idParams, makeFixture, BOT_ID, type Fx } from './fixture';
import { MIKE_USER_ID } from '@/lib/oracle/projects/gate-constants';

const createTask = tasksRoute.POST;
const postWait = waitsRoute.POST;

const authMock = requireAuth as Mock;
const as = (a: AuthPayload) => authMock.mockResolvedValue(a);
const call = (project?: string, body?: unknown, method = 'POST') =>
  new NextRequest('http://localhost/api/x', { method, headers: project ? { 'x-dox-project': project } : {}, body: body === undefined ? undefined : JSON.stringify(body) });
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- response bodies are read loosely in these tests
const json = async (res: Response) => ({ status: res.status, body: (await res.json()) as Record<string, any> });

const CONTEXT = {
  what_it_is: 'The content review has no owner and the launch date is close.',
  sources: [{ who: 'Dox', said: 'No task in the review phase has an assignee', at: '2026-11-13' }],
  checked: 'Every open task of the project was read in the snapshot.',
  unknown: 'Whether Sabeen has room this week.',
  if_nobody: 'Dox assigns the review to Sabeen and notes it on the project.',
  if_nobody_action: 'go_with_recommendation' as const,
};
const q = (question: string, extra: Record<string, unknown> = {}) => ({
  ...CONTEXT,
  question,
  options: [
    { id: 'sabeen', label: 'Sabeen reviews', consequence: 'The review starts Monday.' },
    { id: 'lisa', label: 'Lisa reviews', consequence: 'The review starts after her current job.' },
  ],
  recommended_option_id: 'sabeen',
  recommend_why: 'Sabeen wrote the copy and knows it best.',
  ...extra,
});

describe.skipIf(!SCRATCH)('Dox slice 1 (real database)', () => {
  let fx: Fx;
  let P: string; // the project in play
  let OTHER: string; // another project
  let staff: string;

  beforeAll(async () => {
    fx = await makeFixture('dox');
    P = await fx.mkProject('Stronghold', { status: 'ready', plan_folder: '/home/mike/Documents/projects/stronghold' });
    OTHER = await fx.mkProject('Elsewhere', { status: 'in_progress' });
    staff = await fx.mkStaff('Sabeen');
    await fx.openPass(P);
    await fx.openPass(OTHER);
  });
  afterAll(async () => {
    await prisma.taskQuestion.deleteMany({ where: { task: { project_id: { in: fx.projectIds } } } });
    await prisma.taskQuestion.deleteMany({ where: { task_id: { in: fx.taskIds } } });
    await prisma.comment.deleteMany({ where: { task: { project_id: { in: fx.projectIds } } } });
    await prisma.comment.deleteMany({ where: { task_id: { in: fx.taskIds } } });
    await fx.cleanup();
    await prisma.$disconnect();
  });

  describe('writes on a project it is setting up', () => {
    it('creates a task as not_started with assignee, due date and phase; refuses Triage, the wrong project and closed fields', async () => {
      const phase = await prisma.projectPhase.create({ data: { project_id: P, name: 'Content', sort_order: 1 } });
      as(dox());
      const ok = await json(await createTask(call(P, { title: `${fx.tag} write copy`, project_id: P, assignee_id: staff, due_date: '2026-11-20T12:00:00.000Z', phase_id: phase.id, status: 'not_started' })));
      expect(ok.status, JSON.stringify(ok.body)).toBe(201);
      fx.taskIds.push(ok.body.id);
      const row = await prisma.task.findUniqueOrThrow({ where: { id: ok.body.id } });
      expect(row.status).toBe('not_started');
      expect(row.assignee_id).toBe(staff);
      expect(row.phase_id).toBe(phase.id);
      expect(row.project_id).toBe(P);

      for (const [body, status] of [
        [{ title: `${fx.tag} x`, project_id: P, status: 'triage' }, 403],
        [{ title: `${fx.tag} x`, project_id: OTHER }, 403],
        [{ title: `${fx.tag} x`, project_id: P, is_billable: true }, 403],
      ] as const) {
        const res = await createTask(call(P, body));
        expect(res.status, JSON.stringify(body)).toBe(status);
      }
      expect((await createTask(call(undefined, { title: `${fx.tag} x`, project_id: P }))).status).toBe(403);
      expect(await prisma.task.count({ where: { title: { startsWith: `${fx.tag} x` } } })).toBe(0);
    });

    it('sets assignee, due date and blockers on its own project and releases the holds; refuses a task of another project', async () => {
      const a = await fx.mkTask('A', { project_id: P, status: 'not_started', tags: ['cockpit-owned', 'needs-pm-release', 'from-triage', 'keep'] });
      const b = await fx.mkTask('B', { project_id: P, status: 'not_started' });
      const out = await fx.mkTask('Out', { project_id: OTHER, status: 'not_started' });
      as(dox());
      const ok = await json(await patchTask(call(P, { assignee_id: staff, due_date: '2026-11-21T12:00:00.000Z', blocked_by_ids: { connect: [b] }, tags_remove: ['cockpit-owned', 'needs-pm-release'] }, 'PATCH'), idParams(a)));
      expect(ok.status, JSON.stringify(ok.body)).toBe(200);
      const row = await prisma.task.findUniqueOrThrow({ where: { id: a }, include: { blocked_by: true } });
      expect(row.assignee_id).toBe(staff);
      expect(row.tags).toEqual(['from-triage', 'keep']);
      expect(row.blocked_by.map((x) => x.id)).toEqual([b]);

      const refused = await patchTask(call(P, { assignee_id: staff }, 'PATCH'), idParams(out));
      expect(refused.status).toBe(403);
      expect((await prisma.task.findUniqueOrThrow({ where: { id: out } })).assignee_id).toBeNull();
      expect((await patchTask(call(OTHER, { assignee_id: staff }, 'PATCH'), idParams(a))).status).toBe(403);
    });

    it('never moves a card out of Triage, never marks a task done, never edits the title', async () => {
      const card = await fx.mkTask('Card', { status: 'triage', project_id: P });
      const live = await fx.mkTask('Live', { status: 'in_progress', project_id: P });
      as(dox());
      expect((await patchTask(call(P, { status: 'not_started' }, 'PATCH'), idParams(card))).status).toBe(403);
      expect((await patchTask(call(P, { status: 'abandoned' }, 'PATCH'), idParams(card))).status).toBe(403);
      expect((await patchTask(call(P, { status: 'done' }, 'PATCH'), idParams(live))).status).toBe(403);
      expect((await patchTask(call(P, { title: 'renamed' }, 'PATCH'), idParams(live))).status).toBe(403);
      expect((await prisma.task.findUniqueOrThrow({ where: { id: card } })).status).toBe('triage');
      // the one thing it may do to a card in Triage: say it looks done
      const mark = await patchTask(call(undefined, { tags_add: ['triage:looks-done'] }, 'PATCH'), idParams(card));
      expect(mark.status).toBe(200);
      expect((await prisma.task.findUniqueOrThrow({ where: { id: card } })).tags).toContain('triage:looks-done');
      expect((await prisma.task.findUniqueOrThrow({ where: { id: card } })).status).toBe('triage');
    });

    it('sets the project dates and ordering-only, moves ready -> in_progress, closes only when every task is done', async () => {
      // A project Dox sets up is hidden from the portal (the ones it creates start that way): a project the portal shows is refused its dates and status.
      const proj = await fx.mkProject('Setup', { status: 'ready', portal_visibility: 'hidden' });
      await fx.openPass(proj);
      as(dox());
      const dates = await patchProject(call(proj, { start_date: '2026-11-10T12:00:00.000Z', target_date: '2026-11-30T12:00:00.000Z', dependencies_ordering_only: true, date_source: { kind: 'sow', label: 'Signed SOW v2' } }, 'PATCH'), idParams(proj));
      expect(dates.status).toBe(200);
      const row = await prisma.project.findUniqueOrThrow({ where: { id: proj } });
      expect(row.dependencies_ordering_only).toBe(true);
      expect(row.target_date?.toISOString().slice(0, 10)).toBe('2026-11-30');
      expect((await patchProject(call(proj, { name: 'x' }, 'PATCH'), idParams(proj))).status).toBe(403);
      expect((await patchProject(call(P, { target_date: '2026-12-01T12:00:00.000Z' }, 'PATCH'), idParams(proj))).status).toBe(403);
      expect((await patchProject(call(proj, { status: 'cancelled' }, 'PATCH'), idParams(proj))).status).toBe(403);
      expect((await patchProject(call(proj, { status: 'in_progress' }, 'PATCH'), idParams(proj))).status).toBe(200);
      const open = await fx.mkTask('open', { project_id: proj, status: 'in_progress' });
      const closeOpen = await json(await patchProject(call(proj, { status: 'done' }, 'PATCH'), idParams(proj)));
      expect(closeOpen.status).toBe(403);
      await prisma.task.update({ where: { id: open }, data: { status: 'done' } });
      expect((await patchProject(call(proj, { status: 'done' }, 'PATCH'), idParams(proj))).status).toBe(200);
      expect((await prisma.project.findUniqueOrThrow({ where: { id: proj } })).status).toBe('done');
      // queue -> ready is the owner's release
      const queued = await fx.mkProject('Queued', { status: 'queue' });
      expect((await patchProject(call(queued, { status: 'ready' }, 'PATCH'), idParams(queued))).status).toBe(403);
    });

    it('creates and updates a Wait, but not a price review and not a resolve as sent', async () => {
      const t = await fx.mkTask('Waits', { project_id: P, status: 'not_started' });
      as(dox());
      const made = await json(await postWait(call(P, { template_key: 'handoff.generic', subject: `${fx.tag} designer assets`, project_id: P, task_id: t, owner_user_id: staff, duration: { value: 3, unit: 'business_days' }, idempotency_key: `${fx.tag}-w1` })));
      expect([200, 201], JSON.stringify(made.body)).toContain(made.status);
      const id = (made.body.wait?.id ?? made.body.id) as string;
      expect(id).toBeTruthy();
      const redate = await patchWait(call(P, { action: 'redate', due_at: '2026-12-01T15:00:00.000Z', reason: 'The designer moved it.' }, 'PATCH'), idParams(id));
      expect(redate.status, JSON.stringify(await redate.clone().json())).toBe(200);
      expect((await postWait(call(P, { template_key: 'charter.price_review', subject: 'x' }))).status).toBe(403);
      expect((await patchWait(call(P, { action: 'resolve', resolution: 'sent' }, 'PATCH'), idParams(id))).status).toBe(403);
    });
  });

  describe('comments and questions carry the lane', () => {
    it('stamps actor_lane dox on a comment, forces it internal and refuses a client-visible one', async () => {
      const t = await fx.mkTask('Commented', { project_id: P, status: 'not_started' });
      as(dox());
      const ok = await json(await addComment(call(P, { content: 'Assigned to Sabeen. ~ Dox', is_internal: false }), idParams(t)));
      expect(ok.status).toBe(201);
      expect(ok.body.actor_lane).toBe('dox');
      expect(ok.body.is_internal).toBe(true);
      const row = await prisma.comment.findUniqueOrThrow({ where: { id: ok.body.id } });
      expect(row.actor_lane).toBe('dox');
      expect(row.is_internal).toBe(true);
      expect((await addComment(call(P, { content: 'Hello client', client_visible: true }), idParams(t))).status).toBe(403);
      expect((await addComment(call(P, { content: 'Question?', client_visible: true, client_question: true }), idParams(t))).status).toBe(403);
    });

    it('a comment is a task write: refused on a task outside the project in play, allowed with that project\'s own header', async () => {
      const t = await fx.mkTask('Other comment', { project_id: OTHER, status: 'not_started' });
      as(dox());
      expect((await addComment(call(P, { content: 'A note. ~ Dox' }), idParams(t))).status).toBe(403);
      expect((await addComment(call(undefined, { content: 'A note. ~ Dox' }), idParams(t))).status).toBe(403);
      expect((await addComment(call(OTHER, { content: 'A note. ~ Dox' }), idParams(t))).status).toBe(201);
    });

    it('stamps asked_by_lane dox on a question, and Dox cannot answer it', async () => {
      const t = await fx.mkTask('Asked', { project_id: P, status: 'not_started' });
      as(dox());
      const made = await json(await addQ(call(P, q('Who reviews the content?')), idParams(t)));
      expect(made.status, JSON.stringify(made.body)).toBe(201);
      expect(made.body.asked_by_lane).toBe('dox');
      const version = made.body.version as string;
      const answer = await answerQ(call(P, { version, option_id: 'sabeen' }), { params: Promise.resolve({ id: t, qid: made.body.id }) });
      expect(answer.status).toBe(403);
      expect((await prisma.taskQuestion.findUniqueOrThrow({ where: { id: made.body.id } })).state).toBe('open');
    });
  });

  describe('cause_key', () => {
    it('a repeat of an open cause on the card returns the existing question (200, deduped) and creates nothing', async () => {
      const t = await fx.mkTask('Cause card', { project_id: P, status: 'not_started' });
      as(dox());
      const first = await json(await addQ(call(P, q('Who owns the review phase?', { cause_key: 'stuck:review-no-owner' })), idParams(t)));
      expect(first.status).toBe(201);
      expect(first.body.cause_key).toBe('stuck:review-no-owner');
      const again = await json(await addQ(call(P, q('Who should own the review phase now?', { cause_key: 'stuck:review-no-owner' })), idParams(t)));
      expect(again.status).toBe(200);
      expect(again.body.id).toBe(first.body.id);
      expect(again.body.deduped).toBe(true);
      expect(await prisma.taskQuestion.count({ where: { task_id: t } })).toBe(1);
    });

    it('a different cause key is a new question; a withdrawn cause can be raised again; an ANSWERED cause is not asked twice (the answer comes back)', async () => {
      const t = await fx.mkTask('Cause two', { project_id: P, status: 'not_started' });
      as(dox());
      const a = await json(await addQ(call(P, q('Is the first cause real?', { cause_key: 'cause-a' })), idParams(t)));
      const b = await json(await addQ(call(P, q('Is the second cause real?', { cause_key: 'cause-b' })), idParams(t)));
      expect([a.status, b.status]).toEqual([201, 201]);
      expect(a.body.id).not.toBe(b.body.id);
      await prisma.taskQuestion.update({ where: { id: a.body.id }, data: { state: 'withdrawn', withdrawn_at: new Date(), withdrawn_reason: 'Cause went away.' } });
      const c = await json(await addQ(call(P, q('Is the first cause back again?', { cause_key: 'cause-a' })), idParams(t)));
      expect(c.status).toBe(201);
      expect(c.body.id).not.toBe(a.body.id);
      // settled: the answer is on the question that comes back, and nothing new is created
      await prisma.taskQuestion.update({ where: { id: b.body.id }, data: { state: 'answered', answer_option_id: 'sabeen', answered_at: new Date(), answered_by_id: MIKE_USER_ID } });
      const d = await json(await addQ(call(P, q('Is the second cause real, really?', { cause_key: 'cause-b' })), idParams(t)));
      expect(d.status).toBe(200);
      expect(d.body).toMatchObject({ id: b.body.id, deduped: true, state: 'answered', answer_option_id: 'sabeen' });
      expect(await prisma.taskQuestion.count({ where: { task_id: t, cause_key: 'cause-b' } })).toBe(1);
    });

    it('a card-level cause on another card is a separate question; a project-level cause is one question for the whole project', async () => {
      const t1 = await fx.mkTask('Cause p1', { project_id: P, status: 'not_started' });
      const t2 = await fx.mkTask('Cause p2', { project_id: P, status: 'not_started' });
      const t3 = await fx.mkTask('Cause other', { project_id: OTHER, status: 'not_started' });
      as(dox());
      const c1 = await json(await addQ(call(P, q('Does the card own a cause?', { cause_key: 'card-cause' })), idParams(t1)));
      const c2 = await json(await addQ(call(P, q('Does the second card own a cause?', { cause_key: 'card-cause' })), idParams(t2)));
      expect([c1.status, c2.status]).toEqual([201, 201]);
      const p1 = await json(await addQ(call(P, q('Is the whole project stuck?', { cause_key: 'project-stuck', cause_scope: 'project' })), idParams(t1)));
      const p2 = await json(await addQ(call(P, q('Is the project really stuck?', { cause_key: 'project-stuck', cause_scope: 'project' })), idParams(t2)));
      const p3 = await json(await addQ(call(OTHER, q('Is this other project stuck?', { cause_key: 'project-stuck', cause_scope: 'project' })), idParams(t3)));
      expect(p1.status).toBe(201);
      expect(p2.status).toBe(200);
      expect(p2.body.id).toBe(p1.body.id);
      expect(p3.status).toBe(201);
      expect(await prisma.taskQuestion.count({ where: { cause_key: 'project-stuck', task_id: { in: [t1, t2] } } })).toBe(1);
    });

    it('two at once for one project-level cause still make one question', async () => {
      const t1 = await fx.mkTask('Race 1', { project_id: P, status: 'not_started' });
      const t2 = await fx.mkTask('Race 2', { project_id: P, status: 'not_started' });
      as(dox());
      const [a, b] = await Promise.all([
        addQ(call(P, q('First of two at once?', { cause_key: 'race-cause', cause_scope: 'project' })), idParams(t1)),
        addQ(call(P, q('Second of two at once?', { cause_key: 'race-cause', cause_scope: 'project' })), idParams(t2)),
      ]);
      expect([a.status, b.status].sort()).toEqual([200, 201]);
      expect(await prisma.taskQuestion.count({ where: { cause_key: 'race-cause' } })).toBe(1);
    });

    it('a bad cause_key is a 400, and a question with no key is unchanged', async () => {
      const t = await fx.mkTask('Cause bad', { project_id: P, status: 'not_started' });
      as(dox());
      expect((await addQ(call(P, q('Is this key too short?', { cause_key: 'x' })), idParams(t))).status).toBe(400);
      expect((await addQ(call(P, q('Is this scope valid?', { cause_key: 'valid-key', cause_scope: 'galaxy' })), idParams(t))).status).toBe(400);
      const plain = await json(await addQ(call(P, q('Is there no key at all?')), idParams(t)));
      expect(plain.status).toBe(201);
      expect(plain.body.cause_key).toBeNull();
    });
  });

  describe('snapshot and brief', () => {
    it('returns the project, phases, open tasks with blockers, last activity, live sessions, waits and questions', async () => {
      const proj = await fx.mkProject('Snap', { status: 'in_progress', plan_folder: '/home/mike/Documents/projects/snap', start_date: new Date('2026-11-10T12:00:00Z'), target_date: new Date('2026-11-30T12:00:00Z'), dependencies_ordering_only: true, type: 'project' });
      const ph = await prisma.projectPhase.create({ data: { project_id: proj, name: 'Build', sort_order: 1 } });
      const fn = await prisma.function.create({ data: { name: `${fx.tag} Copy` } as never });
      const done = await fx.mkTask('Done blocker', { project_id: proj, status: 'done' });
      const open = await fx.mkTask('Open blocker', { project_id: proj, status: 'in_progress', assignee_id: staff });
      const t = await fx.mkTask('Main', { project_id: proj, status: 'blocked', assignee_id: staff, function_id: fn.id, phase_id: ph.id, tags: ['content', 'cockpit-owned'], due_date: new Date('2026-11-25T12:00:00Z'), blocked_by: { connect: [{ id: done }, { id: open }] } });
      const free = await fx.mkTask('Free', { project_id: proj, status: 'not_started' });
      await fx.mkTask('Finished', { project_id: proj, status: 'abandoned' });
      await fx.mkTask('Parked card', { project_id: proj, status: 'triage' });
      const stale = new Date('2026-11-01T10:00:00Z');
      await prisma.$executeRaw`UPDATE tasks SET updated_at = ${stale} WHERE id = ${t}::uuid`;
      const c = await prisma.comment.create({ data: { task_id: t, user_id: staff, content: 'Moving on it', is_internal: true } });
      // a live session linked to the task
      const ext = `${fx.tag}-session`;
      const machine = await prisma.oracleMachine.create({ data: { name: `${fx.tag}-machine` } });
      await prisma.oracleSession.create({ data: { external_id: ext, status: 'running', title: 'x', source: 'claude_code', machine_id: machine.id } });
      await prisma.workLink.create({ data: { kind: 'session', ref: ext, target_key: `task:${free}`, state: 'active', attached_by: 'bast', project_id: proj } as never });
      const wait = await prisma.wait.create({ data: { kind: 'external', template_key: 'handoff.generic', title: `${fx.tag} client assets`, owner_user_id: staff, project_id: proj, task_id: t, duration_value: 3, duration_unit: 'business_days', due_at: new Date('2026-11-05T12:00:00Z'), terminal_action: 'task' } as never });
      await prisma.taskQuestion.create({ data: { task_id: t, question: 'Who signs off the copy?', what_it_is: 'x'.repeat(20), sources: [], checked: 'x'.repeat(20), unknown: 'x'.repeat(20), if_nobody: 'x'.repeat(20), if_nobody_action: 'wait', cause_key: 'snap-cause', asked_by_lane: 'dox' } });

      as(dox());
      const res = await json(await projectSnapshot(call(undefined, undefined, 'GET'), idParams(proj)));
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      const s = res.body;
      expect(s.brief).toBeNull();
      expect(s.project).toMatchObject({ id: proj, status: 'in_progress', type: 'project', dependencies_ordering_only: true, plan_folder: '/home/mike/Documents/projects/snap' });
      expect(s.project.start_date.slice(0, 10)).toBe('2026-11-10');
      expect(s.project.target_date.slice(0, 10)).toBe('2026-11-30');
      expect(s.phases.map((p: { name: string }) => p.name)).toEqual(['Build']);
      const titles = s.tasks.map((x: { title: string }) => x.title.replace(`${fx.tag} `, ''));
      expect(titles.sort()).toEqual(['Free', 'Main', 'Open blocker']);
      const main = s.tasks.find((x: { id: string }) => x.id === t);
      expect(main).toMatchObject({ status: 'blocked', assignee: { id: staff, name: 'Sabeen' }, function: { name: `${fx.tag} Copy` }, phase_id: ph.id, tags: ['content', 'cockpit-owned'], blockers_satisfied: false, live_session: false });
      expect(main.due_date.slice(0, 10)).toBe('2026-11-25');
      expect(main.blockers.map((b: { id: string; satisfied: boolean }) => [b.id === done ? 'done' : 'open', b.satisfied]).sort()).toEqual([['done', true], ['open', false]]);
      expect(new Date(main.last_activity_at).getTime()).toBe(c.created_at.getTime());
      expect(s.tasks.find((x: { id: string }) => x.id === free)).toMatchObject({ live_session: true, assignee: null, blockers: [], blockers_satisfied: true });
      expect(s.tasks.find((x: { id: string }) => x.id === open).live_session).toBe(false);
      expect(s.waits).toHaveLength(1);
      expect(s.waits[0]).toMatchObject({ id: wait.id, task_id: t, overdue: true, owner: { kind: 'user', user_id: staff, name: 'Sabeen' } });
      expect(s.waits[0].due_at).toBe('2026-11-05T12:00:00.000Z');
      expect(s.questions).toHaveLength(1);
      expect(s.questions[0]).toMatchObject({ task_id: t, cause_key: 'snap-cause', asked_by_lane: 'dox' });

      // the same answer as the work state route for a single task (the logic is shared, not re-derived)
      const { workState } = await import('@/lib/work/state');
      expect((await workState(prisma, `task:${free}`))?.live_session).toBe(true);
      expect((await workState(prisma, `task:${open}`))?.live_session).toBe(false);

      // the brief: created once with cadence auto, and the snapshot by brief id carries it
      const made = await json(await startBrief(call(proj), idParams(proj)));
      expect(made.status).toBe(201);
      expect(made.body).toMatchObject({ project_id: proj, cadence: 'auto', owner_mode: 'dry' });
      const again = await json(await startBrief(call(proj), idParams(proj)));
      expect(again.status).toBe(200);
      expect(again.body.id).toBe(made.body.id);
      expect(await prisma.engagementBrief.count({ where: { project_id: proj } })).toBe(1);
      const byBrief = await json(await briefSnapshot(call(undefined, undefined, 'GET'), idParams(made.body.id)));
      expect(byBrief.status).toBe(200);
      expect(byBrief.body.brief.cadence).toBe('auto');
      expect(byBrief.body.tasks).toHaveLength(3);
      const byProject = await json(await projectSnapshot(call(undefined, undefined, 'GET'), idParams(proj)));
      expect(byProject.body.brief.id).toBe(made.body.id);
      await prisma.workLink.deleteMany({ where: { ref: ext } });
      await prisma.oracleSession.deleteMany({ where: { external_id: ext } });
      await prisma.oracleMachine.delete({ where: { id: machine.id } });
      await prisma.comment.deleteMany({ where: { task_id: t } });
      await prisma.taskQuestion.deleteMany({ where: { task_id: t } });
      await prisma.task.updateMany({ where: { id: t }, data: { function_id: null } });
      await prisma.function.delete({ where: { id: fn.id } });
    });

    it('is for Dox and the owner session only; a charter brief has none; cadence values are validated', async () => {
      const proj = await fx.mkProject('Guarded', { status: 'ready' });
      const stranger = await fx.mkStaff('Stranger', 'admin');
      for (const who of [{ userId: stranger, role: 'admin', email: 's@t', via: 'session' }, { userId: MIKE_USER_ID, role: 'admin', email: 'm@t', via: 'api_key', apiKeyId: 'k' }, { userId: BOT_ID, role: 'pm', email: 'b@t', via: 'api_key', apiKeyId: 'k', lane: 'bast', laneEnforced: true }] as AuthPayload[]) {
        as(who);
        expect((await projectSnapshot(call(undefined, undefined, 'GET'), idParams(proj))).status).toBe(403);
        expect((await startBrief(call(undefined), idParams(proj))).status).toBe(403);
      }
      as(mikeSession());
      expect((await projectSnapshot(call(undefined, undefined, 'GET'), idParams(proj))).status).toBe(200);
      expect((await projectSnapshot(call(undefined, undefined, 'GET'), idParams('7f1c0000-0000-4000-8000-0000000000aa'))).status).toBe(404);
      const charter = await prisma.charter.create({ data: { client: { connect: { id: fx.clientId } }, created_by: { connect: { id: BOT_ID } }, name: `${fx.tag} charter`, billing_period: 'monthly', start_date: new Date('2026-01-01') } });
      {
        const b = await prisma.engagementBrief.create({ data: { client_id: fx.clientId, charter_id: charter.id, label: 'c' } });
        expect((await briefSnapshot(call(undefined, undefined, 'GET'), idParams(b.id))).status).toBe(400);
        await prisma.engagementBrief.delete({ where: { id: b.id } });
        await prisma.charter.delete({ where: { id: charter.id } });
      }
      as({ userId: BOT_ID, role: 'pm', email: 'b@t', via: 'api_key', apiKeyId: 'k' });
      for (const cadence of ['auto', 'daily', 'every_2_days', 'every_3_days', 'weekly', 'every_2_weeks', 'none']) {
        const r = await putBrief(call(undefined, { project_id: proj, label: 'x', cadence }, 'PUT'));
        expect(r.status, cadence).toBeLessThan(300);
      }
      for (const cadence of ['hourly', 'monthly', 'every_4_days', '']) {
        expect((await putBrief(call(undefined, { project_id: proj, label: 'x', cadence }, 'PUT'))).status, cadence).toBe(400);
      }
    });
  });

  describe('project dates on the Triage card', () => {
    it('shows both dates on the card and its project block, accepts them for a project card (owner or chat lane), and Dox can read them', async () => {
      const proj = await fx.mkProject('Dated', { status: 'queue' });
      const card = await fx.mkTask('Dated card', { status: 'triage', triage_kind: 'project_setup', project_id: proj });
      as(mikeSession());
      const set = await json(await patchTriage(call(undefined, { target_start_date: '2026-11-10', target_launch_date: '2026-11-30' }, 'PATCH'), idParams(card)));
      expect(set.status, JSON.stringify(set.body)).toBe(200);
      expect(set.body.target_start_date).toBe('2026-11-10');
      expect(set.body.target_launch_date).toBe('2026-11-30');
      expect(set.body.project).toMatchObject({ start_date: '2026-11-10', target_date: '2026-11-30' });
      const row = await prisma.project.findUniqueOrThrow({ where: { id: proj } });
      expect(row.start_date?.toISOString().slice(0, 10)).toBe('2026-11-10');
      expect(row.target_date?.toISOString().slice(0, 10)).toBe('2026-11-30');

      as(chatLane());
      const chatSet = await json(await patchTriage(call(undefined, { target_launch_date: '2026-12-15', date_source: { kind: 'mike', label: 'Mike, in chat' } }, 'PATCH'), idParams(card)));
      expect(chatSet.status).toBe(200);
      expect(chatSet.body.target_launch_date).toBe('2026-12-15');
      expect(chatSet.body.target_start_date).toBe('2026-11-10');
      const cleared = await json(await patchTriage(call(undefined, { target_start_date: null, date_source: { kind: 'mike', label: 'Mike, in chat' } }, 'PATCH'), idParams(card)));
      expect(cleared.body.target_start_date).toBeNull();
      expect(cleared.body.project.start_date).toBeNull();

      as(dox());
      const read = await json(await getTriage(call(undefined, undefined, 'GET'), idParams(card)));
      expect(read.status).toBe(200);
      expect(read.body.target_launch_date).toBe('2026-12-15');
      expect((await patchTriage(call(undefined, { target_launch_date: '2026-12-20' }, 'PATCH'), idParams(card))).status).toBe(403);
      expect((await prisma.project.findUniqueOrThrow({ where: { id: proj } })).target_date?.toISOString().slice(0, 10)).toBe('2026-12-15');
    });

    it('refuses a bad date, a card that is not a project card, a project card with no project, and anyone else', async () => {
      const proj = await fx.mkProject('Dated2', { status: 'queue' });
      const task = await fx.mkTask('Plain card', { status: 'triage', triage_kind: 'task', project_id: proj });
      const unlinked = await fx.mkTask('Unlinked card', { status: 'triage', triage_kind: 'project_setup' });
      const card = await fx.mkTask('Fine card', { status: 'triage', triage_kind: 'project_setup', project_id: proj });
      as(mikeSession());
      expect((await patchTriage(call(undefined, { target_launch_date: '2026-02-31' }, 'PATCH'), idParams(card))).status).toBe(400);
      expect((await patchTriage(call(undefined, { target_launch_date: 'Nov 30' }, 'PATCH'), idParams(card))).status).toBe(400);
      expect((await patchTriage(call(undefined, { target_launch_date: '2026-11-30' }, 'PATCH'), idParams(task))).status).toBe(400);
      expect((await patchTriage(call(undefined, { target_launch_date: '2026-11-30' }, 'PATCH'), idParams(unlinked))).status).toBe(409);
      as({ userId: BOT_ID, role: 'pm', email: 'b@t', via: 'api_key', apiKeyId: 'k', lane: 'bast', laneEnforced: true });
      expect((await patchTriage(call(undefined, { target_launch_date: '2026-11-30' }, 'PATCH'), idParams(card))).status).toBe(403);
      expect((await prisma.project.findUniqueOrThrow({ where: { id: proj } })).target_date).toBeNull();
      // linking the project and setting dates in one request works
      const fresh = await fx.mkTask('Fresh card', { status: 'triage', triage_kind: 'project_setup' });
      as(mikeSession());
      const both = await json(await patchTriage(call(undefined, { project_id: proj, target_start_date: '2026-11-12' }, 'PATCH'), idParams(fresh)));
      expect(both.status).toBe(200);
      expect(both.body.target_start_date).toBe('2026-11-12');
    });
  });
});

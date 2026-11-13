// @vitest-environment node
/**
 * Dox slice 3 against a real scratch Postgres:
 *   A. a released card linked to a project makes sure the project has its brief (dry, default cadence, an existing one untouched, Undo leaves it), and the
 *      Dox lane can start the brief of the project it is bound to (never set a mode).
 *   B. the card pass: Dox works one released card that has no project (comment, own fields, done, to a person or to Bast, a project for it), bound by x-dox-card
 *      and an open LIVE card pass; a dry card pass writes nothing; the normal project binding takes over once the card has a project.
 *   C. a setup pass opens on a card that is already in_progress (a crashed pass left it), for a project and for a card pass.
 */
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { NextRequest } from 'next/server';
import type { Mock } from 'vitest';

vi.mock('@/lib/auth/middleware', async (orig) => ({ ...(await orig<typeof import('@/lib/auth/middleware')>()), requireAuth: vi.fn() }));
vi.mock('@/lib/api/formatters', async (orig) => ({ ...(await orig<typeof import('@/lib/api/formatters')>()), formatProjectResponse: (p: { id: string }) => ({ id: p.id }) }));
vi.mock('@/lib/auth/actor-lane', () => ({ actorLaneField: vi.fn(async () => ({})), currentActorLane: vi.fn(async () => null) }));

import { prisma } from '@/lib/db/prisma';
import { requireAuth, type AuthPayload } from '@/lib/auth/middleware';
import { SCRATCH } from '@/lib/engine/__tests__/seed';
import * as projectsRoute from '@/app/api/projects/route';
import { PATCH as patchTask } from '@/app/api/tasks/[id]/route';
import { POST as addComment } from '@/app/api/tasks/[id]/comments/route';
import { POST as startCardPass } from '@/app/api/tasks/[id]/card-pass/route';
import { POST as startPass } from '@/app/api/engagement-briefs/[id]/passes/route';
import { PATCH as patchPass } from '@/app/api/engagement-passes/[id]/route';
import { POST as startBrief } from '@/app/api/projects/[id]/engagement-brief/route';
import { homeActSchema, runHomeAct, runHomeUndo } from '@/lib/home/act';
import { loadCards } from '@/lib/tasks/triage-card';
import { laneAllows } from '@/lib/auth/lane-scopes';
import { dox, mikeSession, idParams, makeFixture, BOT_ID, type Fx } from './fixture';
import { DOX_USER_ID } from '../identity';
import { MIKE_USER_ID } from '@/lib/oracle/projects/gate-constants';

const authMock = requireAuth as Mock;
const as = (a: AuthPayload) => authMock.mockResolvedValue(a);
const call = (headers: Record<string, string>, body?: unknown, method = 'POST') =>
  new NextRequest('http://localhost/api/x', { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
const forProject = (p: string) => ({ 'x-dox-project': p });
const forCard = (c: string) => ({ 'x-dox-card': c });
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- response bodies are read loosely in these tests
const json = async (res: Response) => ({ status: res.status, body: (await res.json()) as Record<string, any> });
const NOW = new Date();
const OPTS = { now: NOW, timezone: 'America/New_York', date: NOW.toISOString().slice(0, 10) };

describe('the card pass route is on the Dox lane only (pure)', () => {
  it('dox reaches it, the chat and desk lanes do not', () => {
    expect(laneAllows('dox', 'POST', '/api/tasks/9f1c0000-0000-4000-8000-000000000001/card-pass')).toBe(true);
    expect(laneAllows('bast-chat', 'POST', '/api/tasks/9f1c0000-0000-4000-8000-000000000001/card-pass')).toBe(false);
    expect(laneAllows('triage-desk', 'POST', '/api/tasks/9f1c0000-0000-4000-8000-000000000001/card-pass')).toBe(false);
  });
});

describe.skipIf(!SCRATCH)('Dox slice 3 (real database)', () => {
  let fx: Fx;
  let staff: string;
  const row = (id: string) => prisma.task.findUniqueOrThrow({ where: { id } });
  const briefOf = (projectId: string) => prisma.engagementBrief.findUnique({ where: { project_id: projectId } });
  const released = (title: string, extra: Record<string, unknown> = {}) =>
    fx.mkTask(title, { status: 'not_started', tags: ['from-triage'], assignee_id: DOX_USER_ID, triage_kind: 'task', client_id: fx.clientId, ...extra });
  const startCard = async (card: string, body?: unknown) => json(await startCardPass(call({}, body), idParams(card)));

  beforeAll(async () => {
    fx = await makeFixture('dox3');
    await prisma.user.upsert({ where: { id: DOX_USER_ID }, update: {}, create: { id: DOX_USER_ID, email: `dox-${fx.tag}@example.test`, password_hash: 'x', name: 'Dox', role: 'pm' } });
    await prisma.userPreference.upsert({ where: { user_id: MIKE_USER_ID }, update: { home_view: 'home' }, create: { user_id: MIKE_USER_ID, home_view: 'home' } });
    staff = await fx.mkStaff('Sabeen');
  });
  afterAll(async () => {
    await prisma.homeAction.deleteMany({ where: { user_id: MIKE_USER_ID, action: { startsWith: 'triage_' } } });
    await prisma.taskQuestion.deleteMany({ where: { task_id: { in: fx.taskIds } } });
    await prisma.comment.deleteMany({ where: { task_id: { in: fx.taskIds } } });
    await fx.cleanup();
    await prisma.$disconnect();
  });

  describe('A. every released card gives its project a brief', () => {
    const release = async (id: string) => runHomeAct(prisma, MIKE_USER_ID, { action: 'triage_release_card', task_ids: [id], release_version: (await loadCards(prisma, [id]))[0].release_version }, OPTS);

    it('releasing a card linked to a project creates the brief (dry, auto); an existing brief is never changed; Undo does not delete it', async () => {
      const p1 = await fx.mkProject('Release makes a brief', { status: 'ready' });
      const c1 = await fx.mkTask('Addition', { status: 'triage', triage_kind: 'project_addition', project_id: p1, client_id: fx.clientId });
      expect(await briefOf(p1)).toBeNull();
      const res = await release(c1);
      expect((await row(c1)).status).toBe('not_started');
      expect(await briefOf(p1)).toMatchObject({ owner_mode: 'dry', cadence: 'auto', client_id: fx.clientId, created_by_id: MIKE_USER_ID });

      const p2 = await fx.mkProject('Release keeps the brief', { status: 'ready' });
      const mine = await prisma.engagementBrief.create({ data: { project_id: p2, label: 'mine', cadence: 'weekly', owner_mode: 'live', allowed_actions: [] } });
      const c2 = await fx.mkTask('Addition 2', { status: 'triage', triage_kind: 'project_addition', project_id: p2, client_id: fx.clientId });
      await release(c2);
      expect(await briefOf(p2)).toMatchObject({ id: mine.id, owner_mode: 'live', cadence: 'weekly', label: 'mine', version: mine.version });

      // Undo of the first release puts the card back and leaves the brief
      await runHomeUndo(prisma, MIKE_USER_ID, res.action_id, new Date(NOW.getTime() + 3600_000));
      expect((await row(c1)).status).toBe('triage');
      expect(await briefOf(p1)).not.toBeNull();
    });

    it('a project card: the queued project goes ready and has its brief', async () => {
      const p = await fx.mkProject('Queued setup', { status: 'queue' });
      const c = await fx.mkTask('Setup', { status: 'triage', triage_kind: 'project_setup', project_id: p, client_id: fx.clientId });
      await release(c);
      expect((await prisma.project.findUniqueOrThrow({ where: { id: p } })).status).toBe('ready');
      expect(await briefOf(p)).toMatchObject({ owner_mode: 'dry', cadence: 'auto' });
    });

    it('a released card with no project makes no brief', async () => {
      const before = await prisma.engagementBrief.count();
      const c = await fx.mkTask('Ad hoc', { status: 'triage', triage_kind: 'task', client_id: fx.clientId });
      await release(c);
      expect(await prisma.engagementBrief.count()).toBe(before);
    });
    it('homeActSchema still takes the release', () => {
      expect(homeActSchema.safeParse({ action: 'triage_release_card', task_ids: [BOT_ID], release_version: 'v'.repeat(32) }).success).toBe(true);
    });

    it('the Dox lane starts the brief of the project it is bound to, with the defaults, and never changes one that exists', async () => {
      const p = await fx.mkProject('Dox makes the brief', { status: 'ready' });
      const other = await fx.mkProject('Another', { status: 'ready' });
      as(dox());
      expect((await json(await startBrief(call({}), idParams(p)))).body.code).toBe('dox_no_project');
      expect((await json(await startBrief(call(forProject(other)), idParams(p)))).body.code).toBe('dox_outside_project');
      expect(await briefOf(p)).toBeNull();
      const made = await json(await startBrief(call(forProject(p)), idParams(p)));
      expect([made.status, made.body.owner_mode, made.body.cadence]).toEqual([201, 'dry', 'auto']);
      // a body cannot ask for live; and an existing brief that the owner made live is returned as it is
      await prisma.engagementBrief.update({ where: { project_id: p }, data: { owner_mode: 'live', cadence: 'daily' } });
      const again = await json(await startBrief(call(forProject(p), { owner_mode: 'live' }), idParams(p)));
      expect([again.status, again.body.owner_mode, again.body.cadence]).toEqual([200, 'live', 'daily']);
      // a project that is closed or still queued is not Dox's
      const queued = await fx.mkProject('Queued', { status: 'queue' });
      expect((await json(await startBrief(call(forProject(queued)), idParams(queued)))).body.code).toBe('dox_project_closed');
      // the owner's session still needs no header
      const p3 = await fx.mkProject('Owner makes it', { status: 'ready' });
      as(mikeSession());
      expect((await json(await startBrief(call({}), idParams(p3)))).status).toBe(201);
    });
  });

  describe('B. a card pass for a released card with no project', () => {
    it('opens only on a released card assigned to Dox with no project, and only for the Dox lane', async () => {
      const ok = await released('Ad hoc ok');
      const withProject = await released('Has a project', { project_id: await fx.mkProject('Card project', { status: 'ready' }) });
      const toPerson = await released('With a person', { assignee_id: staff });
      const inTriage = await fx.mkTask('Still triage', { status: 'triage', tags: ['from-triage'], assignee_id: DOX_USER_ID });
      const notReleased = await fx.mkTask('Never released', { status: 'not_started', assignee_id: DOX_USER_ID });
      const done = await released('Finished', { status: 'done' });
      as(mikeSession());
      expect((await startCard(ok)).status).toBe(403);
      as(dox());
      for (const c of [withProject, toPerson, inTriage, notReleased, done]) {
        const r = await startCard(c);
        expect([r.status, r.body.code], c).toEqual([409, 'card_not_passable']);
      }
      expect((await startCard('9f1c0000-0000-4000-8000-000000000001')).status).toBe(404);
      expect((await startCard(ok, { mode: 'sideways' })).status).toBe(400);
      const pass = await startCard(ok);
      expect(pass.status, JSON.stringify(pass.body)).toBe(201);
      expect(pass.body).toMatchObject({ brief_id: null, task_id: ok, mode: 'live', kind: 'setup' });
      const stored = await prisma.engagementPass.findUniqueOrThrow({ where: { id: pass.body.id } });
      expect([stored.brief_id, stored.task_id, stored.lane]).toEqual([null, ok, 'dox']);
    });

    it('under a live card pass Dox comments, changes the card\'s own fields, hands it to a person or to Bast, and marks it done', async () => {
      as(dox());
      // to a person
      const a = await released('To a person');
      expect((await json(await patchTask(call(forCard(a), { assignee_id: staff }, 'PATCH'), idParams(a)))).status).toBe(200);
      // before a pass, Bast is refused
      const b = await released('To Bast');
      const noPass = await json(await patchTask(call(forCard(b), { assignee_id: BOT_ID }, 'PATCH'), idParams(b)));
      expect([noPass.status, noPass.body.code]).toEqual([403, 'dox_assignee_closed']);
      expect((await json(await patchTask(call(forCard(b), { status: 'done' }, 'PATCH'), idParams(b)))).body.code).toBe('dox_status_closed');
      const pass = (await startCard(b)).body.id;
      // a comment, an own field, then to Bast (tagged from-dox)
      expect((await addComment(call(forCard(b), { content: 'Handing this to the worker.' }), idParams(b))).status).toBe(201);
      const due = new Date(Date.now() + 5 * 86400_000).toISOString();
      expect((await json(await patchTask(call(forCard(b), { due_date: due }, 'PATCH'), idParams(b)))).status).toBe(200);
      const toBast = await json(await patchTask(call(forCard(b), { assignee_id: BOT_ID }, 'PATCH'), idParams(b)));
      expect(toBast.status, JSON.stringify(toBast.body)).toBe(200);
      const after = await row(b);
      expect([after.assignee_id, after.tags.includes('from-dox'), after.tags.includes('from-triage')]).toEqual([BOT_ID, true, true]);
      // a field outside the allow-list is still closed
      const c = await released('Closed fields');
      await startCard(c);
      expect((await json(await patchTask(call(forCard(c), { title: 'new' }, 'PATCH'), idParams(c)))).body.code).toBe('dox_field_closed');
      // done: needs the header to name this card
      const d = await released('Mark done');
      const dPass = (await startCard(d)).body.id;
      expect((await json(await patchTask(call(forCard(c), { status: 'done' }, 'PATCH'), idParams(d)))).body.code).toBe('dox_status_closed');
      expect((await json(await patchTask(call({}, { status: 'done' }, 'PATCH'), idParams(d)))).body.code).toBe('dox_status_closed');
      expect((await json(await patchTask(call(forCard(d), { status: 'abandoned' }, 'PATCH'), idParams(d)))).body.code).toBe('dox_status_closed');
      const fin = await json(await patchTask(call(forCard(d), { status: 'done' }, 'PATCH'), idParams(d)));
      expect(fin.status, JSON.stringify(fin.body)).toBe(200);
      expect((await row(d)).status).toBe('done');
      // finishing the pass works with no brief, and a finished pass opens nothing
      expect((await patchPass(call({}, { finished: true }, 'PATCH'), idParams(dPass))).status).toBe(200);
      expect((await patchPass(call({}, { finished: true }, 'PATCH'), idParams(pass))).status).toBe(200);
      const e = await released('After the pass');
      expect((await json(await patchTask(call(forCard(e), { assignee_id: BOT_ID }, 'PATCH'), idParams(e)))).body.code).toBe('dox_assignee_closed');
    });

    it('a dry card pass writes nothing: no Bast, no done, no project', async () => {
      const c = await released('Dry card');
      as(dox());
      const dry = await startCard(c, { mode: 'dry' });
      expect(dry.body.mode).toBe('dry');
      expect((await json(await patchTask(call(forCard(c), { assignee_id: BOT_ID }, 'PATCH'), idParams(c)))).body.code).toBe('dox_assignee_closed');
      expect((await json(await patchTask(call(forCard(c), { status: 'done' }, 'PATCH'), idParams(c)))).body.code).toBe('dox_status_closed');
      const body = { name: `${fx.tag} Dry project`, type: 'internal', client_id: fx.clientId, status: 'ready' };
      const made = await json(await projectsRoute.POST(call(forCard(c), body)));
      expect([made.status, made.body.code]).toEqual([403, 'dox_pass_dry']);
      expect((await row(c)).project_id).toBeNull();
      expect(await prisma.project.count({ where: { name: `${fx.tag} Dry project` } })).toBe(0);
    });

    it('a multi-step card becomes a project for that card only; the project gets a brief and the normal project binding takes over', async () => {
      const c = await released('Multi step');
      const other = await released('Some other card');
      as(dox());
      await startCard(c);
      const body = { name: `${fx.tag} Small project`, type: 'internal', client_id: fx.clientId, status: 'ready' };
      // the other card has no pass of its own: the header cannot borrow this card's
      expect((await json(await projectsRoute.POST(call(forCard(other), body)))).body.code).toBe('dox_no_pass');
      const made = await json(await projectsRoute.POST(call(forCard(c), body)));
      expect(made.status, JSON.stringify(made.body)).toBe(201);
      fx.projectIds.push(made.body.id);
      expect((await row(c)).project_id).toBe(made.body.id);
      expect(await briefOf(made.body.id)).toMatchObject({ owner_mode: 'dry', cadence: 'auto' });
      // one project per card
      expect((await json(await projectsRoute.POST(call(forCard(c), { ...body, name: `${fx.tag} Second` })))).body.code).toBe('dox_card_closed');
      // now the card is a card of a project: the card pass no longer opens writes to it, the project binding does
      const noMore = await json(await patchTask(call(forCard(c), { status: 'done' }, 'PATCH'), idParams(c)));
      expect(noMore.body.code).toBe('dox_no_project');
      const brief = (await briefOf(made.body.id))!;
      const setup = await json(await startPass(call(forProject(made.body.id), { mode: 'live', kind: 'setup' }), idParams(brief.id)));
      expect(setup.status, JSON.stringify(setup.body)).toBe(201);
      expect((await patchTask(call(forProject(made.body.id), { assignee_id: staff }, 'PATCH'), idParams(c))).status).toBe(200);
    });
  });

  describe('C. a card left in_progress by a crashed pass can be resumed', () => {
    it('a live setup pass opens on a project whose released card is already in_progress, and a card pass opens on an in_progress card', async () => {
      const p = await fx.mkProject('Crashed setup', { status: 'ready' });
      await fx.mkTask('Setup card', { project_id: p, status: 'in_progress', tags: ['kickoff', 'from-triage'], assignee_id: DOX_USER_ID, triage_kind: 'project_setup' });
      const brief = await prisma.engagementBrief.create({ data: { project_id: p, label: 'b', cadence: 'auto', owner_mode: 'dry', allowed_actions: [] } });
      as(dox());
      const s = await json(await startPass(call({}, { mode: 'live', kind: 'setup' }), idParams(brief.id)));
      expect(s.status, JSON.stringify(s.body)).toBe(201);
      const c = await released('Crashed card', { status: 'in_progress' });
      const cp = await startCard(c);
      expect(cp.status, JSON.stringify(cp.body)).toBe(201);
    });
  });
});

describe.skipIf(!SCRATCH)('Dox slice 2c server data (real database)', () => {
  let fx: Fx;
  beforeAll(async () => {
    fx = await makeFixture('dox2c');
    await prisma.userPreference.upsert({ where: { user_id: MIKE_USER_ID }, update: { home_view: 'home' }, create: { user_id: MIKE_USER_ID, home_view: 'home' } });
  });
  afterAll(async () => {
    await prisma.taskPlanItem.deleteMany({ where: { task_id: { in: fx.taskIds } } });
    await prisma.taskQuestion.deleteMany({ where: { task_id: { in: fx.taskIds } } });
    await fx.cleanup();
  });

  it('the plan sends requirement progress only when a task on the project carries plan links', async () => {
    const { loadPlan } = await import('@/lib/tasks/plan');
    const project = await fx.mkProject('Progress', { status: 'ready' });
    const setup = await fx.mkTask('Setup', { status: 'in_progress', triage_kind: 'project_setup', project_id: project, client_id: fx.clientId, tags: ['from-triage'] });
    const lineA = (await prisma.taskPlanItem.create({ data: { task_id: setup, section: 'requirements', position: 0, updated_by: 'test', data: { text: 'A', mark: 'original' } } as never })).id;
    const lineB = (await prisma.taskPlanItem.create({ data: { task_id: setup, section: 'requirements', position: 1, updated_by: 'test', data: { text: 'B', mark: 'original' } } as never })).id;
    const head = (await prisma.task.findUniqueOrThrow({ where: { id: setup } })) as never;
    const read = async () => (await loadPlan(head, mikeSession(), new Headers())).sections.find((s) => s.section === 'requirements')!.items;
    // no task carries a link: nothing is shown
    expect((await read()).every((i) => i.progress === undefined)).toBe(true);
    await fx.mkTask('Build A part 1', { project_id: project, status: 'done', plan_item_ids: [lineA] });
    await fx.mkTask('Build A part 2', { project_id: project, status: 'not_started', plan_item_ids: [lineA] });
    const items = await read();
    expect(items.find((i) => i.id === lineA)).toMatchObject({ progress: 'in_progress', done: 1, total: 2 });
    expect(items.find((i) => i.id === lineB)).toMatchObject({ progress: 'not_started', done: 0, total: 0 });
    await prisma.task.updateMany({ where: { project_id: project, title: { contains: 'part 2' } }, data: { status: 'done' } });
    expect((await read()).find((i) => i.id === lineA)).toMatchObject({ progress: 'done', done: 2, total: 2 });
  });

  it('a Triage card with an open Dox question keyed triage-date: carries the reason; a withdrawn one or another key carries none', async () => {
    const { loadCards } = await import('@/lib/tasks/triage-card');
    const project = await fx.mkProject('Dated', { status: 'queue', start_date: new Date('2026-11-10T00:00:00Z'), target_date: new Date('2026-11-30T00:00:00Z') });
    const card = await fx.mkTask('Dated card', { status: 'triage', triage_kind: 'project_setup', project_id: project, client_id: fx.clientId });
    const mk = (cause_key: string | null, state = 'open') =>
      prisma.taskQuestion.create({ data: { task_id: card, question: 'q', what_it_is: 'x', sources: [], checked: 'x', unknown: 'x', if_nobody: 'go', if_nobody_action: 'wait', cause_key, state } as never });
    expect((await loadCards(prisma, [card]))[0].date_flags).toEqual([]);
    await mk('dox:g3:other');
    await mk(`triage-date:launch:${card}`, 'withdrawn');
    expect((await loadCards(prisma, [card]))[0].date_flags).toEqual([]);
    await mk(`triage-date:start:${card}`);
    expect((await loadCards(prisma, [card]))[0].date_flags).toEqual([{ kind: 'start', reason: 'Start date was Nov 10, and this card is still waiting for you.' }]);
  });
});

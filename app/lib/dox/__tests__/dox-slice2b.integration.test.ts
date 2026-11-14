// @vitest-environment node
/**
 * Dox slice 2b against a real scratch Postgres: a dry pass is read-only, a setup pass is live on a released card, a sweep pass is refused live on a dry
 * brief, plan_item_ids from another card are refused, the brief PATCH (owner and chat only), the chat lane's brief POST, the next-step write bound to
 * the project in play, and the lane routes Slice 3's scripts call.
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
import * as tasksRoute from '@/app/api/tasks/route';
import { PATCH as patchTask, GET as getTask } from '@/app/api/tasks/[id]/route';
import { POST as addComment } from '@/app/api/tasks/[id]/comments/route';
import { POST as startPass } from '@/app/api/engagement-briefs/[id]/passes/route';
import { PATCH as patchBrief } from '@/app/api/engagement-briefs/[id]/route';
import { GET as listBriefs } from '@/app/api/engagement-briefs/route';
import { POST as startBrief } from '@/app/api/projects/[id]/engagement-brief/route';
import { POST as addQ } from '@/app/api/tasks/[id]/questions/route';
import { PUT as writeNextStep } from '@/app/api/oracle/projects/[id]/next-step/write/route';
import { GET as refreshRequests } from '@/app/api/oracle/projects/refresh-requests/route';
import { laneAllows } from '@/lib/auth/lane-scopes';
import { dox, mikeSession, chatLane, idParams, makeFixture, BOT_ID, type Fx } from './fixture';
import { DOX_USER_ID } from '../identity';

const authMock = requireAuth as Mock;
const as = (a: AuthPayload) => authMock.mockResolvedValue(a);
const call = (project?: string, body?: unknown, method = 'POST') =>
  new NextRequest('http://localhost/api/x', { method, headers: project ? { 'x-dox-project': project } : {}, body: body === undefined ? undefined : JSON.stringify(body) });
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- response bodies are read loosely in these tests
const json = async (res: Response) => ({ status: res.status, body: (await res.json()) as Record<string, any> });
const createTask = tasksRoute.POST;

describe('the lane routes Slice 3 calls (pure)', () => {
  it('the dox lane reaches refresh-requests and the next-step write; the chat lane reaches the brief PATCH and POST; the dox lane\'s brief PATCH is the report fields only (the route refuses the rest)', () => {
    expect(laneAllows('dox', 'GET', '/api/oracle/projects/refresh-requests')).toBe(true);
    expect(laneAllows('dox', 'PUT', '/api/oracle/projects/9f1c0000-0000-4000-8000-000000000001/next-step/write')).toBe(true);
    expect(laneAllows('dox', 'GET', '/api/users')).toBe(true);
    expect(laneAllows('bast-chat', 'PATCH', '/api/engagement-briefs/9f1c0000-0000-4000-8000-000000000001')).toBe(true);
    expect(laneAllows('bast-chat', 'POST', '/api/projects/9f1c0000-0000-4000-8000-000000000001/engagement-brief')).toBe(true);
    // the report fields only: guardDoxBriefReportPatch refuses the sweep cadence and the mode inside the route
    expect(laneAllows('dox', 'PATCH', '/api/engagement-briefs/9f1c0000-0000-4000-8000-000000000001')).toBe(true);
  });
});

describe.skipIf(!SCRATCH)('Dox slice 2b (real database)', () => {
  let fx: Fx;
  let staff: string;

  const mkBrief = async (projectId: string, owner_mode: string) =>
    (await prisma.engagementBrief.upsert({
      where: { project_id: projectId },
      update: { owner_mode },
      create: { project_id: projectId, label: `${fx.tag} brief`, cadence: 'auto', owner_mode, allowed_actions: [] },
    })).id;

  beforeAll(async () => {
    fx = await makeFixture('dox2b');
    await prisma.user.upsert({ where: { id: DOX_USER_ID }, update: {}, create: { id: DOX_USER_ID, email: `dox-${fx.tag}@example.test`, password_hash: 'x', name: 'Dox', role: 'pm' } });
    staff = await fx.mkStaff('Sabeen');
  });
  afterAll(async () => {
    await prisma.taskPlanItem.deleteMany({ where: { task_id: { in: fx.taskIds } } });
    await prisma.comment.deleteMany({ where: { task_id: { in: fx.taskIds } } });
    await fx.cleanup();
    await prisma.$disconnect();
  });

  describe('a dry pass is read-only', () => {
    it('a task create, a task patch and a comment are refused under a dry pass; the same calls work under a live one', async () => {
      const proj = await fx.mkProject('Dry then live', { status: 'ready' });
      const t = await fx.mkTask('Dry task', { project_id: proj, status: 'not_started' });
      const dryId = await fx.openPass(proj, 'dox', { mode: 'dry' });
      as(dox());
      const a = await json(await createTask(call(proj, { title: `${fx.tag} no`, project_id: proj })));
      expect([a.status, a.body.code]).toEqual([403, 'dox_pass_dry']);
      const b = await json(await patchTask(call(proj, { assignee_id: staff }, 'PATCH'), idParams(t)));
      expect([b.status, b.body.code]).toEqual([403, 'dox_pass_dry']);
      const c = await json(await addComment(call(proj, { content: 'note' }), idParams(t)));
      expect([c.status, c.body.code]).toEqual([403, 'dox_pass_dry']);
      expect(await prisma.task.count({ where: { title: `${fx.tag} no` } })).toBe(0);
      expect((await prisma.task.findUniqueOrThrow({ where: { id: t } })).assignee_id).toBeNull();
      // a dry pass may only patch itself: finishing it works
      const { PATCH: patchPass } = await import('@/app/api/engagement-passes/[id]/route');
      expect((await patchPass(call(undefined, { finished: true }, 'PATCH'), idParams(dryId))).status).toBe(200);
      await fx.openPass(proj, 'dox', { mode: 'live' });
      expect((await patchTask(call(proj, { assignee_id: staff }, 'PATCH'), idParams(t))).status).toBe(200);
    });
  });

  describe('starting a pass', () => {
    it('a sweep pass is refused live on a dry brief; a dry pass on it is fine; kind is stored', async () => {
      const proj = await fx.mkProject('Dry brief sweep', { status: 'ready' });
      const brief = await mkBrief(proj, 'dry');
      as(dox());
      const live = await json(await startPass(call(undefined, { mode: 'live', kind: 'sweep' }), idParams(brief)));
      expect([live.status, live.body.code]).toEqual([409, 'brief_not_live']);
      const noKind = await json(await startPass(call(undefined, { mode: 'live' }), idParams(brief)));
      expect([noKind.status, noKind.body.code]).toEqual([409, 'brief_not_live']);
      const dry = await json(await startPass(call(undefined, { mode: 'dry', kind: 'sweep' }), idParams(brief)));
      expect(dry.status, JSON.stringify(dry.body)).toBe(201);
      expect(dry.body).toMatchObject({ mode: 'dry', kind: 'sweep' });
      expect((await prisma.engagementPass.findUniqueOrThrow({ where: { id: dry.body.id } })).kind).toBe('sweep');
      const bad = await json(await startPass(call(undefined, { mode: 'dry', kind: 'nap' }), idParams(brief)));
      expect(bad.status).toBe(400);
    });

    it('a sweep pass is live on a live brief', async () => {
      const proj = await fx.mkProject('Live brief sweep', { status: 'ready' });
      const brief = await mkBrief(proj, 'live');
      as(dox());
      const live = await json(await startPass(call(undefined, { mode: 'live', kind: 'sweep' }), idParams(brief)));
      expect(live.status, JSON.stringify(live.body)).toBe(201);
    });

    it('a setup pass is live on a dry brief only while the project holds a released card assigned to Dox', async () => {
      const proj = await fx.mkProject('Setup pass', { status: 'ready' });
      const brief = await mkBrief(proj, 'dry');
      as(dox());
      const none = await json(await startPass(call(undefined, { mode: 'live', kind: 'setup' }), idParams(brief)));
      expect([none.status, none.body.code]).toEqual([409, 'brief_not_live']);
      // a released card that is still with Bast, or still in Triage, is not it
      await fx.mkTask('With Bast', { project_id: proj, status: 'not_started', tags: ['from-triage'], assignee_id: BOT_ID });
      await fx.mkTask('In Triage', { project_id: proj, status: 'triage', tags: ['from-triage'], assignee_id: DOX_USER_ID });
      expect((await json(await startPass(call(undefined, { mode: 'live', kind: 'setup' }), idParams(brief)))).status).toBe(409);
      await fx.mkTask('Setup card', { project_id: proj, status: 'not_started', tags: ['kickoff', 'from-triage'], assignee_id: DOX_USER_ID, triage_kind: 'project_setup' });
      const ok = await json(await startPass(call(undefined, { mode: 'live', kind: 'setup' }), idParams(brief)));
      expect(ok.status, JSON.stringify(ok.body)).toBe(201);
      expect(ok.body).toMatchObject({ mode: 'live', kind: 'setup' });
      // and a sweep is still refused on the same brief
      expect((await json(await startPass(call(undefined, { mode: 'live', kind: 'sweep' }), idParams(brief)))).status).toBe(409);
      // the live setup pass opens writes
      const t = await fx.mkTask('Setup task', { project_id: proj, status: 'not_started' });
      expect((await patchTask(call(proj, { assignee_id: staff }, 'PATCH'), idParams(t))).status).toBe(200);
    });

    it('a report pass is live on a dry brief only for the unblocked report task assigned to Dox', async () => {
      const proj = await fx.mkProject('Report pass', { status: 'ready' });
      const brief = await mkBrief(proj, 'dry');
      as(dox());
      const blocked = await fx.mkTask('Report', { project_id: proj, status: 'blocked', tags: ['project-report'], assignee_id: DOX_USER_ID });
      expect((await json(await startPass(call(undefined, { mode: 'live', kind: 'report' }), idParams(brief)))).body.code).toBe('brief_not_live');
      await prisma.task.update({ where: { id: blocked }, data: { status: 'not_started' } });
      const ok = await json(await startPass(call(undefined, { mode: 'live', kind: 'report' }), idParams(brief)));
      expect(ok.status, JSON.stringify(ok.body)).toBe(201);
    });

    it('an off brief runs nothing, for any kind', async () => {
      const proj = await fx.mkProject('Off brief', { status: 'ready' });
      const brief = await mkBrief(proj, 'off');
      as(dox());
      expect((await json(await startPass(call(undefined, { mode: 'dry', kind: 'sweep' }), idParams(brief)))).body.code).toBe('brief_off');
    });
  });

  describe('plan_item_ids', () => {
    it('are stored on create and on patch, returned on read, and refused when they belong to another card or project', async () => {
      const proj = await fx.mkProject('Plan links', { status: 'ready' });
      const other = await fx.mkProject('Other plan', { status: 'ready' });
      await fx.openPass(proj);
      const setup = await fx.mkTask('Setup card', { project_id: proj, status: 'not_started', triage_kind: 'project_setup', tags: ['from-triage'] });
      const otherSetup = await fx.mkTask('Other setup card', { project_id: other, status: 'not_started', triage_kind: 'project_setup', tags: ['from-triage'] });
      const loose = await fx.mkTask('Not a setup card', { project_id: proj, status: 'not_started' });
      const mkItem = async (task_id: string) =>
        (await prisma.taskPlanItem.create({ data: { task_id, section: 'requirements', position: 0, data: { text: 'Eight pages' }, updated_by: 'test' } as never })).id;
      const req1 = await mkItem(setup);
      const req2 = await mkItem(setup);
      const foreign = await mkItem(otherSetup);
      const notSetup = await mkItem(loose);
      as(dox());

      const made = await json(await createTask(call(proj, { title: `${fx.tag} linked`, project_id: proj, assignee_id: staff, plan_item_ids: [req1] })));
      expect(made.status, JSON.stringify(made.body)).toBe(201);
      fx.taskIds.push(made.body.id);
      expect(made.body.plan_item_ids).toEqual([req1]);
      expect((await prisma.task.findUniqueOrThrow({ where: { id: made.body.id } })).plan_item_ids).toEqual([req1]);

      const patched = await json(await patchTask(call(proj, { plan_item_ids: [req1, req2, req2] }, 'PATCH'), idParams(made.body.id)));
      expect(patched.status, JSON.stringify(patched.body)).toBe(200);
      expect((await prisma.task.findUniqueOrThrow({ where: { id: made.body.id } })).plan_item_ids.sort()).toEqual([req1, req2].sort());
      const read = await json(await getTask(call(undefined, undefined, 'GET'), idParams(made.body.id)));
      expect(read.body.plan_item_ids.sort()).toEqual([req1, req2].sort());

      for (const bad of [foreign, notSetup, '9f1c0000-0000-4000-8000-0000000000aa']) {
        const c = await json(await createTask(call(proj, { title: `${fx.tag} bad`, project_id: proj, plan_item_ids: [bad] })));
        expect([c.status, c.body.code], bad).toEqual([403, 'dox_plan_item_closed']);
        const p = await json(await patchTask(call(proj, { plan_item_ids: [req1, bad] }, 'PATCH'), idParams(made.body.id)));
        expect([p.status, p.body.code], bad).toEqual([403, 'dox_plan_item_closed']);
      }
      expect((await json(await createTask(call(proj, { title: `${fx.tag} bad`, project_id: proj, plan_item_ids: ['nope'] })))).status).toBe(400);
      expect(await prisma.task.count({ where: { title: `${fx.tag} bad` } })).toBe(0);
      expect((await prisma.task.findUniqueOrThrow({ where: { id: made.body.id } })).plan_item_ids.sort()).toEqual([req1, req2].sort());
    });

    it('the billing and report marks are allowed tags on a created task; any other tag is not', async () => {
      const proj = await fx.mkProject('Marks', { status: 'ready' });
      await fx.openPass(proj);
      as(dox());
      const ok = await json(await createTask(call(proj, { title: `${fx.tag} report`, project_id: proj, assignee_id: DOX_USER_ID, tags: ['from-dox', 'project-report'] })));
      expect(ok.status, JSON.stringify(ok.body)).toBe(201);
      fx.taskIds.push(ok.body.id);
      const bill = await json(await createTask(call(proj, { title: `${fx.tag} invoice`, project_id: proj, tags: ['from-dox', 'billing'] })));
      expect(bill.status).toBe(201);
      fx.taskIds.push(bill.body.id);
      const bad = await json(await createTask(call(proj, { title: `${fx.tag} sneaky`, project_id: proj, tags: ['needs-mike'] })));
      expect([bad.status, bad.body.code]).toEqual([403, 'dox_tag_closed']);
    });
  });

  describe('the brief: patch, create, list', () => {
    it('the owner and the chat lane set cadence and mode; the Dox lane is refused; another lane is refused', async () => {
      const proj = await fx.mkProject('Brief patch', { status: 'ready' });
      const brief = await mkBrief(proj, 'dry');
      as(mikeSession());
      const a = await json(await patchBrief(call(undefined, { cadence: 'weekly', owner_mode: 'live' }, 'PATCH'), idParams(brief)));
      expect(a.status, JSON.stringify(a.body)).toBe(200);
      expect(a.body).toMatchObject({ cadence: 'weekly', owner_mode: 'live' });
      as(chatLane());
      const b = await json(await patchBrief(call(undefined, { owner_mode: 'dry' }, 'PATCH'), idParams(brief)));
      expect(b.status).toBe(200);
      expect(b.body).toMatchObject({ cadence: 'weekly', owner_mode: 'dry' });
      as(dox());
      const c = await json(await patchBrief(call(undefined, { owner_mode: 'live' }, 'PATCH'), idParams(brief)));
      expect([c.status, c.body.code]).toEqual([403, 'dox_brief_closed']);
      as({ userId: BOT_ID, role: 'pm', email: 'b@test', via: 'api_key', apiKeyId: 'kw', lane: 'bast', laneEnforced: true });
      expect((await patchBrief(call(undefined, { owner_mode: 'live' }, 'PATCH'), idParams(brief))).status).toBe(403);
      as(mikeSession());
      expect((await patchBrief(call(undefined, { cadence: 'hourly' }, 'PATCH'), idParams(brief))).status).toBe(400);
      expect((await patchBrief(call(undefined, {}, 'PATCH'), idParams(brief))).status).toBe(400);
      expect((await prisma.engagementBrief.findUniqueOrThrow({ where: { id: brief } })).owner_mode).toBe('dry');
    });

    it('the chat lane may create a brief; the list returns owner_mode and last_pass_at', async () => {
      const proj = await fx.mkProject('Chat brief', { status: 'ready' });
      as(chatLane());
      const made = await json(await startBrief(call(undefined), idParams(proj)));
      expect(made.status, JSON.stringify(made.body)).toBe(201);
      expect(made.body).toMatchObject({ project_id: proj, owner_mode: 'dry' });
      as(dox());
      const list = await json(await listBriefs(new NextRequest(`http://localhost/api/engagement-briefs?project_id=${proj}`)));
      expect(list.status).toBe(200);
      expect(list.body.briefs[0]).toMatchObject({ owner_mode: 'dry', last_pass_at: null });
    });
  });

  describe('a question on a Triage card of a project that is not live', () => {
    it('the dox lane may write it with no project header, while it holds an open pass', async () => {
      const queued = await fx.mkProject('Not live yet', { status: 'queue' });
      const card = await fx.mkTask('Dated card', { project_id: queued, status: 'triage' });
      await fx.openPass(queued);
      as(dox());
      const body = {
        question: 'Is the launch date of 2026-12-01 still the one?',
        what_it_is: 'The card carries a start date that has already passed.',
        sources: [{ who: 'Dox', said: 'Gap check G12: the start date is past', at: '2026-11-13' }],
        checked: 'Dox read the card and its project dates.',
        unknown: 'Whether the client has moved the date.',
        if_nobody: 'Nothing changes: the item stays on its card.',
        if_nobody_action: 'wait' as const,
        cause_key: `${fx.tag}-g12`,
        cause_scope: 'card',
      };
      const res = await json(await addQ(call(undefined, body), idParams(card)));
      expect(res.status, JSON.stringify(res.body)).toBe(201);
      await prisma.taskQuestion.deleteMany({ where: { task_id: card } });
    });
  });

  describe('the next-step line', () => {
    const put = (project: string | undefined, id: string) =>
      writeNextStep(
        new NextRequest('http://localhost/api/x', {
          method: 'PUT',
          headers: project ? { 'x-dox-project': project } : {},
          body: JSON.stringify({ text: 'Lisa sends the final photos.', source: 'bast', generated_at: '2026-11-13T12:00:00.000Z', model: 'dox' }),
        }),
        idParams(id),
      );

    it('Dox writes it only for the project in play, under a live pass', async () => {
      const proj = await fx.mkProject('Next step', { status: 'ready' });
      const other = await fx.mkProject('Next step elsewhere', { status: 'ready' });
      await fx.openPass(proj);
      await fx.openPass(other);
      as(dox());
      expect((await json(await put(undefined, proj))).body.code).toBe('dox_no_project');
      expect((await json(await put(other, proj))).body.code).toBe('dox_outside_project');
      expect((await put(proj, proj)).status).toBe(200);
      expect((await prisma.project.findUniqueOrThrow({ where: { id: proj } })).next_step_text).toBe('Lisa sends the final photos.');
      const dryProj = await fx.mkProject('Next step dry', { status: 'ready' });
      await fx.openPass(dryProj, 'dox', { mode: 'dry' });
      expect((await json(await put(dryProj, dryProj))).body.code).toBe('dox_pass_dry');
    });

    it('the refresh requests list is readable by the Dox lane', async () => {
      as(dox());
      expect((await refreshRequests()).status).toBe(200);
    });
  });
});

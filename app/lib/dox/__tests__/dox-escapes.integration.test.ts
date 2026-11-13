// @vitest-environment node
/**
 * Dox escape attempts, reconstructed from the adversarial review and run through the real routes against a scratch Postgres. Every row is an
 * attempt that must be refused (and leave the data as it was), plus the allowed neighbour of each rule so the rule is not simply "refuse all".
 */
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { NextRequest } from 'next/server';
import type { Mock } from 'vitest';

vi.mock('@/lib/auth/middleware', async (orig) => ({ ...(await orig<typeof import('@/lib/auth/middleware')>()), requireAuth: vi.fn() }));
vi.mock('@/lib/api/formatters', async (orig) => ({ ...(await orig<typeof import('@/lib/api/formatters')>()), formatProjectResponse: (p: { id: string }) => ({ id: p.id }) }));
vi.mock('@/lib/auth/actor-lane', () => ({ actorLaneField: vi.fn(async () => ({ actor_lane: 'dox' })), currentActorLane: vi.fn(async () => 'dox') }));

import { prisma } from '@/lib/db/prisma';
import { requireAuth, type AuthPayload } from '@/lib/auth/middleware';
import { SCRATCH } from '@/lib/engine/__tests__/seed';
import * as tasksRoute from '@/app/api/tasks/route';
import { PATCH as patchTask } from '@/app/api/tasks/[id]/route';
import { POST as addComment } from '@/app/api/tasks/[id]/comments/route';
import { POST as addQ } from '@/app/api/tasks/[id]/questions/route';
import * as projectsRoute from '@/app/api/projects/route';
import { PATCH as patchProject } from '@/app/api/projects/[id]/route';
import { GET as projectSnapshot } from '@/app/api/projects/[id]/engagement-snapshot/route';
import { POST as startBrief } from '@/app/api/projects/[id]/engagement-brief/route';
import * as waitsRoute from '@/app/api/waits/route';
import { PATCH as patchWait } from '@/app/api/waits/[id]/route';
import { dox, idParams, makeFixture, BOT_ID, type Fx } from './fixture';
import { BOT_USER_IDS, MIKE_USER_ID } from '@/lib/oracle/projects/gate-constants';

const authMock = requireAuth as Mock;
const as = (a: AuthPayload) => authMock.mockResolvedValue(a);
const twoLanes = (): AuthPayload => ({ ...dox(), lane: 'bast,dox' });
const createTask = tasksRoute.POST;
const call = (project: string | undefined, body?: unknown, method = 'POST', extra: Record<string, string> = {}) =>
  new NextRequest('http://localhost/api/x', {
    method,
    headers: { ...(project ? { 'x-dox-project': project } : {}), ...extra },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
const raw = (project: string | undefined, text: string, method = 'POST') => new NextRequest('http://localhost/api/x', { method, headers: project ? { 'x-dox-project': project } : {}, body: text });
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- response bodies are read loosely in these tests
const json = async (res: Response) => ({ status: res.status, body: (await res.json()) as Record<string, any> });
const CTX = {
  what_it_is: 'The content review has no owner and the launch date is close.',
  sources: [{ who: 'Dox', said: 'No task in the review phase has an assignee', at: '2026-11-13' }],
  checked: 'Every open task of the project was read in the snapshot.',
  unknown: 'Whether Sabeen has room this week.',
  if_nobody: 'Dox assigns the review to Sabeen and notes it on the project.',
  if_nobody_action: 'go_with_recommendation' as const,
  options: [{ id: 'a', label: 'Sabeen reviews', consequence: 'Starts Monday.' }, { id: 'b', label: 'Lisa reviews', consequence: 'Starts later.' }],
  recommended_option_id: 'a',
  recommend_why: 'Sabeen wrote it.',
};
const HOURS = 3600 * 1000;

describe.skipIf(!SCRATCH)('Dox escape attempts (real database)', () => {
  let fx: Fx;
  let P: string, L2: string, NOPASS: string, QUOTE: string, QUEUE: string, SUSP: string;
  let staff: string;
  let reviewTask: string, personTask: string, botRecent: string, botDead: string, plainTask: string;
  const ghost = '7f1c0000-0000-4000-8000-0000000000bb'; // an id that is not a user: what a client contact looks like to the users table

  beforeAll(async () => {
    fx = await makeFixture('doxesc');
    P = await fx.mkProject('Play', { status: 'ready' });
    L2 = await fx.mkProject('Second live', { status: 'in_progress' });
    NOPASS = await fx.mkProject('No pass', { status: 'ready' });
    QUOTE = await fx.mkProject('Quote', { status: 'quote' });
    QUEUE = await fx.mkProject('Queue', { status: 'queue' });
    SUSP = await fx.mkProject('Suspended', { status: 'suspended' });
    staff = await fx.mkStaff('Sabeen');
    await fx.openPass(P);
    await fx.openPass(L2);
    reviewTask = await fx.mkTask('In review', { project_id: P, status: 'review' });
    personTask = await fx.mkTask('Person holds', { project_id: P, status: 'in_progress', assignee_id: staff });
    botRecent = await fx.mkTask('Bot recent', { project_id: P, status: 'in_progress', assignee_id: BOT_ID });
    botDead = await fx.mkTask('Bot dead', { project_id: P, status: 'in_progress', assignee_id: BOT_ID });
    plainTask = await fx.mkTask('Plain', { project_id: P, status: 'not_started' });
    for (const id of [personTask, botDead]) await prisma.$executeRaw`UPDATE tasks SET updated_at = now() - interval '72 hours' WHERE id = ${id}::uuid`;
  });
  afterAll(async () => {
    await prisma.taskQuestion.deleteMany({ where: { task: { project_id: { in: fx.projectIds } } } });
    await prisma.taskQuestion.deleteMany({ where: { task_id: { in: fx.taskIds } } });
    await prisma.comment.deleteMany({ where: { task: { project_id: { in: fx.projectIds } } } });
    await prisma.wait.deleteMany({ where: { project_id: { in: fx.projectIds } } });
    await fx.cleanup();
    await prisma.$disconnect();
  });

  const taskRow = (id: string) => prisma.task.findUniqueOrThrow({ where: { id } });

  describe('the project binding is real, not a header the caller picks', () => {
    it.each([
      ['another project (header names a live project with a pass, task is elsewhere)', () => call(L2, { assignee_id: staff }, 'PATCH'), 'dox_outside_project'],
      ['a lying header (a live project with NO open pass)', () => call(NOPASS, { assignee_id: staff }, 'PATCH'), 'dox_outside_project'],
      ['no header at all', () => call(undefined, { assignee_id: staff }, 'PATCH'), 'dox_no_project'],
    ])('PATCH: %s is refused', async (_n, mk, code) => {
      as(dox());
      const res = await json(await patchTask(mk(), idParams(plainTask)));
      expect(res.status).toBe(403);
      expect(res.body.code).toBe(code);
      expect((await taskRow(plainTask)).assignee_id).toBeNull();
    });

    it('a task of a project with no pass is refused even with the right header', async () => {
      const t = await fx.mkTask('No pass task', { project_id: NOPASS, status: 'not_started' });
      as(dox());
      const res = await json(await patchTask(call(NOPASS, { assignee_id: staff }, 'PATCH'), idParams(t)));
      expect([res.status, res.body.code]).toEqual([403, 'dox_no_pass']);
      expect((await json(await createTask(call(NOPASS, { title: `${fx.tag} n`, project_id: NOPASS })))).body.code).toBe('dox_no_pass');
    });

    it.each([
      ['quote', () => QUOTE],
      ['queue', () => QUEUE],
      ['suspended', () => SUSP],
    ])('a %s project is never written, even with a pass and the right header', async (_n, pid) => {
      const project = pid();
      await fx.openPass(project); // the strongest case: the pass exists
      const t = await fx.mkTask(`In ${_n}`, { project_id: project, status: 'not_started' });
      as(dox());
      for (const res of [
        await patchTask(call(project, { assignee_id: staff }, 'PATCH'), idParams(t)),
        await createTask(call(project, { title: `${fx.tag} z`, project_id: project })),
        await patchProject(call(project, { target_date: '2026-12-01T12:00:00.000Z' }, 'PATCH'), idParams(project)),
        await waitsRoute.POST(call(project, { template_key: 'handoff.generic', subject: 's', project_id: project })),
        await addComment(call(project, { content: 'note' }), idParams(t)),
        await addQ(call(project, { ...CTX, question: 'Is this closed to Dox?' }), idParams(t)),
      ]) {
        const r = await json(res);
        expect(r.status, JSON.stringify(r.body)).toBe(403);
        expect(r.body.code).toBe('dox_project_closed');
      }
      expect((await taskRow(t)).assignee_id).toBeNull();
    });

    it('a pass that is finished, older than a day, or started by another lane does not open the door', async () => {
      const mk = async (name: string, lane: string | null, extra: Record<string, unknown>) => {
        const p = await fx.mkProject(name, { status: 'ready' });
        await fx.openPass(p, lane, extra);
        const t = await fx.mkTask(name, { project_id: p, status: 'not_started' });
        return { p, t };
      };
      const cases = [
        await mk('finished', 'dox', { finished_at: new Date() }),
        await mk('stale', 'dox', { started_at: new Date(Date.now() - 25 * HOURS) }),
        await mk('bast-lane', 'bast', {}),
        await mk('session', null, {}),
      ];
      as(dox());
      for (const c of cases) {
        const r = await json(await patchTask(call(c.p, { assignee_id: staff }, 'PATCH'), idParams(c.t)));
        expect([r.status, r.body.code]).toEqual([403, 'dox_no_pass']);
      }
    });

    it('a pass started through the Dox lane (the passes route) opens it, and finishing it closes it again', async () => {
      const { POST: startPass } = await import('@/app/api/engagement-briefs/[id]/passes/route');
      const { PATCH: patchPass } = await import('@/app/api/engagement-passes/[id]/route');
      const p = await fx.mkProject('Sweep', { status: 'ready' });
      const t = await fx.mkTask('Sweep task', { project_id: p, status: 'not_started' });
      as(dox());
      const brief = await json(await startBrief(call(undefined), idParams(p)));
      expect(brief.status).toBe(201);
      expect((await json(await patchTask(call(p, { assignee_id: staff }, 'PATCH'), idParams(t)))).body.code).toBe('dox_no_pass');
      const pass = await json(await startPass(call(undefined, { mode: 'dry' }), idParams(brief.body.id)));
      expect(pass.status, JSON.stringify(pass.body)).toBe(201);
      expect((await prisma.engagementPass.findUniqueOrThrow({ where: { id: pass.body.id } })).lane).toBe('dox');
      expect((await patchTask(call(p, { assignee_id: staff }, 'PATCH'), idParams(t))).status).toBe(200);
      expect((await patchPass(call(undefined, { finished: true }, 'PATCH'), idParams(pass.body.id))).status).toBe(200);
      expect((await json(await patchTask(call(p, { assignee_id: null }, 'PATCH'), idParams(t)))).body.code).toBe('dox_no_pass');
    });

    it('a quote project\'s snapshot and brief are closed without a pass; other live projects stay readable', async () => {
      const quote = await fx.mkProject('Quote for reads', { status: 'quote' });
      as(dox());
      const q = await json(await projectSnapshot(call(undefined, undefined, 'GET'), idParams(quote)));
      expect([q.status, q.body.code]).toEqual([403, 'dox_quote_closed']);
      expect((await json(await startBrief(call(undefined), idParams(quote)))).body.code).toBe('dox_quote_closed');
      expect((await projectSnapshot(call(undefined, undefined, 'GET'), idParams(NOPASS))).status).toBe(200);
      expect((await projectSnapshot(call(undefined, undefined, 'GET'), idParams(L2))).status).toBe(200);
      // with an open pass on the quote project (its brief is the owner's), it reads
      await fx.openPass(quote);
      expect((await projectSnapshot(call(undefined, undefined, 'GET'), idParams(quote))).status).toBe(200);
    });
  });

  describe('fields and tags', () => {
    it.each([
      ['status done', { status: 'done' }],
      ['status review', { status: 'review' }],
      ['status abandoned', { status: 'abandoned' }],
      ['client_visible', { client_visible: true }],
      ['site_id', { site_id: '7f1c0000-0000-4000-8000-0000000000cc' }],
      ['client_id', { client_id: '7f1c0000-0000-4000-8000-0000000000cc' }],
      ['project_id', { project_id: '7f1c0000-0000-4000-8000-0000000000cc' }],
      ['approved', { approved: true }],
      ['requirements', { requirements: [] }],
      ['title', { title: 'renamed' }],
      ['description', { description: 'rewritten' }],
      ['phase_id (refused, not silently dropped)', { phase_id: '7f1c0000-0000-4000-8000-0000000000cc' }],
    ])('PATCH a task: %s is refused and nothing changes', async (_n, body) => {
      as(dox());
      const before = await taskRow(plainTask);
      const r = await json(await patchTask(call(P, body, 'PATCH'), idParams(plainTask)));
      expect(r.status, JSON.stringify(r.body)).toBe(403);
      expect(r.body.code).toMatch(/^dox_/);
      const after = await taskRow(plainTask);
      expect(after.status).toBe(before.status);
      expect(after.title).toBe(before.title);
      expect(after.client_visible).toBe(before.client_visible);
    });

    it.each(['kickoff', 'needs-mike', 'client-approved', 'security', 'cockpit-owned', 'setup:not-a-card'])('create with the tag %s is refused and creates nothing', async (tag) => {
      as(dox());
      const r = await json(await createTask(call(P, { title: `${fx.tag} tagged ${tag}`, project_id: P, tags: ['from-dox', tag] })));
      expect([r.status, r.body.code]).toEqual([403, 'dox_tag_closed']);
      expect(await prisma.task.count({ where: { title: { startsWith: `${fx.tag} tagged` } } })).toBe(0);
    });

    it('create allows from-dox and setup:<card of this project>, but not setup:<card of another project>', async () => {
      const card = await fx.mkTask('Setup card', { project_id: P, status: 'not_started' });
      const foreign = await fx.mkTask('Foreign card', { project_id: L2, status: 'not_started' });
      as(dox());
      const ok = await json(await createTask(call(P, { title: `${fx.tag} ok tags`, project_id: P, tags: ['from-dox', `setup:${card}`] })));
      expect(ok.status, JSON.stringify(ok.body)).toBe(201);
      fx.taskIds.push(ok.body.id);
      expect((await taskRow(ok.body.id)).tags.sort()).toEqual(['from-dox', `setup:${card}`].sort());
      expect((await json(await createTask(call(P, { title: `${fx.tag} bad setup`, project_id: P, tags: [`setup:${foreign}`] })))).body.code).toBe('dox_tag_closed');
    });

    it('needs-pm-release comes off only a card released from Triage', async () => {
      const bare = await fx.mkTask('Held, not released', { project_id: P, status: 'not_started', tags: ['needs-pm-release'] });
      const released = await fx.mkTask('Held, released', { project_id: P, status: 'not_started', tags: ['needs-pm-release', 'from-triage'] });
      const adhoc = await fx.mkTask('Ad hoc released', { status: 'not_started', tags: ['needs-pm-release', 'from-triage'] });
      as(dox());
      expect((await json(await patchTask(call(P, { tags_remove: ['needs-pm-release'] }, 'PATCH'), idParams(bare)))).body.code).toBe('dox_tag_closed');
      expect((await patchTask(call(P, { tags_remove: ['needs-pm-release'] }, 'PATCH'), idParams(released))).status).toBe(200);
      expect((await patchTask(call(undefined, { tags_remove: ['needs-pm-release'] }, 'PATCH'), idParams(adhoc))).status).toBe(200);
      expect((await taskRow(bare)).tags).toContain('needs-pm-release');
      expect((await taskRow(released)).tags).toEqual(['from-triage']);
    });
  });

  describe('assignees', () => {
    it('refuses a client contact id (400, not a crash), another bot user, and an inactive user; allows staff', async () => {
      const gone = await fx.mkStaff('Gone');
      await prisma.user.update({ where: { id: gone }, data: { is_active: false } });
      const other = BOT_USER_IDS.find((b) => b !== BOT_ID)!;
      await prisma.user.upsert({ where: { id: other }, update: {}, create: { id: other, email: `bot2-${fx.tag}@example.test`, password_hash: 'x', name: 'Other bot', role: 'pm' } });
      as(dox());
      expect((await json(await patchTask(call(P, { assignee_id: ghost }, 'PATCH'), idParams(plainTask)))).status).toBe(400);
      expect((await json(await createTask(call(P, { title: `${fx.tag} c`, project_id: P, assignee_id: ghost })))).status).toBe(400);
      expect((await json(await patchTask(call(P, { assignee_id: other }, 'PATCH'), idParams(plainTask)))).body.code).toBe('dox_assignee_closed');
      expect((await json(await patchTask(call(P, { assignee_id: gone }, 'PATCH'), idParams(plainTask)))).status).toBe(400);
      expect((await taskRow(plainTask)).assignee_id).toBeNull();
      expect((await patchTask(call(P, { assignee_id: staff }, 'PATCH'), idParams(plainTask))).status).toBe(200);
      await prisma.task.update({ where: { id: plainTask }, data: { assignee_id: null } });
    });

    it('a task created for Bast inside a project with a pass is tagged from-dox; assigning Bast on a card with no project is refused', async () => {
      as(dox());
      const made = await json(await createTask(call(P, { title: `${fx.tag} agent work`, project_id: P, assignee_id: BOT_ID })));
      expect(made.status, JSON.stringify(made.body)).toBe(201);
      fx.taskIds.push(made.body.id);
      const row = await taskRow(made.body.id);
      expect(row.assignee_id).toBe(BOT_ID);
      expect(row.tags).toContain('from-dox');
      const adhoc = await fx.mkTask('Ad hoc card', { status: 'not_started', tags: ['from-triage'] });
      expect((await json(await patchTask(call(undefined, { assignee_id: BOT_ID }, 'PATCH'), idParams(adhoc)))).body.code).toBe('dox_assignee_closed');
      const ok = await patchTask(call(P, { assignee_id: BOT_ID }, 'PATCH'), idParams(plainTask));
      expect(ok.status).toBe(200);
      expect((await taskRow(plainTask)).tags).toContain('from-dox');
      await prisma.task.update({ where: { id: plainTask }, data: { assignee_id: null, tags: [] } });
    });
  });

  describe('hand-back and blockers', () => {
    it('never hands back a person\'s task, however long it sat; a recent bot hold stays; a dead bot hold goes back', async () => {
      as(dox());
      for (const t of [personTask, botRecent]) {
        const r = await json(await patchTask(call(P, { status: 'not_started' }, 'PATCH'), idParams(t)));
        expect([r.status, r.body.code], t).toEqual([403, 'dox_status_closed']);
        expect((await taskRow(t)).status).toBe('in_progress');
      }
      const ok = await patchTask(call(P, { status: 'not_started' }, 'PATCH'), idParams(botDead));
      expect(ok.status).toBe(200);
      expect((await taskRow(botDead)).status).toBe('not_started');
    });

    it('a bot hold with a live linked session is not dead, whatever its age', async () => {
      const t = await fx.mkTask('Bot live', { project_id: P, status: 'in_progress', assignee_id: BOT_ID });
      await prisma.$executeRaw`UPDATE tasks SET updated_at = now() - interval '72 hours' WHERE id = ${t}::uuid`;
      const ref = `sess-${fx.tag}`;
      const machine = await prisma.oracleMachine.create({ data: { name: `m-${fx.tag}` } });
      await prisma.oracleSession.create({ data: { external_id: ref, status: 'running', source: 'claude_code', machine_id: machine.id } as never });
      await prisma.workLink.create({ data: { kind: 'session', state: 'active', ref, target_key: `task:${t}`, attached_by: 'test' } as never });
      try {
        as(dox());
        const r = await json(await patchTask(call(P, { status: 'not_started' }, 'PATCH'), idParams(t)));
        expect([r.status, r.body.code]).toEqual([403, 'dox_status_closed']);
      } finally {
        await prisma.workLink.deleteMany({ where: { ref } });
        await prisma.oracleSession.deleteMany({ where: { external_id: ref } });
        await prisma.oracleMachine.deleteMany({ where: { id: machine.id } });
      }
    });

    it('connecting or disconnecting a blocker on a review task is refused (it would flip it to blocked); on a not-started task it works', async () => {
      const blocker = await fx.mkTask('Unfinished blocker', { project_id: P, status: 'in_progress' });
      as(dox());
      const r = await json(await patchTask(call(P, { blocked_by_ids: { connect: [blocker] } }, 'PATCH'), idParams(reviewTask)));
      expect([r.status, r.body.code]).toEqual([403, 'dox_status_closed']);
      expect((await json(await patchTask(call(P, { blocked_by_ids: { disconnect: [blocker] } }, 'PATCH'), idParams(reviewTask)))).status).toBe(403);
      expect((await taskRow(reviewTask)).status).toBe('review');
      const foreign = await fx.mkTask('Foreign blocker', { project_id: L2, status: 'in_progress' });
      expect((await json(await patchTask(call(P, { blocked_by_ids: { connect: [foreign] } }, 'PATCH'), idParams(plainTask)))).body.code).toBe('dox_outside_project');
      expect((await patchTask(call(P, { blocked_by_ids: { connect: [blocker] } }, 'PATCH'), idParams(plainTask))).status).toBe(200);
      expect((await taskRow(plainTask)).status).toBe('blocked');
      await prisma.task.update({ where: { id: plainTask }, data: { status: 'not_started', blocked_by: { set: [] } } });
    });
  });

  describe('waits', () => {
    const mkWait = (extra: Record<string, unknown>) =>
      prisma.wait.create({
        data: { kind: 'approval', template_key: 'charter.price_review', title: `${fx.tag} price review`, duration_value: 2, duration_unit: 'business_days', due_at: new Date(Date.now() + 48 * HOURS), terminal_action: 'escalate', project_id: P, ...extra } as never,
      });

    it('a price review cannot be redated, cancelled or resolved, and none can be opened; no wait that sends can be opened', async () => {
      const w = await mkWait({});
      as(dox());
      for (const body of [{ action: 'redate', due_at: '2026-12-31T15:00:00.000Z', reason: 'later' }, { action: 'pause', until: new Date(Date.now() + 5 * HOURS).toISOString() }, { action: 'resolve', resolution: 'cancelled' }]) {
        const r = await json(await patchWait(call(P, body, 'PATCH'), idParams(w.id)));
        expect([r.status, r.body.code], JSON.stringify(body)).toEqual([403, 'dox_wait_closed']);
      }
      const after = await prisma.wait.findUniqueOrThrow({ where: { id: w.id } });
      expect(after.state).toBe('waiting');
      expect(after.due_at.getTime()).toBe(w.due_at.getTime());
      expect((await json(await waitsRoute.POST(call(P, { template_key: 'charter.price_review', subject: 'x', project_id: P })))).body.code).toBe('dox_wait_closed');
      expect((await json(await waitsRoute.POST(call(P, { template_key: 'build.kickoff_booking', subject: 'x', project_id: P })))).body.code).toBe('dox_wait_closed');
    });

    it('wait writes are bound to the project in play: another project, no project, or a task of another project is refused', async () => {
      const elsewhere = await mkWait({ template_key: 'handoff.generic', kind: 'handoff', project_id: L2 });
      const t = await fx.mkTask('Wait task', { project_id: P, status: 'not_started' });
      const foreignTask = await fx.mkTask('Foreign wait task', { project_id: L2, status: 'not_started' });
      as(dox());
      const open = (b: Record<string, unknown>) => waitsRoute.POST(call(P, { template_key: 'handoff.generic', subject: `${fx.tag} s`, ...b }));
      for (const b of [{ project_id: L2 }, {}, { project_id: P, task_id: foreignTask }, { client_id: fx.clientId }]) {
        const r = await json(await open(b));
        expect([r.status, r.body.code], JSON.stringify(b)).toEqual([403, 'dox_outside_project']);
      }
      expect((await json(await patchWait(call(P, { action: 'redate', due_at: '2026-12-31T15:00:00.000Z', reason: 'x' }, 'PATCH'), idParams(elsewhere.id)))).body.code).toBe('dox_outside_project');
      const ok = await json(await open({ project_id: P, task_id: t, owner_user_id: staff, duration: { value: 2, unit: 'business_days' }, idempotency_key: `${fx.tag}-ok` }));
      expect([200, 201], JSON.stringify(ok.body)).toContain(ok.status);
    });
  });

  describe('projects', () => {
    it('a project whose tasks are all abandoned cannot be closed as done; one done task and nothing open can', async () => {
      const ab = await fx.mkProject('All abandoned', { status: 'in_progress' });
      await fx.openPass(ab);
      await fx.mkTask('gone 1', { project_id: ab, status: 'abandoned' });
      await fx.mkTask('gone 2', { project_id: ab, status: 'abandoned' });
      const empty = await fx.mkProject('Empty', { status: 'in_progress' });
      await fx.openPass(empty);
      const withTriage = await fx.mkProject('Done plus a triage card', { status: 'in_progress' });
      await fx.openPass(withTriage);
      await fx.mkTask('finished', { project_id: withTriage, status: 'done' });
      await fx.mkTask('parked', { project_id: withTriage, status: 'triage' });
      as(dox());
      for (const p of [ab, empty, withTriage]) {
        const r = await json(await patchProject(call(p, { status: 'done' }, 'PATCH'), idParams(p)));
        expect([r.status, r.body.code]).toEqual([403, 'dox_project_open']);
        expect((await prisma.project.findUniqueOrThrow({ where: { id: p } })).status).toBe('in_progress');
      }
      await fx.mkTask('finished too', { project_id: ab, status: 'done' });
      expect((await patchProject(call(ab, { status: 'done' }, 'PATCH'), idParams(ab))).status).toBe(200);
    });

    it('creates a small project for a released card: ready, linked, one per card; refuses everything else', async () => {
      const card = await fx.mkTask('Released ad hoc card', { status: 'not_started', tags: ['from-triage'], client_id: fx.clientId });
      const body = { name: `${fx.tag} Small job`, type: 'internal', client_id: fx.clientId, status: 'ready' };
      const make = (b: unknown, cardId: string | undefined = card) => projectsRoute.POST(call(undefined, b, 'POST', cardId ? { 'x-dox-card': cardId } : {}));
      as(dox());
      // refusals first
      expect((await json(await projectsRoute.POST(call(undefined, body)))).body.code).toBe('dox_no_card');
      expect((await json(await make({ ...body, status: 'quote' }))).body.code).toBe('dox_status_closed');
      expect((await json(await make({ ...body, status: undefined }))).body.code).toBe('dox_status_closed');
      expect((await json(await make({ ...body, budget_amount: 5000 }))).body.code).toBe('dox_field_closed');
      expect((await json(await make({ ...body, portal_visibility: 'hidden' }))).body.code).toBe('dox_field_closed');
      expect((await json(await make({ ...body, type: 'project', client_id: '7f1c0000-0000-4000-8000-0000000000dd' }))).body.code).toBe('dox_field_closed');
      const unreleased = await fx.mkTask('Never released', { status: 'not_started' });
      const inTriage = await fx.mkTask('Still in Triage', { status: 'triage', tags: ['from-triage'] });
      const setup = await fx.mkTask('A setup card', { status: 'not_started', tags: ['from-triage'], triage_kind: 'project_setup' });
      const addition = await fx.mkTask('An addition', { status: 'not_started', tags: ['from-triage'], triage_kind: 'project_addition' });
      for (const c of [unreleased, inTriage, setup, addition]) expect((await json(await make(body, c))).body.code, c).toBe('dox_card_closed');
      expect(await prisma.project.count({ where: { name: `${fx.tag} Small job` } })).toBe(0);
      // the allowed one
      const made = await json(await make(body));
      expect(made.status, JSON.stringify(made.body)).toBe(201);
      fx.projectIds.push(made.body.id);
      const proj = await prisma.project.findUniqueOrThrow({ where: { id: made.body.id } });
      expect([proj.status, proj.type]).toEqual(['ready', 'internal']);
      expect((await taskRow(card)).project_id).toBe(proj.id);
      // one project per card
      expect((await json(await make({ ...body, name: `${fx.tag} Second` }))).body.code).toBe('dox_card_closed');
      expect(await prisma.project.count({ where: { name: `${fx.tag} Second` } })).toBe(0);
      // a client project for the card's own client is allowed too (and only that client)
      const card2 = await fx.mkTask('Second released card', { status: 'not_started', tags: ['from-triage'], client_id: fx.clientId, triage_kind: 'task' });
      const m2 = await json(await make({ name: `${fx.tag} Client job`, type: 'project', client_id: fx.clientId, status: 'ready' }, card2));
      expect(m2.status, JSON.stringify(m2.body)).toBe(201);
      fx.projectIds.push(m2.body.id);
    });
  });

  describe('bodies and lanes', () => {
    it('a null body is a 400 on every Dox write, never a 500', async () => {
      as(dox());
      const cases: [string, Response][] = [
        ['task create', await createTask(raw(P, 'null'))],
        ['task patch', await patchTask(raw(P, 'null', 'PATCH'), idParams(plainTask))],
        ['project patch', await patchProject(raw(P, 'null', 'PATCH'), idParams(P))],
        ['project create', await projectsRoute.POST(raw(undefined, 'null'))],
      ];
      for (const [name, res] of cases) expect(res.status, name).toBe(400);
    });

    it('a key that carries two lanes is held to the same rules', async () => {
      as(twoLanes());
      const r1 = await json(await patchTask(call(P, { status: 'done' }, 'PATCH'), idParams(plainTask)));
      expect([r1.status, r1.body.code]).toEqual([403, 'dox_status_closed']);
      expect((await json(await createTask(call(P, { title: `${fx.tag} two lane`, project_id: P, tags: ['security'] })))).body.code).toBe('dox_tag_closed');
      expect((await json(await patchProject(call(L2, { name: 'x' }, 'PATCH'), idParams(L2)))).body.code).toBe('dox_field_closed');
      expect((await json(await patchProject(call(P, { status: 'cancelled' }, 'PATCH'), idParams(P)))).status).toBe(403);
      expect((await json(await waitsRoute.POST(call(P, { template_key: 'charter.price_review', subject: 'x', project_id: P })))).body.code).toBe('dox_wait_closed');
      expect((await addComment(call(P, { content: 'hi', client_visible: true }), idParams(plainTask))).status).toBe(403);
      expect(await prisma.task.count({ where: { title: `${fx.tag} two lane` } })).toBe(0);
    });
  });

  describe('questions: a settled cause is not asked again', () => {
    it('an answered question comes back with its answer instead of a second one', async () => {
      const t = await fx.mkTask('Answered cause', { project_id: P, status: 'not_started' });
      as(dox());
      const first = await json(await addQ(call(P, { ...CTX, question: 'Who owns the review?', cause_key: 'stuck:owner' }), idParams(t)));
      expect(first.status).toBe(201);
      await prisma.taskQuestion.update({ where: { id: first.body.id }, data: { state: 'answered', answer_option_id: 'a', answered_at: new Date(), answered_by_id: MIKE_USER_ID } });
      const again = await json(await addQ(call(P, { ...CTX, question: 'Who should own the review now?', cause_key: 'stuck:owner' }), idParams(t)));
      expect(again.status).toBe(200);
      expect(again.body).toMatchObject({ id: first.body.id, deduped: true, state: 'answered', answer_option_id: 'a' });
      // a changed cause is a different key, so a different question
      expect((await addQ(call(P, { ...CTX, question: 'Who owns the QA now?', cause_key: 'stuck:qa-owner' }), idParams(t))).status).toBe(201);
    });
  });
});

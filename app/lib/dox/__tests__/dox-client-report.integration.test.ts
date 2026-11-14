// @vitest-environment node
/** Dox client reports against a real scratch Postgres, through the real routes: who sets the fields, the client pass, the draft task. */
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { NextRequest } from 'next/server';
import type { Mock } from 'vitest';

vi.mock('@/lib/auth/middleware', async (orig) => ({ ...(await orig<typeof import('@/lib/auth/middleware')>()), requireAuth: vi.fn() }));

import { prisma } from '@/lib/db/prisma';
import { requireAuth, type AuthPayload } from '@/lib/auth/middleware';
import { SCRATCH } from '@/lib/engine/__tests__/seed';
import * as tasksRoute from '@/app/api/tasks/route';
import { PATCH as patchBrief } from '@/app/api/engagement-briefs/[id]/route';
import { POST as startPass } from '@/app/api/engagement-briefs/[id]/passes/route';
import { PATCH as patchPass } from '@/app/api/engagement-passes/[id]/route';
import { GET as getProjectBrief, POST as startBrief } from '@/app/api/projects/[id]/engagement-brief/route';
import { dox, mikeSession, chatLane, idParams, makeFixture, BOT_ID, type Fx } from './fixture';
import { MIKE_USER_ID } from '@/lib/oracle/projects/gate-constants';

const authMock = requireAuth as Mock;
const as = (a: AuthPayload) => authMock.mockResolvedValue(a);
const call = (project: string | undefined, body: unknown, method = 'PATCH') =>
  new NextRequest('http://localhost/api/x', { method, headers: project ? { 'x-dox-project': project } : {}, body: method === 'GET' ? undefined : JSON.stringify(body) });
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- response bodies are read loosely in these tests
const json = async (res: Response) => ({ status: res.status, body: (await res.json()) as Record<string, any> });
const DAY = 24 * 3600 * 1000;
const draft = (extra: Record<string, unknown> = {}) => ({ to: ['jane@client.com'], subject: 'Your Friday update', body: 'We finished the home page this week.', ...extra });
const SOW = { kind: 'sow', label: 'SOW v2', quote: 'Weekly status report every Friday.' };

describe.skipIf(!SCRATCH)('Dox client reports (real database)', () => {
  let fx: Fx;
  let P: string;
  let briefId: string;

  const briefOf = (project: string) => prisma.engagementBrief.findUniqueOrThrow({ where: { project_id: project } });
  /** A fresh project with a brief that has a weekly Friday report set long ago, so a report is due now. */
  async function dueProject(name: string, extra: Record<string, unknown> = {}, briefExtra: Record<string, unknown> = {}) {
    const p = await fx.mkProject(name, { status: 'in_progress', ...extra });
    await fx.openPass(p, 'dox', { mode: 'dry', kind: 'sweep', finished_at: new Date() });
    const b = await briefOf(p);
    await prisma.engagementBrief.update({ where: { id: b.id }, data: { report_cadence: 'weekly', report_day: 'fri', last_report_at: new Date(Date.now() - 30 * DAY), report_to: ['jane@client.com'], ...briefExtra } });
    return { p, b: b.id };
  }
  const clientPass = (brief: string, lane: string | null = 'dox', kind = 'client') =>
    prisma.engagementPass.create({ data: { brief_id: brief, mode: 'dry', kind, lane } }).then((r) => r.id);

  beforeAll(async () => {
    fx = await makeFixture('creport');
    P = await fx.mkProject('Report project', { status: 'in_progress' });
    await fx.openPass(P); // a live dox pass on P
    briefId = (await briefOf(P)).id;
  });
  afterAll(async () => {
    await prisma.comment.deleteMany({ where: { task: { project_id: { in: fx.projectIds } } } });
    await fx.cleanup();
    await prisma.$disconnect();
  });

  describe('who sets the fields', () => {
    it('the chat lane sets them with no quote and is recorded as Mike', async () => {
      as(chatLane());
      const res = await json(await patchBrief(call(undefined, { report_cadence: 'weekly', report_day: 'fri', report_to: ['Jane@Client.com', 'jane@client.com'] }), idParams(briefId)));
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(res.body.report_cadence).toBe('weekly');
      expect(res.body.report_day).toBe('fri');
      expect(res.body.report_to).toEqual(['jane@client.com']);
      expect(res.body.report_source.kind).toBe('mike');
      expect(typeof res.body.next_report_on).toBe('string');
      expect(res.body.cadence).toBe('auto'); // sweep cadence untouched
      const got = await json(await getProjectBrief(call(undefined, {}, 'GET'), idParams(P)));
      expect(got.status).toBe(200);
      expect(got.body.next_report_on).toBe(res.body.next_report_on);
    });
    it('Mike\'s own un-laned key turns a report off, changes the mode and starts a brief; another user\'s key and a laned key may not', async () => {
      const ownKey = (): AuthPayload => ({ userId: MIKE_USER_ID, role: 'admin', email: 'mike@test', via: 'api_key', apiKeyId: 'km' });
      const p2 = await fx.mkProject('Own key project', { status: 'in_progress' });
      as(ownKey());
      const made = await json(await startBrief(call(undefined, {}, 'POST'), idParams(p2)));
      expect([200, 201], JSON.stringify(made.body)).toContain(made.status);
      const b2 = (await briefOf(p2)).id;
      const off = await json(await patchBrief(call(undefined, { report_cadence: 'none', owner_mode: 'dry' }), idParams(b2)));
      expect(off.status, JSON.stringify(off.body)).toBe(200);
      expect(off.body.report_cadence).toBe('none');
      expect(off.body.report_source.kind).toBe('mike');
      as({ ...ownKey(), userId: BOT_ID });
      expect((await json(await patchBrief(call(undefined, { report_cadence: 'weekly', report_day: 'fri' }), idParams(b2)))).body.code).toBe('brief_forbidden');
      as({ ...ownKey(), lane: 'worker', laneEnforced: true });
      expect((await json(await patchBrief(call(undefined, { owner_mode: 'live' }), idParams(b2)))).body.code).toBe('brief_forbidden');
      expect((await json(await startBrief(call(undefined, {}, 'POST'), idParams(p2)))).body.code).toBe('brief_forbidden');
    });
    it('Mike\'s session may send a day with the cadence only when both are there', async () => {
      as(mikeSession());
      const bad = await json(await patchBrief(call(undefined, { report_cadence: 'monthly', report_day: null }), idParams(briefId)));
      expect(bad.status).toBe(422);
      expect(bad.body.code ?? bad.body.error?.code).toBe('report_day_required');
      const ok = await json(await patchBrief(call(undefined, { report_cadence: 'weekly', report_day: 'fri' }), idParams(briefId)));
      expect(ok.status).toBe(200);
    });
    it('the Dox lane is refused without a source, with kind mike, and on the sweep cadence or mode', async () => {
      as(dox());
      expect((await patchBrief(call(P, { report_cadence: 'weekly', report_day: 'fri' }), idParams(briefId))).status).toBe(422);
      expect((await patchBrief(call(P, { report_day: 'fri', report_source: { kind: 'mike', label: 'x', quote: 'q' } }), idParams(briefId))).status).toBe(422);
      expect((await patchBrief(call(P, { report_day: 'fri', report_source: { kind: 'sow', label: 'x' } }), idParams(briefId))).status).toBe(422);
      expect((await patchBrief(call(P, { cadence: 'daily' }), idParams(briefId))).status).toBe(403);
      expect((await patchBrief(call(P, { owner_mode: 'live', report_source: SOW }), idParams(briefId))).status).toBe(403);
    });
    it('the Dox lane is refused without a live pass', async () => {
      const q = await fx.mkProject('No pass', { status: 'in_progress' });
      await prisma.engagementBrief.create({ data: { project_id: q, label: 'b', cadence: 'auto', owner_mode: 'dry', allowed_actions: [] } });
      const qb = await briefOf(q);
      as(dox());
      const res = await patchBrief(call(q, { report_day: 'fri', report_source: SOW }), idParams(qb.id));
      expect(res.status).toBe(403);
      await prisma.engagementPass.create({ data: { brief_id: qb.id, mode: 'dry', lane: 'dox' } });
      expect((await patchBrief(call(q, { report_day: 'fri', report_source: SOW }), idParams(qb.id))).status).toBe(403);
    });
    it('the Dox lane is refused over a value whose source is Mike, then succeeds on a clean brief with a SOW source', async () => {
      as(dox());
      // P's source is Mike's from the chat above
      const refused = await json(await patchBrief(call(P, { report_day: 'thu', report_source: SOW }), idParams(briefId)));
      expect(refused.status).toBe(403);
      expect((await briefOf(P)).report_day).toBe('fri');
      const q = await fx.mkProject('Clean', { status: 'ready' });
      await fx.openPass(q);
      const qb = await briefOf(q);
      const ok = await json(await patchBrief(call(q, { report_cadence: 'every_2_weeks', report_day: 'fri', report_to: ['pm@client.com'], report_source: SOW }), idParams(qb.id)));
      expect(ok.status, JSON.stringify(ok.body)).toBe(200);
      expect(ok.body.report_source).toMatchObject({ kind: 'sow', quote: SOW.quote });
      expect(ok.body.report_source.by).toBeTruthy();
      expect(ok.body.report_to).toEqual(['pm@client.com']);
      // and over its own earlier SOW value
      const again = await json(await patchBrief(call(q, { report_day: 'mon', report_source: { kind: 'client_email', label: 'Email', quote: 'Mondays please.' } }), idParams(qb.id)));
      expect(again.status).toBe(200);
    });
  });

  describe('the client pass and the draft', () => {
    it('opens a dry client pass on a dry brief; refused with cadence none', async () => {
      const { b } = await dueProject('Dry client');
      as(dox());
      const ok = await json(await startPass(call(undefined, { mode: 'dry', kind: 'client' }, 'POST'), idParams(b)));
      expect(ok.status, JSON.stringify(ok.body)).toBe(201);
      expect(ok.body.kind).toBe('client');
      await prisma.engagementBrief.update({ where: { id: b }, data: { report_cadence: 'none' } });
      const no = await json(await startPass(call(undefined, { mode: 'dry', kind: 'client' }, 'POST'), idParams(b)));
      expect(no.status).toBe(409);
      expect(no.body.code ?? no.body.error?.code).toBe('no_report_cadence');
    });

    it('a client_report makes Mike\'s task, stamps last_report_at and not last_pass_at; a second one the same day is 409', async () => {
      const { p, b } = await dueProject('Draft one', {}, { report_source: { kind: 'sow', label: 'x', at: new Date(Date.now() - 40 * DAY).toISOString() } });
      const pass = await clientPass(b);
      as(dox());
      const ok = await json(await patchPass(call(undefined, { client_report: draft(), finished: true }), idParams(pass)));
      expect(ok.status, JSON.stringify(ok.body)).toBe(200);
      expect(ok.body.actions[0]).toMatchObject({ kind: 'client_report', to: ['jane@client.com'], subject: 'Your Friday update' });
      const task = await prisma.task.findUniqueOrThrow({ where: { id: ok.body.actions[0].task_id } });
      expect(task).toMatchObject({ assignee_id: MIKE_USER_ID, status: 'not_started', project_id: p });
      expect(task.tags).toEqual(['client-report']);
      expect(task.title).toMatch(/their Friday report$/);
      expect(task.description).toContain('Gmail draft could not be made');
      expect(task.description).toContain('We finished the home page this week.');
      expect(task.due_date).toBeTruthy();
      const brief = await briefOf(p);
      expect(brief.last_report_at!.getTime()).toBeGreaterThan(Date.now() - 60000);
      expect(brief.last_pass_at).toBeNull();
      const pass2 = await clientPass(b);
      const dup = await json(await patchPass(call(undefined, { client_report: draft() }), idParams(pass2)));
      expect(dup.status).toBe(409);
      expect(dup.body.code ?? dup.body.error?.code).toBe('report_already_drafted');
    });

    it('carries the Gmail draft link first and abandons the previous open draft task', async () => {
      const { p, b } = await dueProject('Draft two');
      as(dox());
      const first = await json(await patchPass(call(undefined, { client_report: draft() }), idParams(await clientPass(b))));
      const firstTask = first.body.actions[0].task_id as string;
      await prisma.engagementBrief.update({ where: { id: b }, data: { last_report_at: new Date(Date.now() - 30 * DAY) } });
      const second = await json(await patchPass(call(undefined, { client_report: draft({ gmail_draft_id: 'r-1', gmail_draft_url: 'https://mail.google.com/mail/u/0/#drafts/xyz' }) }), idParams(await clientPass(b))));
      expect(second.status, JSON.stringify(second.body)).toBe(200);
      const t2 = await prisma.task.findUniqueOrThrow({ where: { id: second.body.actions[0].task_id } });
      expect(t2.description!.startsWith('Open the Gmail draft: https://mail.google.com/mail/u/0/#drafts/xyz')).toBe(true);
      expect(second.body.actions[0].gmail_draft_id).toBe('r-1');
      const old = await prisma.task.findUniqueOrThrow({ where: { id: firstTask }, include: { comments: true } });
      expect(old.status).toBe('abandoned');
      expect(old.comments.some((c) => c.is_internal && /Replaced by this week's draft/.test(c.content))).toBe(true);
      expect((await prisma.task.count({ where: { project_id: p, tags: { has: 'client-report' }, status: 'not_started' } }))).toBe(1);
    });

    it('is refused when the cadence is none, the project is done, the pass is a sweep, or the pass was not Dox\'s', async () => {
      const none = await dueProject('Cadence none', {}, { report_cadence: 'none' });
      const done = await dueProject('Done project', { status: 'done' });
      const ok = await dueProject('Wrong pass');
      as(dox());
      const codeOf = async (pass: string, body = draft()) => {
        const r = await json(await patchPass(call(undefined, { client_report: body }), idParams(pass)));
        return [r.status, r.body.code ?? r.body.error?.code];
      };
      expect(await codeOf(await clientPass(none.b))).toEqual([409, 'no_report_cadence']);
      expect(await codeOf(await clientPass(done.b))).toEqual([409, 'report_not_live']);
      expect(await codeOf(await clientPass(ok.b, 'dox', 'sweep'))).toEqual([409, 'client_report_pass']);
      expect(await codeOf(await clientPass(ok.b, 'bast-chat'))).toEqual([409, 'client_report_pass']);
      expect(await codeOf(await clientPass(ok.b), draft({ body: 'It costs a lot' }))).toEqual([422, 'report_money']);
      expect(await prisma.task.count({ where: { project_id: { in: [none.p, done.p, ok.p] }, tags: { has: 'client-report' } } })).toBe(0);
    });

    it('regression: Dox still cannot create a task tagged client-report', async () => {
      as(dox());
      const res = await tasksRoute.POST(call(P, { title: `${fx.tag} sneaky`, project_id: P, tags: ['client-report'] }, 'POST'));
      expect(res.status).toBe(403);
      expect(await prisma.task.count({ where: { title: { startsWith: `${fx.tag} sneaky` } } })).toBe(0);
    });
  });
});

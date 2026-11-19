// @vitest-environment node
/**
 * Dox's powers for the client email loop (Mike, 2026-11-19: "let's give Dox the power he needs to make this happen"), against a real scratch
 * Postgres through the real routes: tasks, comments, questions and answers on any live project and on a client's standalone task; the hand-off to the
 * change-request lane; filing a Triage card and setting its kind; linking a meeting to a project; reading clients, contacts, sites, meetings and email
 * asks with no secret in the answer. And what stays refused: deletes, client-visible posts, price and billing fields, credentials, Mike's word.
 */
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { NextRequest } from 'next/server';
import type { Mock } from 'vitest';

vi.mock('@/lib/auth/middleware', async (orig) => ({ ...(await orig<typeof import('@/lib/auth/middleware')>()), requireAuth: vi.fn() }));
vi.mock('@/lib/auth/actor-lane', () => ({ actorLaneField: vi.fn(async () => ({ actor_lane: 'dox' })), currentActorLane: vi.fn(async () => 'dox') }));

import { prisma } from '@/lib/db/prisma';
import { requireAuth, type AuthPayload } from '@/lib/auth/middleware';
import { SCRATCH } from '@/lib/engine/__tests__/seed';
import * as tasksRoute from '@/app/api/tasks/route';
import { PATCH as patchTask } from '@/app/api/tasks/[id]/route';
import { POST as addComment } from '@/app/api/tasks/[id]/comments/route';
import { POST as addQ } from '@/app/api/tasks/[id]/questions/route';
import { PATCH as patchQ } from '@/app/api/tasks/[id]/questions/[qid]/route';
import { POST as answerQ } from '@/app/api/tasks/[id]/questions/[qid]/answer/route';
import { PATCH as patchTriage } from '@/app/api/tasks/[id]/triage/route';
import { POST as linkMeeting } from '@/app/api/meetings/[id]/projects/route';
import { GET as getSite } from '@/app/api/sites/[id]/route';
import { GET as listSites } from '@/app/api/sites/route';
import { GET as getClient } from '@/app/api/clients/[id]/route';
import { GET as listContacts } from '@/app/api/clients/[id]/contacts/route';
import { GET as resolveContact } from '@/app/api/contacts/resolve/route';
import { GET as getMeeting } from '@/app/api/meetings/[id]/route';
import { dox, mikeSession, idParams, makeFixture, BOT_ID, type Fx } from './fixture';
import { MIKE_USER_ID } from '@/lib/oracle/projects/gate-constants';
import { redactForDox } from '../guard';

const createTask = tasksRoute.POST;
const authMock = requireAuth as Mock;
const as = (a: AuthPayload) => authMock.mockResolvedValue(a);
const call = (body?: unknown, method = 'POST', url = 'http://localhost/api/x', project?: string) =>
  new NextRequest(url, { method, headers: project ? { 'x-dox-project': project } : {}, body: body === undefined ? undefined : JSON.stringify(body) });
const get = (url = 'http://localhost/api/x') => new NextRequest(url, { method: 'GET' });
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- response bodies are read loosely in these tests
const json = async (res: Response) => ({ status: res.status, body: (await res.json()) as Record<string, any> });
const qParams = (id: string, qid: string) => ({ params: Promise.resolve({ id, qid }) });

const SECRET = 'staging-secret-do-not-leak';
const CONTEXT = {
  what_it_is: 'Where the new copy comes from.',
  sources: [{ who: 'Mike', said: 'We asked Kue on Nov 13', at: '2026-11-13' }],
  checked: 'The project plan and the copy task.',
  unknown: 'Whether the current site copy is the source.',
  if_nobody: 'The copy load waits.',
  if_nobody_action: 'wait' as const,
};
const SOURCE = { who: 'Kue Chang (Nerd Herd)', said: 'The current ThermalNetics site is the copy source of truth.', at: '2026-11-19' };

describe.skipIf(!SCRATCH)('Dox and the client email loop (real database)', () => {
  let fx: Fx;
  let LIVE: string; // a live project with no pass at all
  let QUOTE: string;
  let DRY: string; // a live project where Dox is rehearsing (a dry pass only)
  let siteId: string;
  let foreignClient: string;
  let foreignSite: string;
  let meetingId: string;
  let contactEmail: string;
  const made: string[] = [];

  beforeAll(async () => {
    fx = await makeFixture('doxloop');
    LIVE = await fx.mkProject('Live', { status: 'in_progress' });
    QUOTE = await fx.mkProject('Quote', { status: 'quote' });
    DRY = await fx.mkProject('Dry', { status: 'ready' });
    await fx.openPass(DRY, 'dox', { mode: 'dry' });
    siteId = (await prisma.site.create({ data: { name: `${fx.tag} site`, client_id: fx.clientId, staging_auth_user: 'u', staging_auth_password: SECRET } })).id;
    foreignClient = (await prisma.client.create({ data: { name: `${fx.tag} Other Co`, type: 'direct', status: 'active' } })).id;
    foreignSite = (await prisma.site.create({ data: { name: `${fx.tag} other site`, client_id: foreignClient } })).id;
    contactEmail = `kue-${fx.tag}@example.test`;
    await prisma.clientContact.create({ data: { client_id: fx.clientId, name: 'Kue', email: contactEmail } });
    meetingId = (await prisma.meeting.create({ data: { title: `${fx.tag} kickoff`, client_id: fx.clientId, meeting_date: new Date('2026-11-18T15:00:00Z'), created_by_id: MIKE_USER_ID } })).id;
  });
  afterAll(async () => {
    const ids = [...made, ...fx.taskIds];
    await prisma.taskQuestion.deleteMany({ where: { task_id: { in: ids } } });
    await prisma.comment.deleteMany({ where: { task_id: { in: ids } } });
    await prisma.activityLog.deleteMany({ where: { entity_id: { in: ids } } });
    await prisma.notification.deleteMany({ where: { entity_id: { in: ids } } });
    await prisma.task.deleteMany({ where: { id: { in: made } } });
    await prisma.meetingProject.deleteMany({ where: { meeting_id: meetingId } });
    await prisma.meeting.deleteMany({ where: { id: meetingId } });
    await prisma.clientContact.deleteMany({ where: { client_id: fx.clientId } });
    await prisma.task.deleteMany({ where: { site_id: { in: [siteId, foreignSite] } } });
    await prisma.site.deleteMany({ where: { id: { in: [siteId, foreignSite] } } });
    await fx.cleanup();
    await prisma.client.deleteMany({ where: { id: foreignClient } });
    await prisma.$disconnect();
  });

  describe('tasks on any live project, and a client\'s standalone tasks', () => {
    it('creates a task on a live project with no header and no pass; refuses a closed project and a dry one', async () => {
      as(dox());
      const ok = await json(await createTask(call({ title: `${fx.tag} copy load`, project_id: LIVE })));
      expect(ok.status, JSON.stringify(ok.body)).toBe(201);
      made.push(ok.body.id);
      const quote = await json(await createTask(call({ title: `${fx.tag} q`, project_id: QUOTE })));
      expect([quote.status, quote.body.code]).toEqual([403, 'dox_project_closed']);
      const dry = await json(await createTask(call({ title: `${fx.tag} d`, project_id: DRY })));
      expect([dry.status, dry.body.code]).toEqual([403, 'dox_pass_dry']);
      // a project task takes its client and site from the project
      expect((await json(await createTask(call({ title: `${fx.tag} s`, project_id: LIVE, site_id: siteId })))).body.code).toBe('dox_field_closed');
    });

    it('hands a live-site change to the change-request lane: a standalone task on the client\'s site, assigned to Bast, never client-visible', async () => {
      as(dox());
      const res = await json(await createTask(call({ title: `${fx.tag} swap the hero photo`, client_id: fx.clientId, site_id: siteId, assignee_id: BOT_ID, source: 'email', source_ref: '1a1f49ca102baded' })));
      expect(res.status, JSON.stringify(res.body)).toBe(201);
      made.push(res.body.id);
      const row = await prisma.task.findUniqueOrThrow({ where: { id: res.body.id } });
      expect(row.project_id).toBeNull();
      expect(row.site_id).toBe(siteId);
      expect(row.assignee_id).toBe(BOT_ID);
      expect(row.status).toBe('not_started');
      expect(row.client_visible).toBe(false);
      expect(row.requested_by_contact_id).toBeNull();
      expect(row.tags).toContain('from-dox');
    });

    it('refuses a standalone task without a client, on another client\'s site, from the portal, client-visible or with money on it', async () => {
      as(dox());
      for (const [body, status, code] of [
        [{ title: `${fx.tag} r1` }, 400, null],
        [{ title: `${fx.tag} r2`, client_id: fx.clientId, site_id: foreignSite }, 403, 'dox_outside_project'],
        [{ title: `${fx.tag} r3`, client_id: fx.clientId, source: 'portal' }, 403, 'dox_field_closed'],
        [{ title: `${fx.tag} r4`, client_id: fx.clientId, client_visible: true }, 403, 'dox_field_closed'],
        [{ title: `${fx.tag} r5`, client_id: fx.clientId, billing_amount: 250 }, 403, 'dox_field_closed'],
        [{ title: `${fx.tag} r6`, client_id: fx.clientId, is_billable: true }, 403, 'dox_field_closed'],
        [{ title: `${fx.tag} r7`, client_id: fx.clientId, staging_preview_url: 'https://x.pages.dev' }, 403, 'dox_field_closed'],
        [{ title: `${fx.tag} r8`, client_id: fx.clientId, assignee_id: '00000000-0000-4000-8000-000000000009' }, 400, null],
      ] as const) {
        const r = await json(await createTask(call(body)));
        expect(r.status, JSON.stringify(body)).toBe(status);
        if (code) expect(r.body.code).toBe(code);
      }
      expect(await prisma.task.count({ where: { title: { startsWith: `${fx.tag} r` } } })).toBe(0);
    });

    it('comments on a standalone task and on any live project\'s task, never on a closed project\'s, never for a client', async () => {
      const standalone = await fx.mkTask('Standalone', { client_id: fx.clientId, status: 'not_started' });
      const live = await fx.mkTask('Live task', { project_id: LIVE, status: 'not_started' });
      const closed = await fx.mkTask('Quote task', { project_id: QUOTE, status: 'not_started' });
      as(dox());
      expect((await addComment(call({ content: 'Kue answered the copy question. ~ Dox' }), idParams(standalone))).status).toBe(201);
      expect((await addComment(call({ content: 'Copy source settled. ~ Dox' }), idParams(live))).status).toBe(201);
      expect((await json(await addComment(call({ content: 'x' }), idParams(closed)))).body.code).toBe('dox_project_closed');
      expect((await addComment(call({ content: 'Hello client', client_visible: true }), idParams(live))).status).toBe(403);
    });

    it('task edits still need the project in play', async () => {
      const t = await fx.mkTask('Edit me', { project_id: LIVE, status: 'not_started' });
      as(dox());
      expect((await json(await patchTask(call({ due_date: '2026-12-01T12:00:00.000Z' }, 'PATCH'), idParams(t)))).body.code).toBe('dox_no_project');
    });
  });

  describe('Triage cards', () => {
    it('files a Triage card with no owner, sets its kind, and cannot sort, release or link it', async () => {
      as(dox());
      const res = await json(await createTask(call({ title: `${fx.tag} new booth pages`, status: 'triage', client_id: fx.clientId, source: 'email' })));
      expect(res.status, JSON.stringify(res.body)).toBe(201);
      made.push(res.body.id);
      const card = await prisma.task.findUniqueOrThrow({ where: { id: res.body.id } });
      expect(card.status).toBe('triage');
      expect(card.client_visible).toBe(false);
      expect(card.assignee_id).toBeNull();
      expect(card.tags).toContain('from-dox');
      const kind = await json(await patchTriage(call({ kind: 'project_setup' }, 'PATCH'), idParams(card.id)));
      expect(kind.status, JSON.stringify(kind.body)).toBe(200);
      expect((await prisma.task.findUniqueOrThrow({ where: { id: card.id } })).triage_kind).toBe('project_setup');
      expect((await json(await patchTriage(call({ project_id: LIVE }, 'PATCH'), idParams(card.id)))).body.code).toBe('dox_triage_closed');
      expect((await json(await patchTriage(call({ kind: 'task', target_launch_date: '2027-01-19' }, 'PATCH'), idParams(card.id)))).body.code).toBe('dox_triage_closed');
      expect((await patchTask(call({ status: 'not_started' }, 'PATCH'), idParams(card.id))).status).toBe(403);
      // a card Mike filed is not Dox's to sort
      const mikes = await fx.mkTask('Mike card', { status: 'triage', created_by_id: MIKE_USER_ID, tags: ['from-dox'] });
      expect((await json(await patchTriage(call({ kind: 'task' }, 'PATCH'), idParams(mikes)))).body.code).toBe('dox_triage_closed');
    });

    it('refuses an owner, blockers or plan links on a Triage card, and a closed project', async () => {
      as(dox());
      const other = await fx.mkTask('blocker', { project_id: LIVE, status: 'not_started' });
      for (const body of [
        { title: `${fx.tag} t1`, status: 'triage', assignee_id: BOT_ID },
        { title: `${fx.tag} t2`, status: 'triage', blocked_by_ids: [other] },
        { title: `${fx.tag} t3`, status: 'triage', site_id: siteId, client_id: fx.clientId },
        { title: `${fx.tag} t5`, status: 'triage', project_id: LIVE, sop_id: '00000000-0000-4000-8000-000000000003' },
      ]) {
        const r = await json(await createTask(call(body)));
        expect([r.status, r.body.code], JSON.stringify(body)).toEqual([403, 'dox_triage_closed']);
      }
      expect((await json(await createTask(call({ title: `${fx.tag} t4`, status: 'triage', project_id: QUOTE })))).body.code).toBe('dox_project_closed');
      expect(await prisma.task.count({ where: { title: { startsWith: `${fx.tag} t` } } })).toBe(0);
    });
  });

  describe('questions: answer with a source, change, withdraw', () => {
    it('records a client\'s answer on a live project\'s task, cites nobody as Mike, and never overwrites an answer', async () => {
      const t = await fx.mkTask('Copy task', { project_id: LIVE, status: 'not_started' });
      as(mikeSession());
      const q = await json(await addQ(call({ ...CONTEXT, question: 'Is the current site copy the source?' }), idParams(t)));
      expect(q.status, JSON.stringify(q.body)).toBe(201);
      as(dox());
      const ans = await json(await answerQ(call({ version: q.body.version, text: 'Yes, the current site copy is the source.', source: SOURCE }), qParams(t, q.body.id)));
      expect(ans.status, JSON.stringify(ans.body)).toBe(200);
      expect(ans.body.question.state).toBe('answered');
      expect(ans.body.question.citation).toBeNull();
      const row = await prisma.taskQuestion.findUniqueOrThrow({ where: { id: q.body.id } });
      expect(row.answered_by_id).toBe(BOT_ID);
      expect(row.answer_text).toBe('Yes, the current site copy is the source.');
      const again = await json(await answerQ(call({ version: ans.body.question.version, text: 'No.', source: SOURCE }), qParams(t, q.body.id)));
      expect([again.status, again.body.code]).toEqual([409, 'already_answered']);
      // Mike's own answer is never overwritten by Dox either
      const m = await fx.mkTask('Mike answered', { project_id: LIVE, status: 'not_started' });
      as(mikeSession());
      const mq = await json(await addQ(call({ ...CONTEXT, question: 'Who signs off?' }), idParams(m)));
      const mine = await json(await answerQ(call({ version: mq.body.version, text: 'Kue does.' }), qParams(m, mq.body.id)));
      as(dox());
      expect((await json(await answerQ(call({ version: mine.body.question.version, text: 'Ashlei does.', source: SOURCE }), qParams(m, mq.body.id)))).body.code).toBe('already_answered');
      expect((await prisma.taskQuestion.findUniqueOrThrow({ where: { id: mq.body.id } })).answer_text).toBe('Kue does.');
    });

    it('leaves a task held for Mike alone: no answer, no withdrawal, the hold stays', async () => {
      const tags = ['held-for-questions', 'held-for-questions:needs-mike', 'needs-mike'];
      const t = await fx.mkTask('Held for Mike', { project_id: LIVE, status: 'blocked', tags });
      as(mikeSession());
      const q = await json(await addQ(call({ ...CONTEXT, question: 'Are the booth pages added work?' }), idParams(t)));
      as(dox());
      expect((await json(await answerQ(call({ version: q.body.version, text: 'Covered.', source: SOURCE }), qParams(t, q.body.id)))).body.code).toBe('dox_mike_hold');
      expect((await json(await patchQ(call({ withdraw: true, reason: 'Kue said so.' }, 'PATCH'), qParams(t, q.body.id)))).body.code).toBe('dox_mike_hold');
      expect((await prisma.taskQuestion.findUniqueOrThrow({ where: { id: q.body.id } })).state).toBe('open');
      expect((await prisma.task.findUniqueOrThrow({ where: { id: t } })).tags).toEqual(tags);
    });

    it('lifts a hold with no needs-mike when the last open question is answered, and answers a standalone task\'s question', async () => {
      const t = await fx.mkTask('Held', { client_id: fx.clientId, status: 'not_started', tags: ['held-for-questions', 'keep'] });
      as(dox());
      const q = await json(await addQ(call({ ...CONTEXT, question: 'Which photo goes on the hero?' }), idParams(t)));
      expect(q.status).toBe(201);
      const ans = await json(await answerQ(call({ version: q.body.version, text: 'The booth photo.', source: { ...SOURCE, said: 'Use the booth photo.' } }), qParams(t, q.body.id)));
      expect(ans.status, JSON.stringify(ans.body)).toBe(200);
      expect(ans.body.hold_released).toBe(true);
      expect((await prisma.task.findUniqueOrThrow({ where: { id: t } })).tags).toEqual(['keep']);
    });

    it('refuses an answer on a Triage card, on a closed project, with no source and as Mike', async () => {
      const card = await fx.mkTask('Triage q', { status: 'triage' });
      const closed = await fx.mkTask('Closed q', { project_id: QUOTE, status: 'not_started' });
      const live = await fx.mkTask('Live q', { project_id: LIVE, status: 'not_started' });
      as(mikeSession());
      const onCard = await json(await addQ(call({ ...CONTEXT, question: 'Release this card?' }), idParams(card)));
      const onClosed = await json(await addQ(call({ ...CONTEXT, question: 'Is the quote right?' }), idParams(closed)));
      const onLive = await json(await addQ(call({ ...CONTEXT, question: 'Who signs off the copy?' }), idParams(live)));
      as(dox());
      expect((await json(await answerQ(call({ version: onCard.body.version, text: 'Yes', source: SOURCE }), qParams(card, onCard.body.id)))).body.code).toBe('dox_triage_closed');
      expect((await json(await answerQ(call({ version: onClosed.body.version, text: 'Yes', source: SOURCE }), qParams(closed, onClosed.body.id)))).body.code).toBe('dox_project_closed');
      expect((await json(await answerQ(call({ version: onLive.body.version, text: 'Kue' }), qParams(live, onLive.body.id)))).body.code).toBe('answer_source_required');
      expect((await json(await answerQ(call({ version: onLive.body.version, text: 'Kue', source: { ...SOURCE, who: 'Mike Dion' } }), qParams(live, onLive.body.id)))).body.code).toBe('answer_source_mike');
      for (const who of ['Michael', 'M. Dion', 'Reshi, by phone']) {
        expect((await json(await answerQ(call({ version: onLive.body.version, text: 'Kue', source: { ...SOURCE, who } }), qParams(live, onLive.body.id)))).body.code, who).toBe('answer_source_mike');
      }
      // an internal standalone card (no project, no client) is Mike's
      const internal = await fx.mkTask('Internal q', { status: 'not_started' });
      as(mikeSession());
      const onInternal = await json(await addQ(call({ ...CONTEXT, question: 'Which tool do we build?' }), idParams(internal)));
      as(dox());
      expect((await json(await answerQ(call({ version: onInternal.body.version, text: 'X', source: SOURCE }), qParams(internal, onInternal.body.id)))).body.code).toBe('dox_outside_project');
      expect((await json(await patchQ(call({ withdraw: true }, 'PATCH'), qParams(internal, onInternal.body.id)))).body.code).toBe('dox_outside_project');
      for (const id of [onCard.body.id, onClosed.body.id, onLive.body.id]) expect((await prisma.taskQuestion.findUniqueOrThrow({ where: { id } })).state).toBe('open');
      // Mike's own answer is still his, with his citation
      as(mikeSession());
      const mine = await json(await answerQ(call({ version: onLive.body.version, text: 'Kue signs it off.' }), qParams(live, onLive.body.id)));
      expect(mine.body.question.citation).toMatch(/^Mike, /);
    });

    it('withdraws a question on a live project\'s task; on a Triage card only his own', async () => {
      const live = await fx.mkTask('Withdraw live', { project_id: LIVE, status: 'not_started' });
      const card = await fx.mkTask('Withdraw card', { status: 'triage' });
      as(mikeSession());
      const a = await json(await addQ(call({ ...CONTEXT, question: 'Still needed?' }), idParams(live)));
      const b = await json(await addQ(call({ ...CONTEXT, question: 'Mike asked this on the card?' }), idParams(card)));
      as(dox());
      const c = await json(await addQ(call({ ...CONTEXT, question: 'Dox asked this on the card?' }), idParams(card)));
      expect((await json(await patchQ(call({ if_nobody: 'Dox decides.' }, 'PATCH'), qParams(live, a.body.id)))).body.code).toBe('dox_question_closed');
      expect((await json(await patchQ(call({ withdraw: true, reason: 'Kue answered it by email.' }, 'PATCH'), qParams(live, a.body.id)))).status).toBe(200);
      expect((await json(await patchQ(call({ withdraw: true }, 'PATCH'), qParams(card, b.body.id)))).body.code).toBe('dox_triage_closed');
      expect((await json(await patchQ(call({ withdraw: true }, 'PATCH'), qParams(card, c.body.id)))).status).toBe(200);
    });
  });

  describe('meetings', () => {
    it('links a meeting to a project it covered; refuses a missing project and extra fields', async () => {
      as(dox());
      const ok = await linkMeeting(call({ project_id: LIVE }), idParams(meetingId));
      expect(ok.status).toBe(201);
      expect(await prisma.meetingProject.count({ where: { meeting_id: meetingId, project_id: LIVE } })).toBe(1);
      expect((await linkMeeting(call({ project_id: '00000000-0000-4000-8000-000000000002' }), idParams(meetingId))).status).toBe(404);
      expect((await json(await linkMeeting(call({ project_id: QUOTE, note: 'x' }), idParams(meetingId)))).body.code).toBe('dox_field_closed');
      const read = await json(await getMeeting(get(), idParams(meetingId)));
      expect(read.status).toBe(200);
    });
  });

  describe('reads carry no credential', () => {
    it('a site, the site list, the client, its contacts and the contact lookup come back without the staging password for Dox, and with it for Mike', async () => {
      as(dox());
      const answers = [
        await json(await getSite(get(), idParams(siteId))),
        await json(await listSites(get(`http://localhost/api/sites?client_id=${fx.clientId}&limit=100`))),
        await json(await getClient(get(), idParams(fx.clientId))),
        await json(await listContacts(get(), idParams(fx.clientId))),
        await json(await resolveContact(get(`http://localhost/api/contacts/resolve?email=${encodeURIComponent(contactEmail)}`))),
      ];
      for (const a of answers) {
        expect(a.status, JSON.stringify(a.body).slice(0, 200)).toBe(200);
        const text = JSON.stringify(a.body);
        expect(text).not.toContain(SECRET);
        expect(text).not.toContain('staging_auth_password');
        expect(text).not.toMatch(/"(hourly_rate|retainer_hours|rate|hosting_discount)"/);
      }
      expect(answers[0].body.name).toBe(`${fx.tag} site`);
      as(mikeSession());
      expect((await json(await getSite(get(), idParams(siteId)))).body.staging_auth_password).toBe(SECRET);
    });

    it('redactForDox strips secrets at any depth and leaves Dates and every other caller alone', () => {
      const when = new Date('2026-11-19T12:00:00Z');
      const value = { a: 1, staging_auth_password: 's', hourly_rate: 150, nested: [{ portal_token: 't', keep: 'k', at: when, hosting_plan: { name: 'Pro', rate: 40 } }] };
      const out = redactForDox({ lane: 'dox' }, value);
      expect(out).toEqual({ a: 1, nested: [{ keep: 'k', at: when, hosting_plan: { name: 'Pro' } }] });
      expect(out.nested[0].at).toBeInstanceOf(Date);
      expect(redactForDox({ lane: 'bast' }, value)).toBe(value);
    });
  });
});

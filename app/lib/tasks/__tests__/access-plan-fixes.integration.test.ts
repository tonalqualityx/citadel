// @vitest-environment node
/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * The two reviews' reproduced attacks, as regression tests against a scratch Postgres (feat/triage-plan-access): A1 (a card that changed after he
 * read it, and a lane's comment that imitates a change line), A2 (a desk link to another card's project), A4 (deal prices), A5 (notifications from
 * desk comments), A6 (client-visible tags and project fields), A7 (the one-hour default), A8 (candidate deals), A9 (a non-UUID id), P1 (the billing
 * note), P2 (the Dox sentence), P7, P8 (the lane and the one-line check) and P10 (who reads which section, per role).
 */
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { NextRequest } from 'next/server';
import type { Mock } from 'vitest';

vi.mock('@/lib/auth/middleware', async (orig) => ({ ...(await orig<typeof import('@/lib/auth/middleware')>()), requireAuth: vi.fn() }));
vi.mock('@/lib/auth/actor-lane', () => ({ actorLaneField: vi.fn(async () => ({})), currentActorLane: vi.fn(async () => null) }));

import { prisma } from '@/lib/db/prisma';
import { requireAuth, type AuthPayload } from '@/lib/auth/middleware';
import { SCRATCH } from '@/lib/engine/__tests__/seed';
import { MIKE_USER_ID } from '@/lib/oracle/projects/gate-constants';
import { runHomeAct } from '@/lib/home/act';
import { loadCards } from '@/lib/tasks/triage-card';
import { GET as getPlan } from '@/app/api/tasks/[id]/plan/route';
import { PUT as putSection } from '@/app/api/tasks/[id]/plan/[section]/route';
import { GET as getTriage, PATCH as patchTriage } from '@/app/api/tasks/[id]/triage/route';
import { PUT as putShape } from '@/app/api/tasks/[id]/triage/shape/route';
import { PATCH as patchTask } from '@/app/api/tasks/[id]/route';
import { POST as addComment } from '@/app/api/tasks/[id]/comments/route';
import { POST as addQ } from '@/app/api/tasks/[id]/questions/route';
import { PATCH as patchQ } from '@/app/api/tasks/[id]/questions/[qid]/route';
import { GET as getConversation } from '@/app/api/tasks/[id]/conversation/route';
import { GET as getProjectPlan } from '@/app/api/projects/[id]/plan/route';
import { PATCH as patchProject } from '@/app/api/projects/[id]/route';
import { POST as createProject } from '@/app/api/projects/route';
import { readDeals } from '@/lib/deals/read';
import { estimatePatchForKind } from '@/lib/tasks/triage-estimate';
import { isChangeLineImitation } from '@/lib/tasks/triage-rev';
import { scrubSecrets } from '@/lib/triage-desk/scrub';
import { planReaderOf, viewOf, contractorSourceLabel } from '@/lib/tasks/plan-policy';
import { PLAN_SECTIONS } from '@/lib/tasks/plan-schema';
import { idParams, makeFixture, BOT_ID, mikeSession, dox, chatLane, type Fx } from '@/lib/dox/__tests__/fixture';

const authMock = requireAuth as Mock;
const as = (a: AuthPayload) => authMock.mockResolvedValue(a);
const desk = (): AuthPayload => ({ userId: BOT_ID, role: 'pm', email: 'bast@becomeindelible.com', via: 'api_key', apiKeyId: 'kt', lane: 'triage-desk', laneEnforced: true });
const call = (body?: unknown, method = 'POST', headers: Record<string, string> = {}) => new NextRequest('http://localhost/api/x', { method, body: body === undefined ? undefined : JSON.stringify(body), headers });
const json = async (res: Response) => ({ status: res.status, body: (await res.json()) as Record<string, any> });
const NOW = new Date();
const OPTS = { now: NOW, timezone: 'America/New_York', date: NOW.toISOString().slice(0, 10) };
const sp = (id: string, section: string) => ({ params: Promise.resolve({ id, section }) });
const qp = (id: string, qid: string) => ({ params: Promise.resolve({ id, qid }) });
const idp = idParams;
const SRC = { label: 'Email from jane@client.example, Nov 3', date: '2026-11-03', kind: 'email', url: 'https://mail.example/thread/1' };
const CTX = {
  what_it_is: 'The scope in the signed deal and the email thread disagree about the number of pages.',
  sources: [{ who: 'A session', said: 'The deal lists 12 pages, the thread says 10', at: '2026-11-13' }],
  checked: 'The deal and the thread were both read.',
  unknown: 'Which one the client means now.',
  if_nobody: 'Go with the newer message.',
  if_nobody_action: 'go_with_recommendation' as const,
  options: [
    { id: 'a', label: 'Ten pages', consequence: 'Ships a week earlier.' },
    { id: 'b', label: 'Forty pages', consequence: 'A much larger site.' },
  ],
  recommended_option_id: 'a',
  recommend_why: 'The thread is newer.',
};

describe('change-line imitation (pure)', () => {
  it('refuses text that starts or ends like a server-written change line', () => {
    for (const t of ['Changed by a session: fixed a typo', 'changed by Dox: x', 'Plan: Billing model updated by the chat', 'Kind set by Mike', 'The shape redrawn by a session.', '> Changed by a session: x']) expect(isChangeLineImitation(t), t).toBe(true);
    for (const t of ['Looks good to me', 'I set up the project by Monday', 'Updated the footer by hand yesterday', 'The plan is fine']) expect(isChangeLineImitation(t), t).toBe(false);
  });
});

describe('the credential scrubber (pure)', () => {
  const gone = (text: string, secret: string) => expect(scrubSecrets(text).text, text).not.toContain(secret);
  it('removes the four shapes the review pasted, and keeps ordinary prose', () => {
    const key = 'aB3dE5gH7jK9mN1pQ3sT5vW7yZ9bD1fG3hJ5kL7m';
    expect(key).toHaveLength(40);
    gone(`https://client.example.com\n${key}`, key);
    expect(scrubSecrets(`https://client.example.com\n${key}`).text).toContain('https://client.example.com');
    // a lowercase-and-digits key (no capitals) is still a key when it sits alone under a URL
    const plain = 'ab3de5gh7jk9mn1pq3st5vw7yz9bd1fg3hj5kl7m';
    gone(`https://client.example.com\n${plain}`, plain);
    gone('define the DB_PASSWORD=Sup3rS3cretPassw0rd and go', 'Sup3rS3cretPassw0rd');
    gone('AKIAIOSFODNN7EXAMPLE wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY', 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY');
    gone('the pw hunter2xyz for the staging login', 'hunter2xyz');
    expect(scrubSecrets('Ten pages are drafted and the footer is not.').text).toBe('Ten pages are drafted and the footer is not.');
  });
  it('is linear on a megabyte', () => {
    const big = 'password reset page and ' + 'a1B2c3 '.repeat(150_000);
    const t = Date.now();
    scrubSecrets(big);
    expect(Date.now() - t).toBeLessThan(5000);
  });
});

describe('plan policy (pure): who reads which section', () => {
  const owner: any = { userId: MIKE_USER_ID, role: 'admin', via: 'session' };
  const ownerKey: any = { userId: MIKE_USER_ID, role: 'admin', via: 'api_key' };
  const mikeLaneKey: any = { userId: MIKE_USER_ID, role: 'admin', via: 'api_key', lane: 'troubador', laneEnforced: true };
  const pm: any = { userId: 'p', role: 'pm', via: 'session' };
  const tech: any = { userId: 't', role: 'tech', via: 'session' };
  const designer: any = { userId: 'd', role: 'designer', via: 'session' };
  const chatAuth: any = { userId: 'b', role: 'pm', via: 'api_key', lane: 'bast-chat', laneEnforced: true };
  const doxAuth: any = { userId: 'b', role: 'pm', via: 'api_key', lane: 'dox', laneEnforced: true };
  it('while in Triage: the owner, the chat and Dox only; a lane key under the owner is not the owner (P8)', () => {
    const t = { status: 'triage' };
    expect(planReaderOf(t, owner)).toBe('owner');
    expect(planReaderOf(t, ownerKey)).toBe('owner');
    expect(planReaderOf(t, chatAuth)).toBe('owner');
    expect(planReaderOf(t, doxAuth)).toBe('owner');
    expect(planReaderOf(t, mikeLaneKey)).toBeNull();
    for (const a of [pm, tech, designer]) expect(planReaderOf(t, a)).toBeNull();
  });
  it('after release: owner and staff everything, a contractor the listed sections only, a designer nothing', () => {
    const t = { status: 'not_started' };
    expect(planReaderOf(t, pm)).toBe('staff');
    expect(planReaderOf(t, tech)).toBe('contractor');
    expect(planReaderOf(t, designer)).toBeNull();
    const visible = (r: 'owner' | 'staff' | 'contractor') => PLAN_SECTIONS.filter((s) => viewOf(r, s) !== 'none');
    expect(visible('owner')).toEqual([...PLAN_SECTIONS]);
    expect(visible('staff')).toEqual([...PLAN_SECTIONS]);
    expect(visible('contractor')).toEqual(['requirements', 'dates', 'team', 'planned_tasks', 'risks', 'examples']);
    expect(viewOf('contractor', 'team')).toBe('staff_only');
    expect(viewOf('contractor', 'billing')).toBe('none');
    expect(viewOf('contractor', 'decisions')).toBe('none');
  });
  it('a source becomes a short label with no names, addresses or links', () => {
    expect(contractorSourceLabel({ label: 'Email from jane@client.example', date: '2026-11-03', kind: 'email', url: 'https://x' })).toEqual({ label: 'Client email, Nov 3' });
    expect(contractorSourceLabel({ label: 'Signed SOW, section 3', kind: 'document' })).toEqual({ label: 'Signed SOW' });
    expect(contractorSourceLabel({ label: 'Jane Smith said', kind: 'other' })).toEqual({ label: 'Source on file' });
  });
});

describe('the one-hour default never overwrites an input he set (A7)', () => {
  const unset = { estimated_minutes: null, energy_estimate: null, mystery_factor: 'none', battery_impact: 'average_drain', tags: [] as string[] };
  it('defaults an untouched card, but not one with only battery or only mystery set', () => {
    expect(estimatePatchForKind('task', 'project_setup', unset)).toMatchObject({ energy_estimate: 3, estimated_minutes: 60 });
    expect(estimatePatchForKind('task', 'project_setup', { ...unset, battery_impact: 'high_drain' })).toBeNull();
    expect(estimatePatchForKind('task', 'project_setup', { ...unset, mystery_factor: 'significant_mystery' })).toBeNull();
  });
});

describe.skipIf(!SCRATCH)('access and plan fixes (real database)', () => {
  let fx: Fx;
  let otherClientId: string;
  let techId: string;
  let pmId: string;
  const ids: { projects: string[]; deals: string[] } = { projects: [], deals: [] };

  beforeAll(async () => {
    fx = await makeFixture('apf');
    otherClientId = (await prisma.client.create({ data: { name: `${fx.tag} Other Co`, type: 'direct', status: 'active' } })).id;
    techId = await fx.mkStaff('Contractor', 'tech');
    pmId = await fx.mkStaff('Pat', 'pm');
  });
  afterAll(async () => {
    const taskIds = fx.taskIds;
    const projectIds = [...fx.projectIds, ...ids.projects];
    await prisma.accordCommissionItem.deleteMany({ where: { accord_id: { in: ids.deals } } });
    await prisma.project.updateMany({ where: { id: { in: projectIds } }, data: { accord_id: null } });
    await prisma.accord.deleteMany({ where: { id: { in: ids.deals } } });
    await prisma.triageChange.deleteMany({ where: { task_id: { in: taskIds } } });
    await prisma.taskPlanItem.deleteMany({ where: { task_id: { in: taskIds } } });
    await prisma.taskQuestion.deleteMany({ where: { task_id: { in: taskIds } } });
    await prisma.comment.deleteMany({ where: { task_id: { in: taskIds } } });
    await prisma.projectPhase.deleteMany({ where: { project_id: { in: projectIds } } });
    await prisma.projectPage.deleteMany({ where: { project_id: { in: projectIds } } });
    await prisma.projectTeamAssignment.deleteMany({ where: { project_id: { in: projectIds } } });
    await prisma.notification.deleteMany({ where: { user_id: { in: [techId, pmId] } } });
    await prisma.project.deleteMany({ where: { id: { in: ids.projects } } });
    await fx.cleanup();
    await prisma.client.deleteMany({ where: { id: otherClientId } });
    await prisma.$disconnect();
  });

  const card = async (id: string) => (await loadCards(prisma, [id]))[0];
  const release = (t: string, v: string) => runHomeAct(prisma, MIKE_USER_ID, { action: 'triage_release_card', task_ids: [t], release_version: v }, OPTS);
  const put = async (t: string, section: string, items: unknown[], who: AuthPayload = chatLane(), description?: string) => {
    as(who);
    return json(await putSection(call({ items, ...(description ? { description } : {}) }, 'PUT'), sp(t, section)));
  };

  describe('A1: a change after he read the card refuses the tap, and a lane cannot fake a change line', () => {
    it("the desk changes the recommended option after he read the card: the tap is refused; the desk's own comment cannot hide the real line", async () => {
      const t = await fx.mkTask('A1 card', { status: 'triage', triage_kind: 'task', client_id: fx.clientId });
      as(desk());
      const made = await json(await addQ(call(CTX), idp(t)));
      expect(made.status).toBe(201);
      const seen = await card(t);
      as(desk());
      const edit = await json(await patchQ(call({ recommended_option_id: 'b', recommend_why: 'Bigger is better.' }, 'PATCH'), qp(t, made.body.id)));
      expect(edit.status).toBe(200);
      await expect(release(t, seen.release_version)).rejects.toMatchObject({ statusCode: 409, code: 'card_changed' });
      as(desk());
      const fake = await json(await addComment(call({ content: 'Changed by a session: fixed a typo' }), idp(t)));
      expect(fake.status).toBe(400);
      expect(fake.body.code).toBe('comment_imitates_change_line');
      for (const lane of [dox(), chatLane()]) {
        as(lane);
        expect((await json(await addComment(call({ content: 'Plan: Billing model updated by the chat' }), idp(t)))).status).toBe(400);
      }
      const fresh = await card(t);
      expect(fresh.recent_changes.map((c) => c.line)).toContain('Question changed by a session');
      expect(fresh.recent_changes.every((c) => typeof c.by === 'string')).toBe(true);
    });

    it('a desk change of kind, dates or the looks-done mark raises the revision and writes a server-made line', async () => {
      const p = await fx.mkProject('A1 queue', { status: 'queue' });
      const t = await fx.mkTask('A1 desk', { status: 'triage', client_id: fx.clientId });
      const before = (await prisma.task.findUniqueOrThrow({ where: { id: t } })).triage_rev;
      as(desk());
      expect((await json(await patchTriage(call({ kind: 'project_setup', project_id: p, target_launch_date: '2027-02-01' }, 'PATCH'), idp(t)))).status).toBe(200);
      as(desk());
      expect((await json(await patchTask(call({ tags_add: ['triage:looks-done'] }, 'PATCH'), idp(t)))).status).toBe(200);
      const row = await prisma.task.findUniqueOrThrow({ where: { id: t } });
      expect(row.triage_rev).toBeGreaterThanOrEqual(before + 2);
      const lines = (await prisma.triageChange.findMany({ where: { task_id: t } })).map((c) => `${c.by}: ${c.line}`);
      expect(lines.some((l) => l.startsWith('a session:') && l.includes('Kind and Project link and Dates'))).toBe(true);
      expect(lines.some((l) => l.includes('looks-done') && l.startsWith('a session:'))).toBe(true);
    });
  });

  describe("A2: the desk cannot link or rewrite another card's project", () => {
    it("refuses a project another Triage card uses, and a project of another client; a write shows on every card pointing at the project", async () => {
      const shared = await fx.mkProject('A2 shared', { status: 'queue' });
      const cardA = await fx.mkTask('A2 owner of the project', { status: 'triage', triage_kind: 'project_setup', project_id: shared, client_id: fx.clientId });
      const cardB = await fx.mkTask('A2 attacker', { status: 'triage', client_id: fx.clientId });
      as(desk());
      const link = await json(await patchTriage(call({ kind: 'project_setup', project_id: shared }, 'PATCH'), idp(cardB)));
      expect(link.status).toBe(409);
      expect(link.body.code).toBe('project_in_use');
      const otherClientProject = (await prisma.project.create({ data: { name: `${fx.tag} A2 other client`, client_id: otherClientId, status: 'queue' } })).id;
      ids.projects.push(otherClientProject);
      as(desk());
      const cross = await json(await patchTriage(call({ project_id: otherClientProject }, 'PATCH'), idp(cardB)));
      expect(cross.status).toBe(409);
      expect(cross.body.code).toBe('project_other_client');
      expect((await prisma.task.findUniqueOrThrow({ where: { id: cardB } })).project_id).toBeNull();
      const cardC = await fx.mkTask('A2 legacy second card', { status: 'triage', triage_kind: 'project_setup', project_id: shared, client_id: fx.clientId });
      const revC = (await prisma.task.findUniqueOrThrow({ where: { id: cardC } })).triage_rev;
      as(desk());
      expect((await json(await putShape(call({ phases: [{ name: 'Design' }] }, 'PUT'), idp(cardA)))).status).toBe(200);
      expect((await prisma.task.findUniqueOrThrow({ where: { id: cardC } })).triage_rev).toBeGreaterThan(revC);
      expect((await prisma.triageChange.findMany({ where: { task_id: cardC } })).some((c) => c.line.includes('shape'))).toBe(true);
    });
    it('the chat lane is held to the same link rule', async () => {
      const shared = await fx.mkProject('A2 chat shared', { status: 'queue' });
      await fx.mkTask('A2 chat first', { status: 'triage', triage_kind: 'project_setup', project_id: shared, client_id: fx.clientId });
      const second = await fx.mkTask('A2 chat second', { status: 'triage', client_id: fx.clientId });
      as(chatLane());
      expect((await json(await patchTriage(call({ project_id: shared }, 'PATCH'), idp(second)))).status).toBe(409);
    });
  });

  describe('A9: the conversation route', () => {
    it('answers 400 to an id that is not a UUID', async () => {
      as(desk());
      expect((await json(await getConversation(call(undefined, 'GET'), idp('not-a-uuid')))).status).toBe(400);
    });
  });

  describe('A4: deal prices go only to the owner, the chat lane and Dox inside its binding', () => {
    it('strips deal_detail for the desk on GET, PATCH and PUT replies; the owner and the chat keep it', async () => {
      const deal = await prisma.accord.create({ data: { name: `${fx.tag} Deal`, client_id: fx.clientId, status: 'signed' } as never });
      ids.deals.push(deal.id);
      const p = await fx.mkProject('A4 project', { status: 'queue', accord_id: deal.id });
      const t = await fx.mkTask('A4 card', { status: 'triage', triage_kind: 'project_setup', project_id: p, client_id: fx.clientId });
      as(desk());
      expect((await json(await getTriage(call(undefined, 'GET'), idp(t)))).body.project.deal_detail).toBeNull();
      as(desk());
      expect((await json(await patchTriage(call({ target_launch_date: '2027-03-01' }, 'PATCH'), idp(t)))).body.project.deal_detail).toBeNull();
      as(desk());
      expect((await json(await putShape(call({ pages: [{ name: 'Home' }] }, 'PUT'), idp(t)))).body.project.deal_detail).toBeNull();
      as(mikeSession());
      expect((await json(await getTriage(call(undefined, 'GET'), idp(t)))).body.project.deal_detail).not.toBeNull();
      as(chatLane());
      expect((await json(await getTriage(call(undefined, 'GET'), idp(t)))).body.project.deal_detail).not.toBeNull();
    });
  });

  describe('A5: no notifications from desk (or Dox on a Triage card) comments', () => {
    it('drops mentions and skips the assignee notice', async () => {
      const t = await fx.mkTask('A5 card', { status: 'triage', assignee_id: pmId, client_id: fx.clientId });
      const n0 = await prisma.notification.count({ where: { user_id: { in: [pmId, techId] } } });
      as(desk());
      expect((await json(await addComment(call({ content: 'FYI for the team', mentioned_user_ids: [techId] }), idp(t)))).status).toBe(201);
      as(dox());
      expect((await json(await addComment(call({ content: 'Dox note', mentioned_user_ids: [techId] }), idp(t)))).status).toBe(201);
      expect(await prisma.notification.count({ where: { user_id: { in: [pmId, techId] } } })).toBe(n0);
    });
  });

  describe('A6: what a client reads', () => {
    it('quote and emergency are portal-rendered tags', async () => {
      const { PORTAL_RENDERED_TAGS } = await import('@/lib/portal/client-rendered');
      expect(PORTAL_RENDERED_TAGS).toEqual(expect.arrayContaining(['quote', 'emergency']));
    });
    it('the chat lane may not set the dates of a project the portal shows through a card; the desk and Dox are refused too', async () => {
      const live = await fx.mkProject('A6 live', { status: 'in_progress' });
      const t = await fx.mkTask('A6 card', { status: 'triage', triage_kind: 'project_setup', project_id: live, client_id: fx.clientId });
      as(chatLane());
      const c = await json(await patchTriage(call({ target_launch_date: '2027-05-05' }, 'PATCH'), idp(t)));
      expect(c.status).toBe(403);
      expect(c.body.code).toBe('chat_client_visible_project');
      as(desk());
      expect((await json(await patchTriage(call({ target_launch_date: '2027-05-05' }, 'PATCH'), idp(t)))).body.code).toBe('desk_client_closed');
      await fx.openPass(live);
      as(dox());
      const d = await json(await patchProject(call({ target_date: '2027-05-05' }, 'PATCH', { 'x-dox-project': live }), idp(live)));
      expect(d.status).toBe(403);
      expect(d.body.code).toBe('dox_client_closed');
      expect((await prisma.project.findUniqueOrThrow({ where: { id: live } })).target_date).toBeNull();
      const queued = await fx.mkProject('A6 queued', { status: 'queue' });
      const t2 = await fx.mkTask('A6 queued card', { status: 'triage', triage_kind: 'project_setup', project_id: queued, client_id: fx.clientId });
      as(chatLane());
      expect((await json(await patchTriage(call({ target_launch_date: '2027-05-05' }, 'PATCH'), idp(t2)))).status).toBe(200);
    });
    it('a project Dox creates from a released card starts hidden from the portal', async () => {
      const released = await fx.mkTask('A6 released', { status: 'not_started', tags: ['from-triage'], client_id: fx.clientId });
      as(dox());
      const res = await json(await createProject(call({ name: `${fx.tag} Dox made`, client_id: fx.clientId, status: 'ready', type: 'project' }, 'POST', { 'x-dox-card': released })));
      expect(res.status).toBe(201);
      ids.projects.push(res.body.id);
      expect((await prisma.project.findUniqueOrThrow({ where: { id: res.body.id } })).portal_visibility).toBe('hidden');
    });
  });

  describe('A8: a project with no deal tie lists only deals not tied to another project', () => {
    it('leaves out a deal already tied to another project', async () => {
      const taken = await prisma.accord.create({ data: { name: `${fx.tag} taken`, client_id: fx.clientId, status: 'signed' } as never });
      const free = await prisma.accord.create({ data: { name: `${fx.tag} free`, client_id: fx.clientId, status: 'signed' } as never });
      ids.deals.push(taken.id, free.id);
      await fx.mkProject('A8 owner of the taken deal', { accord_id: taken.id });
      const loose = await fx.mkProject('A8 loose');
      const read = await readDeals(prisma, { projectId: loose });
      const names = (read?.deals ?? []).map((d: { name: string }) => d.name);
      expect(names).toContain(`${fx.tag} free`);
      expect(names).not.toContain(`${fx.tag} taken`);
    });
  });

  describe('P1 and P10: the plan, per role and section', () => {
    it('a contractor reads the allowed sections with short source labels only, never billing (items or note), decisions, wrong marks, was/changed_by, answered questions or the deal', async () => {
      const proj = await fx.mkProject('P1 project', { status: 'ready' });
      const t = await fx.mkTask('P1 released', { status: 'triage', triage_kind: 'project_setup', project_id: proj, client_id: fx.clientId });
      await prisma.projectTeamAssignment.create({ data: { project_id: proj, user_id: techId } as never });
      expect((await put(t, 'billing', [{ type: 'basis', kind: 'hourly', source: SRC }], chatLane(), 'Billing: $150/hr capped at $18,000')).status).toBe(200);
      expect((await put(t, 'requirements', [{ text: 'Ten pages', source: SRC, mark: 'changed', was: 'Twelve pages', changed_by: 'Jane by email' }, { text: 'Wrong one', source: SRC }])).status).toBe(200);
      expect((await put(t, 'decisions', [{ text: 'Use the old logo', source: SRC }])).status).toBe(200);
      expect((await put(t, 'team', [{ person: { name: 'Jane Client', org: 'Client Co' }, role: 'Client contact' }, { person: { user_id: pmId }, role: 'Project manager' }])).status).toBe(200);
      expect((await put(t, 'planned_tasks', [{ title: 'Order the font licence early', note: 'Six week lead time', for: { name: 'Jane Client', org: 'Client Co' }, when: '2026-12-04', source: SRC }])).status).toBe(200);
      const wrong = (await prisma.taskPlanItem.findMany({ where: { task_id: t, section: 'requirements' } })).find((r) => (r.data as { text: string }).text === 'Wrong one')!;
      await prisma.taskPlanItem.update({ where: { id: wrong.id }, data: { wrong_at: new Date(), wrong_by: 'Mike' } });
      await prisma.taskQuestion.create({ data: { task_id: t, question: 'Which logo?', what_it_is: 'x', sources: [], checked: 'x', unknown: 'x', if_nobody: 'x', if_nobody_action: 'wait', state: 'answered', answer_text: 'The old one', answered_at: new Date() } as never });
      await prisma.task.update({ where: { id: t }, data: { status: 'not_started' } });
      as({ userId: techId, role: 'tech', email: 't@test', via: 'session' });
      const res = await json(await getPlan(call(undefined, 'GET'), idp(t)));
      expect(res.status).toBe(200);
      const body = res.body;
      const sec = (n: string) => body.sections.find((s: { section: string }) => s.section === n);
      expect(sec('billing')).toMatchObject({ withheld: true, items: [], note: null });
      expect(JSON.stringify(body)).not.toContain('18,000');
      expect(sec('decisions')).toMatchObject({ withheld: true, items: [] });
      expect(body.answered_questions).toEqual([]);
      const reqs = sec('requirements').items;
      expect(reqs.map((i: { text: string }) => i.text)).toEqual(['Ten pages']);
      expect(reqs[0].was).toBeUndefined();
      expect(reqs[0].changed_by).toBeUndefined();
      expect(reqs[0].source).toEqual({ label: 'Client email, Nov 3' });
      expect(JSON.stringify(body)).not.toContain('jane@client.example');
      expect(JSON.stringify(body)).not.toContain('mail.example');
      expect(sec('team').items.map((i: { role: string }) => i.role)).toEqual(['Project manager']);
      expect(sec('planned_tasks').items[0].for_name).toBe('An outside party');
      expect(sec('planned_tasks').items[0].note).toBe('Six week lead time');
      expect(body.project?.deal ?? null).toBeNull();
      as({ userId: techId, role: 'tech', email: 't@test', via: 'session' });
      const link = await json(await getProjectPlan(call(undefined, 'GET'), idp(proj)));
      // requirements 2 rows + team 2 + planned 1 (billing 1 and decisions 1 are not counted)
      expect(link.body.plan_lines).toBe(5);
    });
    it('a PM and the owner read billing and its note after release; a designer reads nothing', async () => {
      const t = await fx.mkTask('P10 staff', { status: 'triage', triage_kind: 'task', client_id: fx.clientId });
      await put(t, 'billing', [{ type: 'basis', kind: 'hourly', source: SRC }], chatLane(), 'Billing: $150/hr');
      await prisma.task.update({ where: { id: t }, data: { status: 'not_started' } });
      for (const who of [{ userId: pmId, role: 'pm', email: 'p@test', via: 'session' }, mikeSession()] as AuthPayload[]) {
        as(who);
        const r = await json(await getPlan(call(undefined, 'GET'), idp(t)));
        const billing = r.body.sections.find((s: { section: string }) => s.section === 'billing');
        expect(billing.items).toHaveLength(1);
        expect(billing.note).toBe('Billing: $150/hr');
      }
      as({ userId: BOT_ID, role: 'designer', email: 'd@test', via: 'session' } as AuthPayload);
      expect((await json(await getPlan(call(undefined, 'GET'), idp(t)))).status).toBe(404);
    });
  });

  describe('P2 and Step 4b: the release sentence is true', () => {
    const noted = (title: string, extra: Record<string, unknown> = {}) => ({ title, source: SRC, ...extra });
    it('says Dox builds from the shape and the sitemap, with the noted count, only on a card held for Dox', async () => {
      const proj = await fx.mkProject('P2 project', { status: 'queue' });
      const t = await fx.mkTask('P2 project card', { status: 'triage', triage_kind: 'project_setup', project_id: proj, client_id: fx.clientId });
      await put(t, 'planned_tasks', [noted('Order the font early', { note: 'Six week lead time' }), noted('Dropped one', { mark: 'dropped' }), noted('Made already', { task_id: t })]);
      const c = await card(t);
      expect(c.release_line).toContain('Dox builds the tasks from the shape and the sitemap, including the 1 thing noted in the plan.');
      expect(c.release_line).not.toContain('planned task');
      expect(c.plan_line ?? '').not.toContain('task');
      const person = await fx.mkTask('P2 person card', { status: 'triage', triage_kind: 'task', assignee_id: pmId, client_id: fx.clientId });
      await put(person, 'planned_tasks', [noted('One'), noted('Two')]);
      expect((await card(person)).release_line).not.toContain('Dox');
      const toDox = await fx.mkTask('P2 dox card', { status: 'triage', triage_kind: 'task', client_id: fx.clientId });
      await put(toDox, 'planned_tasks', [noted('One'), noted('Two')]);
      expect((await card(toDox)).release_line).toContain('Dox sets up the 2 things noted in the plan.');
      const seen = await card(toDox);
      await put(toDox, 'planned_tasks', [noted('One'), noted('Two'), noted('Three')]);
      await expect(release(toDox, seen.release_version)).rejects.toMatchObject({ statusCode: 409, code: 'card_changed' });
    });
    it('accepts and ignores depends_on and done_when, and does not refuse more than 8 items', async () => {
      const t = await fx.mkTask('4b card', { status: 'triage', triage_kind: 'task', client_id: fx.clientId });
      const many = Array.from({ length: 10 }, (_, i) => ({ title: `Item ${i}`, source: SRC, depends_on: ['x'], done_when: 'It is done' }));
      expect((await put(t, 'planned_tasks', many)).status).toBe(200);
      const row = await prisma.taskPlanItem.findFirstOrThrow({ where: { task_id: t, section: 'planned_tasks' } });
      expect((row.data as { depends_on?: unknown }).depends_on).toBeUndefined();
      expect((row.data as { note?: string }).note).toBe('It is done');
    });
  });

  describe('P8: the plan guards', () => {
    it('refuses line and paragraph separators and control characters, and "was" on an unchanged line', async () => {
      const t = await fx.mkTask('P8 card', { status: 'triage', triage_kind: 'task', client_id: fx.clientId });
      expect((await put(t, 'requirements', [{ text: 'One two', source: SRC }])).status).toBe(400);
      expect((await put(t, 'requirements', [{ text: 'One two', source: SRC }])).status).toBe(400);
      expect((await put(t, 'requirements', [{ text: 'One\u0007two', source: SRC }])).status).toBe(400);
      expect((await put(t, 'requirements', [{ text: 'Unchanged', source: SRC, mark: 'original', was: 'Earlier wording' }])).status).toBe(400);
      expect((await put(t, 'requirements', [{ text: 'Fine', source: SRC }])).status).toBe(200);
    });
    it('a lane key minted under the owner does not read a Triage plan', async () => {
      const t = await fx.mkTask('P8 lane', { status: 'triage', triage_kind: 'task', client_id: fx.clientId });
      as({ userId: MIKE_USER_ID, role: 'admin', email: 'm@test', via: 'api_key', apiKeyId: 'kx', lane: 'troubador', laneEnforced: true });
      expect((await json(await getPlan(call(undefined, 'GET'), idp(t)))).status).toBe(404);
      as({ userId: MIKE_USER_ID, role: 'admin', email: 'm@test', via: 'api_key', apiKeyId: 'ky' });
      expect((await json(await getPlan(call(undefined, 'GET'), idp(t)))).status).toBe(200);
    });
  });
});

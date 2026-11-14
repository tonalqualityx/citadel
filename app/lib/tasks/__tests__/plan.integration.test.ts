// @vitest-environment node
/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * The Triage plan against a real scratch Postgres: who may read and write it (every role and lane), per-section validation through the
 * routes, triage_rev rising on every change the owner should see and the 409 with its "what changed" line, the plan surviving release,
 * Mark wrong, and the home card's plan line.
 */
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { NextRequest } from 'next/server';
import type { Mock } from 'vitest';

vi.mock('@/lib/auth/middleware', async (orig) => ({
  ...(await orig<typeof import('@/lib/auth/middleware')>()),
  requireAuth: vi.fn(),
}));

import { readFileSync, readdirSync, statSync } from 'fs';
import path from 'path';
import { prisma } from '@/lib/db/prisma';
import { requireAuth, type AuthPayload } from '@/lib/auth/middleware';
import { SCRATCH } from '@/lib/engine/__tests__/seed';
import { MIKE_USER_ID, BOT_USER_IDS } from '@/lib/oracle/projects/gate-constants';
import { runHomeAct } from '@/lib/home/act';
import { loadCards } from '@/lib/tasks/triage-card';
import { GET as getPlan } from '@/app/api/tasks/[id]/plan/route';
import { PUT as putSection, PATCH as patchSection } from '@/app/api/tasks/[id]/plan/[section]/route';
import { PATCH as patchTriage } from '@/app/api/tasks/[id]/triage/route';
import { PUT as putShape } from '@/app/api/tasks/[id]/triage/shape/route';
import { GET as getProjectPlan } from '@/app/api/projects/[id]/plan/route';
import { POST as addQ } from '@/app/api/tasks/[id]/questions/route';
import { POST as answerQ } from '@/app/api/tasks/[id]/questions/[qid]/answer/route';
import { ApiError, AuthError, handleApiError } from '@/lib/api/errors';

const authMock = requireAuth as Mock;
const NOW = new Date();
const OPTS = { now: NOW, timezone: 'America/New_York', date: NOW.toISOString().slice(0, 10) };
const idp = (id: string) => ({ params: Promise.resolve({ id }) });
const sp = (id: string, section: string) => ({ params: Promise.resolve({ id, section }) });
const req = (body?: unknown, headers: Record<string, string> = {}) =>
  new NextRequest('http://localhost/api/x', { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body), headers });
const bodyReq = (method: string, body: unknown) => new NextRequest('http://localhost/api/x', { method, body: JSON.stringify(body) });

const SRC = { label: 'Signed SOW, section 3', date: '2026-10-20', kind: 'document' };
const reqItem = (text: string, extra: Record<string, unknown> = {}) => ({ text, source: SRC, ...extra });
const CONTEXT = {
  what_it_is: 'The kava finder page needs a decision before the build starts.',
  sources: [{ who: 'Mike', said: 'Decide after the client call', at: '2026-11-10' }],
  checked: 'The page and the client brief were both read.',
  unknown: 'Whether the client wants the map on mobile.',
  if_nobody: 'The card is released and the first option goes ahead.',
  if_nobody_action: 'wait',
};
const OTHER_UUID = '11111111-1111-4111-8111-111111111111';

describe.skipIf(!SCRATCH)('triage plan (real database)', () => {
  const tag = `pl${Date.now()}`;
  const taskIds: string[] = [];
  const projectIds: string[] = [];
  let techId: string, designerId: string, pmId: string, adminId: string, botId: string, clientId: string;

  const mike = (): AuthPayload => ({ userId: MIKE_USER_ID, role: 'admin', email: 'm@test', via: 'session' });
  const mikeKey = (): AuthPayload => ({ userId: MIKE_USER_ID, role: 'admin', email: 'm@test', via: 'api_key', apiKeyId: 'k0' });
  const lane = (l: string, id: string): AuthPayload => ({ userId: botId, role: 'pm', email: 'b@test', via: 'api_key', apiKeyId: id, lane: l, laneEnforced: true });
  const chat = () => lane('bast-chat', 'k1');
  const dox = () => lane('dox', 'k2');
  const worker = () => lane('bast', 'k3');
  const otherLane = () => lane('troubador', 'k4');
  const adminKey = (): AuthPayload => ({ userId: adminId, role: 'admin', email: 'a@test', via: 'api_key', apiKeyId: 'k6' });
  const mikeLaneKey = (): AuthPayload => ({ userId: MIKE_USER_ID, role: 'admin', email: 'm@test', via: 'api_key', apiKeyId: 'k7', lane: 'troubador', laneEnforced: true });
  const botKey = (): AuthPayload => ({ userId: botId, role: 'pm', email: 'b@test', via: 'api_key', apiKeyId: 'k5' });
  const pm = (): AuthPayload => ({ userId: pmId, role: 'pm', email: 'p@test', via: 'session' });
  const admin = (): AuthPayload => ({ userId: adminId, role: 'admin', email: 'a@test', via: 'session' });
  const tech = (): AuthPayload => ({ userId: techId, role: 'tech', email: 't@test', via: 'session' });
  const designer = (): AuthPayload => ({ userId: designerId, role: 'designer', email: 'd@test', via: 'session' });
  const as = (a: AuthPayload) => authMock.mockResolvedValue(a);

  const mkTask = async (title: string, extra: Record<string, unknown> = {}) => {
    const t = await prisma.task.create({ data: { title: `${tag} ${title}`, status: 'triage', ...extra } as never });
    taskIds.push(t.id);
    return t.id;
  };
  const get = async (id: string, who: AuthPayload) => {
    as(who);
    const res = await getPlan(req(), idp(id));
    return { status: res.status, body: (await res.json()) as any };
  };
  const put = async (id: string, section: string, items: unknown[], who: AuthPayload = chat(), headers: Record<string, string> = {}, description?: string) => {
    as(who);
    const res = await putSection(req({ items, ...(description ? { description } : {}) }, headers), sp(id, section));
    return { status: res.status, body: (await res.json()) as any };
  };
  const patch = async (id: string, section: string, body: unknown, who: AuthPayload = chat(), headers: Record<string, string> = {}) => {
    as(who);
    const res = await patchSection(req(body, headers), sp(id, section));
    return { status: res.status, body: (await res.json()) as any };
  };
  const rev = async (id: string) => (await prisma.task.findUniqueOrThrow({ where: { id } })).triage_rev;
  const card = async (id: string) => (await loadCards(prisma, [id]))[0];

  beforeAll(async () => {
    await prisma.user.upsert({ where: { id: MIKE_USER_ID }, update: {}, create: { id: MIKE_USER_ID, email: `mike-${tag}@example.test`, password_hash: 'x', name: 'Mike', role: 'admin' } });
    await prisma.user.upsert({ where: { id: BOT_USER_IDS[0] }, update: {}, create: { id: BOT_USER_IDS[0], email: `bast-${tag}@example.test`, password_hash: 'x', name: 'Bast', role: 'pm' } });
    botId = BOT_USER_IDS[0];
    const mkUser = async (name: string, role: 'tech' | 'designer' | 'admin' | 'pm') => (await prisma.user.create({ data: { email: `${name}-${tag}@example.test`, password_hash: 'x', name: `${name} ${tag}`, role } })).id;
    techId = await mkUser('tech', 'tech');
    designerId = await mkUser('designer', 'designer');
    pmId = await mkUser('pm', 'pm');
    adminId = await mkUser('admin', 'admin');
    clientId = (await prisma.client.create({ data: { name: `${tag} Co`, type: 'direct', status: 'active' } })).id;
  });
  afterAll(async () => {
    await prisma.homeAction.deleteMany({ where: { user_id: MIKE_USER_ID, action: { startsWith: 'triage_' } } });
    await prisma.notification.deleteMany({ where: { entity_id: { in: taskIds } } });
    await prisma.activityLog.deleteMany({ where: { entity_id: { in: taskIds } } });
    await prisma.task.deleteMany({ where: { id: { in: taskIds } } });
    await prisma.project.deleteMany({ where: { id: { in: projectIds } } });
    await prisma.client.deleteMany({ where: { id: clientId } });
    await prisma.user.deleteMany({ where: { id: { in: [techId, designerId, pmId, adminId] } } });
    await prisma.$disconnect();
  });

  describe('the whole plan', () => {
    it('an empty plan has all eight sections in fixed order, no lines and no last-change line', async () => {
      const t = await mkTask('empty');
      const r = await get(t, mike());
      expect(r.status).toBe(200);
      expect(r.body.sections.map((s: any) => s.section)).toEqual(['requirements', 'dates', 'team', 'billing', 'planned_tasks', 'risks', 'examples', 'decisions']);
      expect(r.body.sections.every((s: any) => s.items.length === 0 && s.updated_at === null)).toBe(true);
      expect(r.body.updated_at).toBeNull();
      expect(r.body.project).toBeNull();
      expect(r.body.viewer).toEqual({ can_write: true, is_owner: true });
    });

    it('every section round-trips with its source and mark, and carries who changed it and the one-line description', async () => {
      const t = await mkTask('round trip');
      expect((await put(t, 'requirements', [reqItem('Eight pages'), reqItem('Shop opens in March', { mark: 'changed', was: 'Shop opens in January', changed_by: 'Dan, Nov 9 email' }), reqItem('Blog', { mark: 'dropped', changed_by: 'Dan, Nov 9 email' })], chat(), {}, 'First pass from the SOW')).status).toBe(200);
      expect((await put(t, 'dates', [{ label: 'Staging', date: '2026-12-15', source: SRC }])).status).toBe(200);
      expect((await put(t, 'team', [{ person: { name: 'Lisa', org: 'Freelance designer' }, role: 'Designs the pages' }, { person: { user_id: MIKE_USER_ID }, role: 'Approves the home page design' }])).status).toBe(200);
      expect((await put(t, 'billing', [{ type: 'milestone', label: 'Deposit', amount: '$4,500', trigger: 'On signing' }, { type: 'basis', kind: 'milestones', source: SRC }])).status).toBe(200);
      expect((await put(t, 'examples', [{ url: 'https://example.com/shop', note: 'A calm product page', source: SRC }])).status).toBe(200);
      expect((await put(t, 'decisions', [{ text: 'Keep the old logo', source: { label: 'Mike, typed in chat', kind: 'mike_typed' } }])).status).toBe(200);
      const r = await get(t, mike());
      const by = (n: string) => r.body.sections.find((s: any) => s.section === n);
      expect(by('requirements').items).toHaveLength(3);
      expect(by('requirements').items[1]).toMatchObject({ mark: 'changed', was: 'Shop opens in January', changed_by: 'Dan, Nov 9 email', marked_wrong: false, updated_by: 'the chat' });
      expect(by('requirements').updated_by).toBe('the chat');
      expect(by('requirements').note).toBe('First pass from the SOW');
      expect(by('billing').items.map((i: any) => i.type)).toEqual(['basis', 'milestone']); // basis first whatever the order sent
      expect(by('billing').items[0].matches_citadel).toBeNull();
      expect(by('billing').items[1].amount).toBe('$4,500');
      expect(by('team').items.find((i: any) => i.is_mike).person_name).toBe('Mike');
      expect(r.body.updated_by).toBe('the chat');
    });

    it('PUT keeps a line that carries its id and removes the lines it leaves out; PATCH adds, changes and removes one', async () => {
      const t = await mkTask('put and patch');
      const first = await put(t, 'requirements', [reqItem('One'), reqItem('Two')]);
      const [a, b] = first.body.items;
      const second = await put(t, 'requirements', [{ id: b.id, ...reqItem('Two') }, reqItem('Three')]);
      expect(second.body.items.map((i: any) => i.text)).toEqual(['Two', 'Three']);
      expect(second.body.items[0].id).toBe(b.id);
      expect(await prisma.taskPlanItem.findUnique({ where: { id: a.id } })).toBeNull();
      expect((await put(t, 'requirements', [{ id: a.id, ...reqItem('Ghost') }])).status).toBe(400); // an id that is not a line of the section
      const added = await patch(t, 'requirements', { op: 'add', item: reqItem('Four') });
      expect(added.body.items.map((i: any) => i.text)).toEqual(['Two', 'Three', 'Four']);
      const changed = await patch(t, 'requirements', { op: 'change', id: added.body.items[2].id, item: reqItem('Four, rewritten') });
      expect(changed.body.items[2].text).toBe('Four, rewritten');
      const removed = await patch(t, 'requirements', { op: 'remove', id: added.body.items[0].id });
      expect(removed.body.items.map((i: any) => i.text)).toEqual(['Three', 'Four, rewritten']);
      expect(removed.body.items.map((i: any) => i.position)).toEqual([0, 1]);
      expect((await patch(t, 'requirements', { op: 'remove', id: a.id })).status).toBe(404);
    });
  });

  describe('validation through the routes', () => {
    it('names the first problem in plain words, per section, and stores nothing', async () => {
      const t = await mkTask('validation');
      const cases: [string, unknown[], string][] = [
        ['requirements', [{ text: 'No source' }], 'Requirements'],
        ['requirements', [reqItem('Changed', { mark: 'changed' })], 'was'],
        ['dates', [{ label: 'Launch soon', date: '2026-02-31', source: SRC }], 'real date'],
        ['team', [{ person: { user_id: OTHER_UUID }, role: 'Builds' }], 'does not exist'],
        ['billing', [{ type: 'basis', kind: 'hourly', source: SRC }, { type: 'basis', kind: 'retainer', source: SRC }], 'one basis'],
        ['billing', [{ type: 'milestone', label: 'Deposit', amount: '$1', trigger: 'On signing' }], 'basis line first'],
        ['billing', [{ type: 'basis', kind: 'retainer', source: SRC }, { type: 'milestone', label: 'Deposit', amount: '$1', trigger: 'On signing' }], 'kind milestones'],
        ['examples', [{ url: 'javascript:alert(1)', note: 'x', source: SRC }], 'link'],
        ['decisions', [{ text: 'Chose B' }], 'Decisions'],
      ];
      for (const [section, items, word] of cases) {
        const r = await put(t, section, items);
        expect(r.status, `${section}: ${JSON.stringify(r.body)}`).toBe(400);
        expect(JSON.stringify(r.body)).toContain(word);
      }
      expect(await prisma.taskPlanItem.count({ where: { task_id: t } })).toBe(0);
      expect((await put(t, 'nonsense', [])).status).toBe(404);
      expect((await put(t, 'requirements', Array.from({ length: 151 }, (_, i) => reqItem(`R${i}`)))).status).toBe(400);
    });

    it('a project card keeps its start and launch dates as the project fields: plan dates with those labels are refused', async () => {
      const p = await prisma.project.create({ data: { name: `${tag} proj`, client_id: clientId, status: 'queue' } });
      projectIds.push(p.id);
      const t = await mkTask('project card', { triage_kind: 'project_setup', project_id: p.id, client_id: clientId });
      const r = await put(t, 'dates', [{ label: 'Launch', date: '2027-01-19', source: SRC }]);
      expect(r.status).toBe(400);
      expect(r.body.code).toBe('plan_project_date');
      expect((await put(t, 'dates', [{ label: 'Design handoff', date: '2026-12-01', source: SRC }])).status).toBe(200);
      as(chat());
      expect((await patchTriage(bodyReq('PATCH', { target_launch_date: '2027-01-19', date_source: { kind: 'sow', label: 'Signed SOW' } }), idp(t))).status).toBe(200);
      const read = await get(t, mike());
      expect(read.body.project).toMatchObject({ project_id: p.id, target_date: '2027-01-19' }); // read through, not copied
      expect(read.body.sections.find((s: any) => s.section === 'dates').items).toHaveLength(1);
    });
  });

  describe('who may read and write', () => {
    it('while in Triage: Mike (session or key), the chat lane and Dox read; every other role and lane gets a 404', async () => {
      const t = await mkTask('triage visibility');
      await put(t, 'requirements', [reqItem('Secret scope')]);
      for (const who of [mike(), mikeKey(), chat(), dox()]) expect((await get(t, who)).status).toBe(200);
      const others: [string, AuthPayload][] = [['pm', pm()], ['admin', admin()], ['tech', tech()], ['designer', designer()], ['bot key, no lane', botKey()], ['worker lane', worker()], ['another lane', otherLane()]];
      for (const [name, who] of others) {
        const r = await get(t, who);
        expect(r.status, name).toBe(404);
        expect(JSON.stringify(r.body)).not.toContain('Secret scope');
      }
    });

    it("while in Triage: Mike's session, his own un-laned API key, the chat and Dox write; everyone who cannot read is refused", async () => {
      const t = await mkTask('triage writers');
      expect((await put(t, 'decisions', [{ text: 'a', source: SRC }], mike())).status).toBe(200);
      expect((await put(t, 'decisions', [{ text: 'b', source: SRC }], chat())).status).toBe(200);
      expect((await put(t, 'decisions', [{ text: 'c', source: SRC }], dox())).status).toBe(200);
      expect((await put(t, 'decisions', [{ text: 'd', source: SRC }], mikeKey())).status).toBe(200); // Mike's standalone work sessions (2026-11-14)
      for (const who of [pm(), admin(), adminKey(), tech(), designer(), botKey(), worker(), otherLane(), mikeLaneKey()]) expect((await put(t, 'decisions', [{ text: 'x', source: SRC }], who)).status).toBe(404);
      const latest = await get(t, mike());
      expect(latest.body.sections[7].items.map((i: any) => i.text)).toEqual(['d']);
      expect(latest.body.sections[7].updated_by).toBe('Mike');
      expect(latest.body.viewer.can_write).toBe(true);
      expect((await get(t, mikeKey())).body.viewer.can_write).toBe(true);
    });

    it("Mike's un-laned API key adds, changes, removes and marks wrong on a Triage card and on a released one; other keys are refused", async () => {
      const t = await mkTask('own key ops');
      const added = await patch(t, 'requirements', { op: 'add', item: reqItem('Ten pages') }, mikeKey());
      expect(added.status).toBe(200);
      const id = added.body.items[0].id;
      expect((await patch(t, 'requirements', { op: 'change', id, item: reqItem('Eight pages') }, mikeKey())).body.items[0].text).toBe('Eight pages');
      expect((await patch(t, 'requirements', { op: 'mark_wrong', id, wrong: true }, mikeKey())).body.items[0].marked_wrong).toBe(true);
      for (const who of [adminKey(), mikeLaneKey(), botKey(), worker()]) expect((await patch(t, 'requirements', { op: 'add', item: reqItem('No') }, who)).status).toBe(404);
      expect((await patch(t, 'requirements', { op: 'remove', id }, mikeKey())).body.items).toHaveLength(0);
      await prisma.task.update({ where: { id: t }, data: { status: 'not_started' } });
      expect((await patch(t, 'requirements', { op: 'add', item: reqItem('After release') }, mikeKey())).status).toBe(200);
      for (const who of [adminKey(), mikeLaneKey()]) {
        const r = await patch(t, 'requirements', { op: 'add', item: reqItem('No') }, who);
        expect(r.status).toBe(403);
        expect(r.body.code).toBe('plan_forbidden');
      }
      const a = (await get(t, mikeKey())).body.sections[0].items;
      expect((await patch(t, 'requirements', { op: 'mark_wrong', id: a[0].id, wrong: true }, adminKey())).status).toBe(403);
    });

    it('after release: staff who can see the task read it, a contractor without billing, a designer never; writing stays with Mike, the chat and Dox', async () => {
      const t = await mkTask('released', { assignee_id: techId });
      await put(t, 'billing', [{ type: 'basis', kind: 'hourly', source: SRC }]);
      await put(t, 'requirements', [reqItem('Build the thing')]);
      await prisma.task.update({ where: { id: t }, data: { status: 'not_started' } });
      expect((await get(t, pm())).body.sections[3].items).toHaveLength(1);
      expect((await get(t, worker())).status).toBe(200);
      expect((await get(t, botKey())).status).toBe(200);
      const contractor = await get(t, tech());
      expect(contractor.status).toBe(200);
      expect(contractor.body.sections[3]).toMatchObject({ items: [], withheld: true });
      expect(contractor.body.sections[0].items).toHaveLength(1);
      expect((await get(t, designer())).status).toBe(404);
      expect((await put(t, 'requirements', [reqItem('Changed after release')], chat())).status).toBe(200);
      expect((await put(t, 'requirements', [reqItem('Mine')], mike())).status).toBe(200);
      expect((await put(t, 'requirements', [reqItem('Own key')], mikeKey())).status).toBe(200);
      for (const who of [pm(), admin(), adminKey(), tech(), worker(), botKey(), mikeLaneKey()]) expect((await put(t, 'requirements', [reqItem('No')], who)).status, JSON.stringify(who.lane)).toBe(403);
      expect((await put(t, 'requirements', [reqItem('No')], designer())).status).toBe(404);
      expect((await put(t, 'requirements', [reqItem('Dox on a card with no project')], dox())).status).toBe(200);
    });

    it('Dox on a released project card needs the project in play: no header, a wrong header or no open pass is a 403', async () => {
      const p = await prisma.project.create({ data: { name: `${tag} live`, client_id: clientId, status: 'ready' } });
      projectIds.push(p.id);
      const t = await mkTask('dox bound', { status: 'not_started', project_id: p.id, triage_kind: 'project_setup' });
      const noHeader = await put(t, 'requirements', [reqItem('x')], dox());
      expect(noHeader.status).toBe(403);
      expect(noHeader.body.code).toBe('dox_no_project');
      expect((await put(t, 'requirements', [reqItem('x')], dox(), { 'x-dox-project': p.id })).body.code).toBe('dox_no_pass');
      expect((await put(t, 'requirements', [reqItem('x')], dox(), { 'x-dox-project': OTHER_UUID })).body.code).toBe('dox_outside_project');
      expect((await get(t, dox())).status).toBe(200); // reading is open to it
    });

    it('the client portal never reads it: staff auth fails closed, and no portal source touches the plan tables', async () => {
      const t = await mkTask('portal', { client_id: clientId, client_visible: true });
      authMock.mockRejectedValue(new AuthError('Unauthorized', 401));
      expect((await getPlan(req(), idp(t))).status).toBe(401);
      expect((await putSection(req({ items: [] }), sp(t, 'requirements'))).status).toBe(401);
      const root = process.cwd();
      const walk = (d: string): string[] =>
        readdirSync(d).flatMap((n) => {
          const f = path.join(d, n);
          if (n === 'node_modules' || n === '.next' || n === '__tests__') return [];
          return statSync(f).isDirectory() ? walk(f) : /\.(ts|tsx)$/.test(n) ? [f] : [];
        });
      for (const d of ['lib/portal', 'app/(portal)', 'app/api/portal']) {
        let files: string[] = [];
        try {
          files = walk(path.join(root, d));
        } catch {
          continue;
        }
        for (const f of files) expect(readFileSync(f, 'utf8'), f).not.toMatch(/taskPlanItem|triageChange|task_plan_items|triage_changes|lib\/tasks\/plan/);
      }
    });
  });

  describe('Mark wrong', () => {
    it('Mike (or the chat relaying him) flags a line, the flag shows in the read, a rewritten line loses it, Dox cannot set it', async () => {
      const t = await mkTask('mark wrong');
      const a = (await put(t, 'requirements', [reqItem('Ten pages'), reqItem('Blog')])).body.items;
      expect((await patch(t, 'requirements', { op: 'mark_wrong', id: a[0].id, wrong: true }, dox())).status).toBe(403);
      const flagged = await patch(t, 'requirements', { op: 'mark_wrong', id: a[0].id, wrong: true }, mike());
      expect(flagged.body.items[0]).toMatchObject({ marked_wrong: true, marked_wrong_by: 'Mike' });
      expect((await get(t, chat())).body.sections[0].items[0].marked_wrong).toBe(true); // readable by the chat, so it corrects it
      const same = await put(t, 'requirements', [{ id: a[0].id, ...reqItem('Ten pages') }, { id: a[1].id, ...reqItem('Blog') }]);
      expect(same.body.items[0].marked_wrong).toBe(true); // the same words keep the flag
      const fixed = await patch(t, 'requirements', { op: 'change', id: a[0].id, item: reqItem('Eight pages') });
      expect(fixed.body.items[0]).toMatchObject({ text: 'Eight pages', marked_wrong: false }); // new words clear it
      await patch(t, 'requirements', { op: 'mark_wrong', id: a[1].id, wrong: true }, chat());
      expect((await patch(t, 'requirements', { op: 'mark_wrong', id: a[1].id, wrong: false }, mike())).body.items[1].marked_wrong).toBe(false);
    });
  });

  describe('triage_rev and the Release tap', () => {
    it('goes up on kind, project, dates, shape, questions and every plan write, and each leaves a change line', async () => {
      const p = await prisma.project.create({ data: { name: `${tag} rev`, client_id: clientId, status: 'queue' } });
      projectIds.push(p.id);
      const t = await mkTask('rev');
      expect(await rev(t)).toBe(0);
      as(chat());
      await patchTriage(bodyReq('PATCH', { kind: 'project_setup' }), idp(t));
      expect(await rev(t)).toBe(1);
      await patchTriage(bodyReq('PATCH', { project_id: p.id }), idp(t));
      expect(await rev(t)).toBe(2);
      await patchTriage(bodyReq('PATCH', { target_launch_date: '2027-01-19', date_source: { kind: 'sow', label: 'Signed SOW' } }), idp(t));
      expect(await rev(t)).toBe(3);
      await putShape(bodyReq('PUT', { pages: [{ name: 'Home' }] }), idp(t));
      expect(await rev(t)).toBe(4);
      const asked = await addQ(req({ question: 'Which logo goes in the header?', ...CONTEXT }), idp(t));
      expect(asked.status).toBe(201);
      expect(await rev(t)).toBe(5);
      const qid = ((await asked.json()) as { id: string }).id;
      const row = await prisma.taskQuestion.findUniqueOrThrow({ where: { id: qid } });
      as(mike());
      expect((await answerQ(req({ version: row.updated_at.toISOString(), text: 'The old one' }), { params: Promise.resolve({ id: t, qid }) })).status).toBe(200);
      expect(await rev(t)).toBe(6);
      await put(t, 'billing', [{ type: 'basis', kind: 'retainer', source: SRC }]);
      expect(await rev(t)).toBe(7);
      await patch(t, 'billing', { op: 'mark_wrong', id: (await prisma.taskPlanItem.findFirstOrThrow({ where: { task_id: t } })).id, wrong: true }, mike());
      expect(await rev(t)).toBe(8);
      const lines = (await prisma.triageChange.findMany({ where: { task_id: t }, orderBy: { created_at: 'asc' } })).map((c) => c.line);
      expect(lines).toContain('Kind set by the chat');
      expect(lines.some((l) => /^Sitemap redrawn by the chat/.test(l))).toBe(true);
      expect(lines).toContain('Question answered by Mike');
      expect(lines).toContain('Plan: Billing model updated by the chat');
      expect((await card(t)).triage_rev).toBe(8);
    });

    it('a Release tap after an unseen plan write is a 409 card_changed with a "what changed" line; reading the card again lets it through', async () => {
      const t = await mkTask('stale tap', { triage_kind: 'task' });
      const seen = await card(t);
      await put(t, 'billing', [{ type: 'basis', kind: 'hourly', source: SRC }], chat());
      const stale = runHomeAct(prisma, MIKE_USER_ID, { action: 'triage_release_card', task_ids: [t], release_version: seen.release_version }, OPTS);
      await expect(stale).rejects.toMatchObject({ statusCode: 409, code: 'card_changed', extra: { what_changed: 'Plan: Billing model updated by the chat' } });
      expect((await prisma.task.findUniqueOrThrow({ where: { id: t } })).status).toBe('triage');
      const fresh = await card(t);
      expect(fresh.release_version).not.toBe(seen.release_version);
      expect(fresh.recent_changes[0].line).toBe('Plan: Billing model updated by the chat');
      await runHomeAct(prisma, MIKE_USER_ID, { action: 'triage_release_card', task_ids: [t], release_version: fresh.release_version }, OPTS);
      expect((await prisma.task.findUniqueOrThrow({ where: { id: t } })).status).not.toBe('triage');
    });

    it('the 409 body reaches the client through the route error handler', async () => {
      const res = handleApiError(new ApiError('x', 409, 'card_changed', undefined, { what_changed: 'Plan: Team updated by Dox' }));
      expect(await res.json()).toMatchObject({ code: 'card_changed', what_changed: 'Plan: Team updated by Dox' });
    });

    it('the plan survives release and stays current; a write after release logs its change but no longer moves triage_rev', async () => {
      const t = await mkTask('survives', { triage_kind: 'task' });
      await put(t, 'requirements', [reqItem('Keep me')], chat());
      const c = await card(t);
      await runHomeAct(prisma, MIKE_USER_ID, { action: 'triage_release_card', task_ids: [t], release_version: c.release_version }, OPTS);
      const after = await get(t, mike());
      expect(after.status).toBe(200);
      expect(after.body.status).not.toBe('triage');
      expect(after.body.sections[0].items.map((i: any) => i.text)).toEqual(['Keep me']);
      const before = await rev(t);
      expect((await put(t, 'requirements', [reqItem('Keep me'), reqItem('Added by Dox later')], dox())).status).toBe(200);
      expect(await rev(t)).toBe(before);
      const again = await get(t, mike());
      expect(again.body.updated_by).toBe('Dox');
      expect(again.body.sections[0].items).toHaveLength(2);
    });

    it('a project card: the project page link finds the setup card and its plan; answered questions read through to Decisions', async () => {
      const p = await prisma.project.create({ data: { name: `${tag} link`, client_id: clientId, status: 'queue' } });
      projectIds.push(p.id);
      const t = await mkTask('setup card', { triage_kind: 'project_setup', project_id: p.id, client_id: clientId });
      await put(t, 'requirements', [reqItem('One')]);
      as(mike());
      const link = await getProjectPlan(req(), idp(p.id));
      expect(link.status).toBe(200);
      expect(await link.json()).toMatchObject({ task_id: t, href: `/tasks/${t}?tab=plan`, plan_lines: 1 });
      as(designer());
      expect((await getProjectPlan(req(), idp(p.id))).status).toBe(404);
      as(chat());
      const asked = await addQ(req({ question: 'Which logo?', ...CONTEXT }), idp(t));
      const qid = ((await asked.json()) as { id: string }).id;
      const row = await prisma.taskQuestion.findUniqueOrThrow({ where: { id: qid } });
      as(mike());
      await answerQ(req({ version: row.updated_at.toISOString(), text: 'The old one' }), { params: Promise.resolve({ id: t, qid }) });
      const r = await get(t, mike());
      expect(r.body.answered_questions).toMatchObject([{ question: 'Which logo?', answer: 'The old one', by_mike: true }]);
      expect(r.body.sections[7].items).toHaveLength(0); // read through, not copied
    });
  });

  describe('planned tasks and risks', () => {
    const task = (title: string, extra: Record<string, unknown> = {}) => ({ title, for: { kind: 'bast' }, source: SRC, ...extra });

    it('lists noted work without creating it; depends_on is accepted and ignored; done_when becomes the note; a task_id must be a real task', async () => {
      const t = await mkTask('planned');
      const before = await prisma.task.count();
      const first = await put(t, 'planned_tasks', [task('Build the header'), task('Build the footer', { for: { name: 'Lisa', org: 'Freelance designer' }, when: 'before design handoff' })]);
      expect(first.status).toBe(200);
      expect(await prisma.task.count()).toBe(before); // nothing created
      const [a, b] = first.body.items;
      expect(a.depends_on).toBeUndefined();
      const chained = await patch(t, 'planned_tasks', { op: 'change', id: b.id, item: task('Build the footer', { for: { name: 'Lisa' }, depends_on: [a.id], when: '2026-12-04', done_when: 'Footer matches the design' }) });
      expect(chained.status).toBe(200);
      expect((await patch(t, 'planned_tasks', { op: 'add', item: task('y', { depends_on: [OTHER_UUID] }) })).status).toBe(200);
      const read = await get(t, mike());
      expect(read.body.sections[4].items[1]).toMatchObject({ note: 'Footer matches the design', when: '2026-12-04' });
      expect(read.body.sections[4].items[1].depends_on).toBeUndefined();
      const removed = await patch(t, 'planned_tasks', { op: 'remove', id: (await prisma.taskPlanItem.findMany({ where: { task_id: t, section: 'planned_tasks' }, orderBy: { position: 'desc' } }))[0].id });
      expect(removed.body.items).toHaveLength(2);
      // for: a Citadel user is resolved by name; a task_id must be a real task
      const withUser = await put(t, 'planned_tasks', [{ id: b.id, ...task('Build the footer', { for: { user_id: MIKE_USER_ID } }) }]);
      expect(withUser.status).toBe(200);
      expect((await get(t, mike())).body.sections[4].items[0]).toMatchObject({ for_name: 'Mike', is_mike: true });
      expect((await patch(t, 'planned_tasks', { op: 'change', id: b.id, item: task('Build the footer', { task_id: OTHER_UUID }) })).body.code).toBe('plan_unknown_task');
      const real = await mkTask('the real task');
      const linked = await patch(t, 'planned_tasks', { op: 'change', id: b.id, item: task('Build the footer', { task_id: real }) }, dox());
      expect(linked.body.items[0].task_id).toBe(real);
    });

    it('risks need what covers them or uncovered: true', async () => {
      const t = await mkTask('risks');
      expect((await put(t, 'risks', [{ risk: 'Ed is slow with photos', source: SRC }])).status).toBe(400);
      expect((await put(t, 'risks', [{ risk: 'Ed is slow with photos', covered_by: 'x', uncovered: true, source: SRC }])).status).toBe(400);
      const ok = await put(t, 'risks', [{ risk: 'Old domain DNS is with a third party', covered_by: 'Ed gives us the registrar login first', source: SRC }, { risk: 'Photos arrive late', uncovered: true, source: SRC }]);
      expect(ok.status).toBe(200);
      expect((await get(t, mike())).body.sections[5].items).toHaveLength(2);
    });

    it('the release line says Dox sets up the noted things, the count comes from the plan, and a line added after he read it makes his tap a 409', async () => {
      const t = await mkTask('release line', { triage_kind: 'task' });
      expect((await card(t)).release_line).not.toContain('planned');
      await put(t, 'planned_tasks', [task('One'), task('Two'), task('Dropped', { mark: 'dropped', changed_by: 'Mike' })]);
      const seen = await card(t);
      expect(seen.release_line).toContain('Dox sets up the 2 things noted in the plan.');
      expect(seen.plan_line).toBe('Plan: started'); // the plan line counts requirements, pages, launch date and billing kind, never tasks
      await patch(t, 'planned_tasks', { op: 'add', item: task('Three') });
      await expect(runHomeAct(prisma, MIKE_USER_ID, { action: 'triage_release_card', task_ids: [t], release_version: seen.release_version }, OPTS)).rejects.toMatchObject({ statusCode: 409, code: 'card_changed' });
      expect((await card(t)).release_line).toContain('Dox sets up the 3 things noted in the plan.');
    });
  });

  describe('the home card line', () => {
    it('reads "Plan: 12 requirements, launch Jan 19, milestones billing" from the sections, and is null with no plan', async () => {
      const p = await prisma.project.create({ data: { name: `${tag} line`, client_id: clientId, status: 'queue', target_date: new Date('2027-01-19T12:00:00Z') } });
      projectIds.push(p.id);
      const t = await mkTask('line', { triage_kind: 'project_setup', project_id: p.id, client_id: clientId });
      expect((await card(t)).plan_line).toBeNull();
      await put(t, 'requirements', Array.from({ length: 13 }, (_, i) => reqItem(`Req ${i}`, i === 12 ? { mark: 'dropped' } : {})));
      await put(t, 'billing', [{ type: 'basis', kind: 'milestones', source: SRC }]);
      expect((await card(t)).plan_line).toBe('Plan: 12 requirements, launch Jan 19, milestones billing');
      await put(t, 'planned_tasks', Array.from({ length: 14 }, (_, i) => ({ title: `Task ${i}`, for: { kind: 'bast' }, source: SRC })));
      expect((await card(t)).plan_line).toBe('Plan: 12 requirements, launch Jan 19, milestones billing'); // noted items are not counted in the line
    });
  });
});

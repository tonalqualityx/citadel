// @vitest-environment node
/**
 * PATCH/GET /api/tasks/:id/triage and PUT /api/tasks/:id/triage/shape against a real scratch Postgres: only Mike's session and the
 * enforced chat lane get in; Triage cards only; kind and project link; the project shape the chat drafts before release; and the
 * release_line fields on GET /api/tasks/:id.
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
import { MIKE_USER_ID } from '@/lib/oracle/projects/gate-constants';
import { GET, PATCH } from '../route';
import { PUT } from '../shape/route';
import { GET as getTask } from '../../route';

const authMock = requireAuth as Mock;
const params = (id: string) => ({ params: Promise.resolve({ id }) });
const req = (url: string, method: string, body?: unknown) => new NextRequest(new URL(url), { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) } as never);

describe.skipIf(!SCRATCH)('triage card routes (real database)', () => {
  const tag = `trr${Date.now()}`;
  const ids: string[] = [];
  const projectIds: string[] = [];
  let botId: string;
  let otherId: string;
  let clientId: string;
  let projectId: string;
  let card: string;

  const mike = (): AuthPayload => ({ userId: MIKE_USER_ID, role: 'admin', email: 'mike@test', via: 'session' });
  const mikeKey = (): AuthPayload => ({ userId: MIKE_USER_ID, role: 'admin', email: 'mike@test', via: 'api_key', apiKeyId: 'k0' });
  const bot = (): AuthPayload => ({ userId: botId, role: 'pm', email: 'bot@test', via: 'api_key', apiKeyId: 'k1' });
  const workerLane = (): AuthPayload => ({ userId: botId, role: 'pm', email: 'bot@test', via: 'api_key', apiKeyId: 'k2', lane: 'bast', laneEnforced: true });
  const chatLane = (): AuthPayload => ({ userId: botId, role: 'pm', email: 'bot@test', via: 'api_key', apiKeyId: 'k3', lane: 'bast-chat', laneEnforced: true });
  const as = (role: 'pm' | 'admin' | 'tech' | 'designer'): AuthPayload => ({ userId: otherId, role, email: `${role}@test`, via: 'session' });
  const mk = async (title: string, data: Record<string, unknown> = {}) => {
    const t = await prisma.task.create({ data: { title: `${tag} ${title}`, status: 'triage', ...data } as never });
    ids.push(t.id);
    return t.id;
  };
  const patch = (id: string, body: unknown) => PATCH(req(`http://localhost/api/tasks/${id}/triage`, 'PATCH', body), params(id));
  const shape = (id: string, body: unknown) => PUT(req(`http://localhost/api/tasks/${id}/triage/shape`, 'PUT', body), params(id));

  beforeAll(async () => {
    await prisma.user.upsert({ where: { id: MIKE_USER_ID }, update: {}, create: { id: MIKE_USER_ID, email: `mike-${tag}@example.test`, password_hash: 'x', name: 'Mike', role: 'admin' } });
    botId = (await prisma.user.create({ data: { email: `bot-${tag}@example.test`, password_hash: 'x', name: 'Bot', role: 'pm' } })).id;
    otherId = (await prisma.user.create({ data: { email: `oth-${tag}@example.test`, password_hash: 'x', name: 'Other', role: 'admin' } })).id;
    clientId = (await prisma.client.create({ data: { name: `${tag} Co` } })).id;
    projectId = (await prisma.project.create({ data: { name: `${tag} project`, client_id: clientId, status: 'queue' } })).id;
    projectIds.push(projectId);
  });
  afterAll(async () => {
    await prisma.activityLog.deleteMany({ where: { entity_id: { in: ids } } });
    await prisma.task.deleteMany({ where: { id: { in: ids } } });
    await prisma.project.deleteMany({ where: { id: { in: projectIds } } });
    await prisma.client.deleteMany({ where: { id: clientId } });
    await prisma.user.deleteMany({ where: { id: { in: [botId, otherId] } } });
    await prisma.$disconnect();
  });
  const fresh = async () => {
    card = await mk('card');
    return card;
  };

  it('PM, admin, tech, designer, bot key, worker lane, a laned key under Mike and another admin\'s API key are all refused (403) on PATCH, GET and PUT shape; nothing changes', async () => {
    await fresh();
    const mikeLaned = (): AuthPayload => ({ userId: MIKE_USER_ID, role: 'admin', email: 'mike@test', via: 'api_key', apiKeyId: 'k9', lane: 'troubador', laneEnforced: true });
    const otherAdminKey = (): AuthPayload => ({ userId: otherId, role: 'admin', email: 'oa@test', via: 'api_key', apiKeyId: 'k8' });
    for (const actor of [as('pm'), as('admin'), as('tech'), as('designer'), bot(), workerLane(), mikeLaned(), otherAdminKey()]) {
      authMock.mockResolvedValue(actor);
      for (const res of [await patch(card, { kind: 'task' }), await GET(req(`http://localhost/api/tasks/${card}/triage`, 'GET'), params(card)), await shape(card, { phases: [{ name: 'A' }] })]) {
        expect(res.status).toBe(403);
        expect((await res.json()).code ?? 'triage_forbidden').toBe('triage_forbidden');
      }
    }
    const t = await prisma.task.findUniqueOrThrow({ where: { id: card } });
    expect(t.triage_kind).toBeNull();
    expect(t.project_id).toBeNull();
  });

  it("Mike's own un-laned API key sets the shape from a card but still cannot edit the card's kind, read the card or release it", async () => {
    const c = await fresh();
    authMock.mockResolvedValue(mikeKey());
    expect((await patch(c, { kind: 'task' })).status).toBe(403);
    expect((await GET(req(`http://localhost/api/tasks/${c}/triage`, 'GET'), params(c))).status).toBe(403);
    const ownProject = (await prisma.project.create({ data: { name: `${tag} own key project`, client_id: clientId, status: 'queue' } })).id;
    projectIds.push(ownProject);
    const pc = await mk('shape card', { project_id: ownProject });
    const res = await shape(pc, { pages: [{ name: 'Own key page' }] });
    expect(res.status).toBe(200);
    expect((await prisma.projectPage.findMany({ where: { project_id: ownProject } })).map((p) => p.name)).toEqual(['Own key page']);
    // leaving Triage stays Mike's session and the chat lane: his API key is refused.
    const out = await prisma.task.findUniqueOrThrow({ where: { id: pc } });
    expect(out.status).toBe('triage');
  });

  it('Mike\'s session and the chat lane can set the kind, change it, and clear it; the card payload comes back', async () => {
    await fresh();
    authMock.mockResolvedValue(mike());
    let res = await patch(card, { kind: 'task' });
    expect(res.status).toBe(200);
    let body = await res.json();
    expect(body).toMatchObject({ task_id: card, kind: 'task', release_ready: true });
    expect(body.release_line).toMatch(/^Hands this to Dox/);
    authMock.mockResolvedValue(chatLane());
    res = await patch(card, { kind: 'question_only' });
    body = await res.json();
    expect(body).toMatchObject({ kind: 'question_only', release_ready: true });
    res = await patch(card, { kind: null });
    body = await res.json();
    expect(body).toMatchObject({ kind: null, release_ready: false, release_line: 'Not sorted yet' });
    const got = await GET(req(`http://localhost/api/tasks/${card}/triage`, 'GET'), params(card));
    expect(got.status).toBe(200);
  });

  it('a project card links to its project and takes the project\'s client; null unlinks', async () => {
    await fresh();
    authMock.mockResolvedValue(chatLane());
    const res = await patch(card, { kind: 'project_setup', project_id: projectId });
    expect(res.status).toBe(200);
    const t = await prisma.task.findUniqueOrThrow({ where: { id: card } });
    expect(t).toMatchObject({ project_id: projectId, client_id: clientId, triage_kind: 'project_setup' });
    expect((await res.json()).project).toMatchObject({ project_id: projectId, status: 'queue' });
    await patch(card, { project_id: null });
    expect((await prisma.task.findUniqueOrThrow({ where: { id: card } })).project_id).toBeNull();
  });

  it('bad input is a 400, an unknown project a 404, and a card that is not in Triage a 404', async () => {
    await fresh();
    authMock.mockResolvedValue(mike());
    expect((await patch(card, {})).status).toBe(400);
    expect((await patch(card, { kind: 'banana' })).status).toBe(400);
    expect((await patch(card, { kind: 'task', extra: 1 })).status).toBe(400);
    expect((await patch(card, { project_id: '00000000-0000-4000-8000-000000000000' })).status).toBe(404);
    const active = await mk('active', { status: 'not_started' });
    expect((await patch(active, { kind: 'task' })).status).toBe(404);
    expect((await GET(req(`http://localhost/api/tasks/${active}/triage`, 'GET'), params(active))).status).toBe(404);
  });

  it('shape: the chat drafts phases (with summary and mike_part) and pages on the linked queue project; a second call replaces them', async () => {
    await fresh();
    authMock.mockResolvedValue(chatLane());
    expect((await shape(card, { phases: [{ name: 'A' }] })).status).toBe(409); // not linked yet
    await patch(card, { kind: 'project_setup', project_id: projectId });
    const res = await shape(card, {
      phases: [
        { name: 'Design', summary: 'Pages are designed', mike_part: 'Approve the homepage' },
        { name: 'Build', summary: 'Pages are built', mike_part: null },
      ],
      pages: [{ name: 'Home', page_type: 'home', needs_design: true }, { name: 'About' }],
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.project.phases.map((p: { name: string }) => p.name)).toEqual(['Design', 'Build']);
    expect(body.project.mike_parts).toEqual([{ phase: 'Design', text: 'Approve the homepage' }]);
    expect(body.project.sitemap.map((p: { name: string }) => p.name)).toEqual(['Home', 'About']);
    // replace phases only: the pages are untouched
    const again = await (await shape(card, { phases: [{ name: 'Only' }] })).json();
    expect(again.project.phases).toHaveLength(1);
    expect(again.project.sitemap).toHaveLength(2);
  });

  it('shape on a live project merges pages and refuses phases; refused for a phase that already has tasks, and for non-owners', async () => {
    await fresh();
    authMock.mockResolvedValue(chatLane());
    const live = (await prisma.project.create({ data: { name: `${tag} live`, client_id: clientId, status: 'ready' } })).id;
    projectIds.push(live);
    await patch(card, { kind: 'project_setup', project_id: live });
    expect((await shape(card, { phases: [{ name: 'X' }] })).status).toBe(409);
    expect((await shape(card, { pages: [{ name: 'X' }] })).status).toBe(200);
    expect(await prisma.projectPage.count({ where: { project_id: live } })).toBe(1);
    await prisma.projectPage.deleteMany({ where: { project_id: live } });
    await patch(card, { project_id: projectId });
    const phase = await prisma.projectPhase.create({ data: { project_id: projectId, name: 'Has task' } });
    const t = await mk('in phase', { status: 'not_started', project_id: projectId, phase_id: phase.id });
    expect((await shape(card, { phases: [{ name: 'New' }] })).status).toBe(409);
    expect(await prisma.projectPhase.count({ where: { id: phase.id } })).toBe(1);
    await prisma.task.update({ where: { id: t }, data: { phase_id: null } });
    await prisma.projectPhase.deleteMany({ where: { project_id: projectId } });
    authMock.mockResolvedValue(as('admin'));
    expect((await shape(card, { pages: [{ name: 'X' }] })).status).toBe(403);
  });

  it('GET /api/tasks/:id carries triage_kind, release_line and release_ready for Mike and the chat lane only', async () => {
    await fresh();
    authMock.mockResolvedValue(mike());
    await patch(card, { kind: 'task' });
    for (const actor of [mike(), chatLane()]) {
      authMock.mockResolvedValue(actor);
      const body = await (await getTask(req(`http://localhost/api/tasks/${card}`, 'GET'), params(card))).json();
      expect(body).toMatchObject({ triage_kind: 'task', release_ready: true });
      expect(body.release_line).toMatch(/^Hands this to Dox/);
    }
    for (const actor of [as('pm'), bot(), mikeKey()]) {
      authMock.mockResolvedValue(actor);
      const body = await (await getTask(req(`http://localhost/api/tasks/${card}`, 'GET'), params(card))).json();
      expect(body.release_line).toBeUndefined();
      expect(body.release_ready).toBeUndefined();
    }
  });
});

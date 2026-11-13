/** Sitemap edits on a live project: the chat lane, Dox (binding, open pass), the owner, the shape route's merge, and the closed projects. Real scratch database. */
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { NextRequest } from 'next/server';
import type { Mock } from 'vitest';

vi.mock('@/lib/auth/middleware', async (orig) => ({ ...(await orig<typeof import('@/lib/auth/middleware')>()), requireAuth: vi.fn() }));

import { prisma } from '@/lib/db/prisma';
import { requireAuth, type AuthPayload } from '@/lib/auth/middleware';
import { SCRATCH } from '@/lib/engine/__tests__/seed';
import { PATCH as patchSitemap } from '@/app/api/projects/[id]/sitemap/route';
import { PUT as putShape } from '@/app/api/tasks/[id]/triage/shape/route';
import { idParams, makeFixture, chatLane, dox, mikeSession, type Fx } from '@/lib/dox/__tests__/fixture';

const as = (a: AuthPayload) => (requireAuth as Mock).mockResolvedValue(a);
const call = (body: unknown, method = 'PATCH', headers: Record<string, string> = {}) => new NextRequest('http://localhost/api/x', { method, body: JSON.stringify(body), headers });
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- response bodies are read loosely in these tests
const json = async (res: Response) => ({ status: res.status, body: (await res.json()) as Record<string, any> });

describe.skipIf(!SCRATCH)('sitemap edits on a project under way (real database)', () => {
  let fx: Fx;
  let live: string, doneP: string, cancelledP: string, queueP: string, setupCard: string;
  let homeId = '', aboutId = '';
  const pages = (p: string) => prisma.projectPage.findMany({ where: { project_id: p }, orderBy: { sort_order: 'asc' } });

  beforeAll(async () => {
    fx = await makeFixture('sm');
    live = await fx.mkProject('Live', { status: 'in_progress' });
    doneP = await fx.mkProject('Done', { status: 'done' });
    cancelledP = await fx.mkProject('Cancelled', { status: 'cancelled' });
    queueP = await fx.mkProject('Queue', { status: 'queue' });
    setupCard = await fx.mkTask('Setup', { status: 'not_started', triage_kind: 'project_setup', project_id: live, client_id: fx.clientId });
    await prisma.projectPage.createMany({ data: [{ project_id: live, name: 'Home', sort_order: 0 }, { project_id: live, name: 'About', sort_order: 1 }] });
    homeId = (await pages(live))[0].id;
    aboutId = (await pages(live))[1].id;
  });
  afterAll(async () => {
    await prisma.triageChange.deleteMany({ where: { task_id: { in: fx.taskIds } } });
    await prisma.projectPage.deleteMany({ where: { project_id: { in: fx.projectIds } } });
    await fx.cleanup();
    await prisma.$disconnect();
  });
  const lines = () => prisma.triageChange.findMany({ where: { task_id: setupCard, area: 'plan:sitemap' }, orderBy: { created_at: 'asc' } });

  it('the chat lane adds, changes and drops a page on an in-progress project, with and without a source', async () => {
    as(chatLane());
    const add = await json(await patchSitemap(call({ add: [{ name: 'Pricing', page_type: 'content', needs_design: true }], source: { kind: 'sow', label: 'the SOW', quote: 'a pricing page' } }), idParams(live)));
    expect(add.status, JSON.stringify(add.body)).toBe(200);
    expect(add.body.changed).toEqual(['Page added: Pricing (content)']);
    const ch = await json(await patchSitemap(call({ change: [{ id: homeId, name: 'Home page', notes: 'hero first' }] }), idParams(live)));
    expect(ch.status, JSON.stringify(ch.body)).toBe(200);
    expect(ch.body.changed[0]).toMatch(/^Page changed: Home, name from Home to Home page, notes updated$/);
    const dr = await json(await patchSitemap(call({ drop: [aboutId] }), idParams(live)));
    expect(dr.status).toBe(200);
    expect(dr.body.changed).toEqual(['Page dropped: About']);
    expect((await pages(live)).map((p) => p.name)).toEqual(['Home page', 'Pricing']);
    const rows = await lines();
    expect(rows.map((r) => r.line).sort()).toEqual(['Page added: Pricing (content), from the SOW', 'Page changed: Home, name from Home to Home page, notes updated', 'Page dropped: About'].sort());
    expect((rows.find((r) => /added/.test(r.line))!.detail as { source: { kind: string } }).source.kind).toBe('sow');
    expect((rows.find((r) => /changed/.test(r.line))!.detail as { source?: unknown }).source).toBeUndefined();
  });

  it('refuses a duplicate name, an unknown page and an empty request', async () => {
    as(chatLane());
    expect((await json(await patchSitemap(call({ add: [{ name: 'pricing' }] }), idParams(live)))).status).toBe(409);
    expect((await json(await patchSitemap(call({ drop: ['7f1c2d3e-0000-4000-8000-000000000000'] }), idParams(live)))).status).toBe(404);
    expect((await json(await patchSitemap(call({}), idParams(live)))).status).toBe(400);
  });

  it('a page whose name sits in task titles is dropped, and the tasks are left alone', async () => {
    as(chatLane());
    const t = await fx.mkTask('Build the Pricing page', { status: 'not_started', project_id: live });
    const id = (await pages(live)).find((p) => p.name === 'Pricing')!.id;
    const r = await json(await patchSitemap(call({ drop: [id] }), idParams(live)));
    expect(r.status).toBe(200);
    expect(r.body.dropped_with_tasks).toEqual([{ page: 'Pricing', open_tasks: 1 }]);
    expect(r.body.changed[0]).toMatch(/1 open task still name it and stay/);
    const task = await prisma.task.findUniqueOrThrow({ where: { id: t } });
    expect(task.is_deleted).toBe(false);
    expect(task.status).toBe('not_started');
  });

  it('Dox changes the sitemap with an open pass and the binding, and is refused without them', async () => {
    const h = { 'x-dox-project': live };
    as(dox());
    const noPass = await json(await patchSitemap(call({ add: [{ name: 'FAQ' }] }, 'PATCH', h), idParams(live)));
    expect(noPass.status).toBe(403);
    expect(noPass.body.code ?? noPass.body.error).toBeTruthy();
    expect((await json(await patchSitemap(call({ add: [{ name: 'FAQ' }] }), idParams(live)))).status).toBe(403); // no header
    await fx.openPass(live);
    const add = await json(await patchSitemap(call({ add: [{ name: 'FAQ' }] }, 'PATCH', h), idParams(live)));
    expect(add.status, JSON.stringify(add.body)).toBe(200);
    const faq = (await pages(live)).find((p) => p.name === 'FAQ')!;
    expect((await json(await patchSitemap(call({ change: [{ id: faq.id, needs_design: true }] }, 'PATCH', h), idParams(live)))).status).toBe(200);
    expect((await json(await patchSitemap(call({ drop: [faq.id] }, 'PATCH', h), idParams(live)))).status).toBe(200);
    expect((await lines()).filter((l) => /FAQ/.test(l.line)).length).toBe(3);
    // another project than the one named in the header
    expect((await json(await patchSitemap(call({ add: [{ name: 'X' }] }, 'PATCH', h), idParams(queueP)))).status).toBe(403);
  });

  it('the owner session may edit; a done or cancelled project is refused for everyone', async () => {
    as(mikeSession());
    expect((await json(await patchSitemap(call({ add: [{ name: 'Contact' }] }), idParams(live)))).status).toBe(200);
    for (const p of [doneP, cancelledP]) {
      const r = await json(await patchSitemap(call({ add: [{ name: 'Nope' }] }), idParams(p)));
      expect(r.status).toBe(409);
      expect(await pages(p)).toHaveLength(0);
    }
  });

  it('the shape route: a queue project is replaced as before; a live project merges pages by name and refuses phases', async () => {
    as(chatLane());
    const qCard = await fx.mkTask('Queue card', { status: 'triage', project_id: queueP, client_id: fx.clientId });
    await putShape(call({ pages: [{ name: 'A' }, { name: 'B' }] }, 'PUT'), idParams(qCard));
    expect((await pages(queueP)).map((p) => p.name)).toEqual(['A', 'B']);
    const q2 = await json(await putShape(call({ pages: [{ name: 'C' }] }, 'PUT'), idParams(qCard)));
    expect(q2.status).toBe(200);
    expect((await pages(queueP)).map((p) => p.name)).toEqual(['C']);

    const lCard = await fx.mkTask('Live card', { status: 'triage', project_id: live, client_id: fx.clientId });
    const before = (await pages(live)).map((p) => p.name);
    expect(before).toContain('Home page');
    const ph = await json(await putShape(call({ phases: [{ name: 'X' }] }, 'PUT'), idParams(lCard)));
    expect(ph.status).toBe(409);
    expect(ph.body.error ?? ph.body.message ?? JSON.stringify(ph.body)).toMatch(/phases/);
    const homeRowId = (await pages(live)).find((p) => p.name === 'Home page')!.id;
    const m = await json(await putShape(call({ pages: [{ name: 'home page', notes: 'merged' }, { name: 'Brand new' }] }, 'PUT'), idParams(lCard)));
    expect(m.status, JSON.stringify(m.body)).toBe(200);
    const after = await pages(live);
    expect(after.map((p) => p.name).sort()).toEqual(['Brand new', 'Home page']);
    expect(after.find((p) => p.name === 'Home page')!.id).toBe(homeRowId); // same row, updated
    expect(after.find((p) => p.name === 'Home page')!.notes).toBe('merged');
  });
});

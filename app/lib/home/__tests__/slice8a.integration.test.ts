// @vitest-environment node
/**
 * Slice 8a against a real Postgres: GET /api/home/projects/[id], the project drawer's route.
 * Skips unless DATABASE_URL names the scratch Postgres on localhost:55433. Run on its own clean database:
 *   DATABASE_URL=postgresql://citadel:citadel@localhost:55433/home_s8a_it npx vitest run lib/home/__tests__/slice8a.integration.test.ts
 *
 * Auth is the only mock: requireAuth answers with the caller the test names. requireHomeUser, the preference
 * read, the loaders, the selection and the project query are all real.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { randomUUID } from 'crypto';

const auth = vi.hoisted(() => ({ who: null as null | { userId: string; role: string; email: string; via: string } }));
vi.mock('@/lib/auth/middleware', () => ({
  requireAuth: vi.fn(async () => auth.who),
}));

import { prisma } from '@/lib/db/prisma';
import { GET } from '@/app/api/home/projects/[id]/route';
import { taskKey } from '../item-key';

const SCRATCH = /localhost:55433/.test(process.env.DATABASE_URL ?? '');
const TZ = 'America/New_York';

describe.skipIf(!SCRATCH)('Slice 8a: the project drawer route (real database)', () => {
  const tag = `s8a-${Date.now()}`;
  const adminId = randomUUID();
  const otherAdminId = randomUUID();
  const techId = randomUUID();
  const overlookAdminId = randomUUID();
  const users = [adminId, otherAdminId, techId, overlookAdminId];
  let clientId = '';
  let projA = '';
  let projB = '';
  let projEmpty = '';
  const taskIds: Record<string, string> = {};
  const waitIds: Record<string, string> = {};

  const as = (userId: string, role: string, via = 'session') => {
    auth.who = { userId, role, email: `${userId}@example.test`, via };
  };
  const call = (id: string) => GET(new Request(`http://localhost/api/home/projects/${id}`), { params: Promise.resolve({ id }) });

  async function counts() {
    const [task, wait, ask, action, state, day, comment, activity, project] = await Promise.all([
      prisma.task.findMany({ where: { id: { in: Object.values(taskIds) } }, orderBy: { id: 'asc' }, select: { id: true, updated_at: true, status: true } }),
      prisma.wait.findMany({ where: { client_id: clientId }, select: { id: true, updated_at: true, state: true } }),
      prisma.emailAsk.count(),
      prisma.homeAction.count(),
      prisma.homeItemState.count(),
      prisma.homeDay.count(),
      prisma.comment.count(),
      prisma.activityLog.count(),
      prisma.project.findMany({ where: { id: { in: [projA, projB, projEmpty] } }, select: { id: true, updated_at: true, next_step_refresh_requested_at: true } }),
    ]);
    return JSON.stringify({ task, wait, ask, action, state, day, comment, activity, project });
  }

  beforeAll(async () => {
    await prisma.user.createMany({
      data: [
        { id: adminId, email: `admin-${tag}@example.test`, password_hash: 'x', name: 'Admin 8A', role: 'admin' },
        { id: otherAdminId, email: `other-${tag}@example.test`, password_hash: 'x', name: 'Other 8A', role: 'admin' },
        { id: techId, email: `tech-${tag}@example.test`, password_hash: 'x', name: 'Tech 8A', role: 'tech' },
        { id: overlookAdminId, email: `ovl-${tag}@example.test`, password_hash: 'x', name: 'Overlook 8A', role: 'admin' },
      ],
    });
    await prisma.userPreference.createMany({
      data: [
        { user_id: adminId, home_view: 'home', timezone: TZ },
        { user_id: otherAdminId, home_view: 'home', timezone: TZ },
        { user_id: techId, home_view: 'overlook', timezone: TZ },
        { user_id: overlookAdminId, home_view: 'overlook', timezone: TZ },
      ],
    });
    clientId = (await prisma.client.create({ data: { name: `Client ${tag}`, status: 'active' } })).id;
    projA = (await prisma.project.create({ data: { name: `Alpha ${tag}`, client_id: clientId, status: 'in_progress' } })).id;
    projB = (await prisma.project.create({ data: { name: `Beta ${tag}`, client_id: clientId, status: 'in_progress' } })).id;
    projEmpty = (await prisma.project.create({ data: { name: `Empty ${tag}`, client_id: clientId, status: 'in_progress' } })).id;

    const mk = async (key: string, assignee: string, project_id: string, title: string) => {
      const row = await prisma.task.create({
        data: { title, assignee_id: assignee, created_by_id: assignee, status: 'not_started', needs_review: false, tags: [tag], client_id: clientId, project_id, created_at: new Date(Date.now() - 4 * 86_400_000) },
      });
      taskIds[key] = row.id;
    };
    await mk('mineA1', adminId, projA, 'Mine in Alpha one');
    await mk('mineA2', adminId, projA, 'Mine in Alpha two');
    await mk('mineB', adminId, projB, 'Mine in Beta');
    await mk('otherA', otherAdminId, projA, 'Other person task in Alpha');
    await mk('techA', techId, projA, 'Tech task in Alpha');

    // A wait on Alpha held by a client contact, and one held by another user. A third one is his own.
    const contact = await prisma.clientContact.create({ data: { client_id: clientId, name: 'Andy Test', email: `andy-${tag}@client.example` } });
    const base = { kind: 'external' as const, template_key: `t-${tag}`, client_id: clientId, project_id: projA, duration_value: 3, due_at: new Date(Date.now() + 3 * 86_400_000), terminal_action: 'proceed' as const, started_at: new Date(Date.now() - 6 * 86_400_000) };
    waitIds.andy = (await prisma.wait.create({ data: { ...base, title: 'Logo files from Andy', owner_contact_id: contact.id } })).id;
    waitIds.other = (await prisma.wait.create({ data: { ...base, title: 'Review by the other admin', owner_user_id: otherAdminId } })).id;
    waitIds.mine = (await prisma.wait.create({ data: { ...base, title: 'Held by Mike himself', owner_user_id: adminId } })).id;
  });

  afterAll(async () => {
    await prisma.wait.deleteMany({ where: { client_id: clientId } });
    await prisma.task.deleteMany({ where: { id: { in: Object.values(taskIds) } } });
    await prisma.clientContact.deleteMany({ where: { client_id: clientId } });
    await prisma.project.deleteMany({ where: { id: { in: [projA, projB, projEmpty] } } });
    await prisma.client.deleteMany({ where: { id: clientId } });
    await prisma.homeItemState.deleteMany({ where: { user_id: { in: users } } });
    await prisma.homeDay.deleteMany({ where: { user_id: { in: users } } });
    await prisma.user.deleteMany({ where: { id: { in: users } } });
    await prisma.$disconnect();
  });

  it('a tech user, an overlook admin, and an API key are refused', async () => {
    as(techId, 'tech');
    expect((await call(projA)).status).toBe(403);
    as(overlookAdminId, 'admin');
    expect((await call(projA)).status).toBe(403);
    as(adminId, 'admin', 'api_key');
    expect((await call(projA)).status).toBe(403);
  });

  it('shows his items of that project only, and never another user\'s task in it', async () => {
    as(adminId, 'admin');
    const res = await call(projA);
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    const body = await res.json();
    expect(body.project).toMatchObject({ id: projA, name: `Alpha ${tag}`, client: { id: clientId } });
    const keys = body.items.map((x: { item: { key: string } }) => x.item.key).sort();
    // His two tasks, and the wait he holds himself (a wait on him is one of his items).
    expect(keys).toEqual([taskKey(taskIds.mineA1), taskKey(taskIds.mineA2), `wait:${waitIds.mine}`].sort());
    for (const x of body.items) {
      expect(x.item.project.id).toBe(projA);
      expect(x.item.actions.length).toBeGreaterThan(0);
      expect(typeof x.where).toBe('string');
    }
    const text = JSON.stringify(body);
    expect(text).not.toContain('Other person task in Alpha');
    expect(text).not.toContain('Tech task in Alpha');
    expect(text).not.toContain('Mine in Beta');
  });

  it('the other admin sees only their own task in the same project', async () => {
    as(otherAdminId, 'admin');
    const body = await (await call(projA)).json();
    const keys = body.items.map((x: { item: { key: string } }) => x.item.key).sort();
    expect(keys).toEqual([taskKey(taskIds.otherA), `wait:${waitIds.other}`].sort());
    expect(JSON.stringify(body)).not.toContain('Mine in Alpha');
  });

  it('lists the waits others hold, with who, and leaves out his own', async () => {
    as(adminId, 'admin');
    const body = await (await call(projA)).json();
    const byTitle = Object.fromEntries(body.waits.map((w: { title: string; who: string }) => [w.title, w.who]));
    expect(byTitle['Logo files from Andy']).toBe('Andy Test (client)');
    expect(byTitle['Review by the other admin']).toBe('Other 8A');
    expect(byTitle['Held by Mike himself']).toBeUndefined();
    for (const w of body.waits) expect(Number.isNaN(Date.parse(w.since))).toBe(false);
  });

  it('a project with nothing of his gives empty items; an unknown or malformed id is a 404', async () => {
    as(adminId, 'admin');
    const body = await (await call(projEmpty)).json();
    expect(body.items).toEqual([]);
    expect(body.waits).toEqual([]);
    expect((await call(randomUUID())).status).toBe(404);
    expect((await call('nope')).status).toBe(404);
  });

  it('writes nothing: no task, wait, ask, home row, comment, activity or project changed', async () => {
    as(adminId, 'admin');
    const before = await counts();
    for (const id of [projA, projB, projEmpty]) expect((await call(id)).status).toBe(200);
    expect(await counts()).toBe(before);
  });
});

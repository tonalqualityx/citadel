// @vitest-environment node
/**
 * Triage on the home screen (operating model S3) against a real scratch Postgres: the section's grouping, Release, Release plan
 * (queue -> ready, quote -> no-op), Drop, 72 hour Undo, and that anyone but Mike gets nothing and can change nothing.
 */
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import type { Mock } from 'vitest';

vi.mock('@/lib/auth/middleware', async (orig) => ({
  ...(await orig<typeof import('@/lib/auth/middleware')>()),
  requireAuth: vi.fn(),
}));

import { prisma } from '@/lib/db/prisma';
import { requireAuth, type AuthPayload } from '@/lib/auth/middleware';
import { SCRATCH } from '@/lib/engine/__tests__/seed';
import { MIKE_USER_ID } from '@/lib/oracle/projects/gate-constants';
import { runHomeAct, runHomeUndo } from '@/lib/home/act';
import { loadTriage, release, releasePlan, drop, TRIAGE_PASS_PREFIX } from '@/lib/tasks/triage';
import { GET as getHome } from '@/app/api/home/route';

const authMock = requireAuth as Mock;
const NOW = new Date();
const OPTS = { now: NOW, timezone: 'America/New_York', date: NOW.toISOString().slice(0, 10) };

describe.skipIf(!SCRATCH)('triage section (real database)', () => {
  const tag = `trh${Date.now()}`;
  const ids: string[] = [];
  const projectIds: string[] = [];
  let clientId: string;
  let otherAdminId: string;
  let queueProject: string;
  let quoteProject: string;
  let liveProject: string;
  const pass = `${TRIAGE_PASS_PREFIX}${tag}`;

  const status = async (id: string) => (await prisma.task.findUniqueOrThrow({ where: { id } })).status;
  const mk = async (title: string, project: string | null, extra: Record<string, unknown> = {}) => {
    const t = await prisma.task.create({ data: { title: `${tag} ${title}`, status: 'triage', project_id: project, ...extra } as never });
    ids.push(t.id);
    return t.id;
  };
  const mkProject = async (name: string, st: 'quote' | 'queue' | 'ready') => {
    const p = await prisma.project.create({ data: { name: `${tag} ${name}`, status: st, client_id: clientId } });
    projectIds.push(p.id);
    return p.id;
  };
  const mine = async () => (await loadTriage(prisma, MIKE_USER_ID))?.groups.filter((g) => g.label.startsWith(tag) || g.label.includes(tag)) ?? [];

  beforeAll(async () => {
    await prisma.user.upsert({ where: { id: MIKE_USER_ID }, update: {}, create: { id: MIKE_USER_ID, email: `mike-${tag}@example.test`, password_hash: 'x', name: 'Mike', role: 'admin' } });
    await prisma.userPreference.upsert({ where: { user_id: MIKE_USER_ID }, update: { home_view: 'home' }, create: { user_id: MIKE_USER_ID, home_view: 'home' } });
    otherAdminId = (await prisma.user.create({ data: { email: `adm-${tag}@example.test`, password_hash: 'x', name: 'Other', role: 'admin' } })).id;
    await prisma.userPreference.create({ data: { user_id: otherAdminId, home_view: 'home' } });
    clientId = (await prisma.client.create({ data: { name: `${tag} Co`, type: 'direct', status: 'active' } })).id;
    queueProject = await mkProject('Queue job', 'queue');
    quoteProject = await mkProject('Quote job', 'quote');
    liveProject = await mkProject('Live job', 'ready');
  });
  afterAll(async () => {
    await prisma.homeAction.deleteMany({ where: { user_id: { in: [MIKE_USER_ID, otherAdminId] }, action: { startsWith: 'triage_' } } });
    await prisma.activityLog.deleteMany({ where: { entity_id: { in: ids } } });
    await prisma.task.deleteMany({ where: { id: { in: ids } } });
    await prisma.project.deleteMany({ where: { id: { in: projectIds } } });
    await prisma.client.deleteMany({ where: { id: clientId } });
    await prisma.userPreference.deleteMany({ where: { user_id: otherAdminId } });
    await prisma.user.deleteMany({ where: { id: otherAdminId } });
    await prisma.$disconnect();
  });

  it('groups by project, shows the count and the first three titles, and lists every task', async () => {
    const live = await Promise.all([1, 2, 3, 4, 5].map((n) => mk(`live ${n}`, liveProject)));
    const t = await loadTriage(prisma, MIKE_USER_ID);
    expect(t).not.toBeNull();
    const g = (await mine()).find((x) => x.project_id === liveProject)!;
    expect(g.kind).toBe('project');
    expect(g.count).toBe(5);
    expect(g.titles).toHaveLength(3);
    expect(g.tasks.map((x) => x.task_id).sort()).toEqual([...live].sort());
    expect(g.still_quote).toBe(false);
    await drop(prisma, MIKE_USER_ID, live, NOW);
  });

  it('a triage-pass tag groups across projects and outranks the project', async () => {
    const a = await mk('pass a', liveProject, { tags: [pass] });
    const b = await mk('pass b', queueProject, { tags: [pass] });
    const c = await mk('pass c', null, { tags: [pass] });
    const g = (await mine()).find((x) => x.key === `pass:${pass}`)!;
    expect(g.kind).toBe('pass');
    expect(g.count).toBe(3);
    expect(g.tasks.map((x) => x.task_id).sort()).toEqual([a, b, c].sort());
    expect((await mine()).some((x) => x.project_id === liveProject && x.tasks.some((t) => t.task_id === a))).toBe(false);
    await drop(prisma, MIKE_USER_ID, [a, b, c], NOW);
  });

  it('Release moves tasks to not_started, writes a Handled line, and Undo puts them back in triage', async () => {
    const a = await mk('rel a', liveProject);
    const b = await mk('rel b', liveProject);
    const res = await runHomeAct(prisma, MIKE_USER_ID, { action: 'triage_release', task_ids: [a, b] }, OPTS);
    expect(res.undo_until).not.toBeNull();
    expect(new Date(res.undo_until!).getTime() - NOW.getTime()).toBe(72 * 3600 * 1000);
    expect(await status(a)).toBe('not_started');
    expect(await status(b)).toBe('not_started');
    const row = await prisma.homeAction.findUniqueOrThrow({ where: { id: res.action_id } });
    expect(row.source).toBe('keeper');
    expect((row.after as { line: string }).line).toMatch(/Released 2 ideas/);
    await runHomeUndo(prisma, MIKE_USER_ID, res.action_id, new Date(NOW.getTime() + 3600_000));
    expect(await status(a)).toBe('triage');
    expect(await status(b)).toBe('triage');
    await drop(prisma, MIKE_USER_ID, [a, b], NOW);
  });

  it('Undo leaves a task that changed since, and is refused after 72 hours', async () => {
    const a = await mk('chg a', liveProject);
    const b = await mk('chg b', liveProject);
    const res = await release(prisma, MIKE_USER_ID, [a, b], NOW);
    await prisma.task.update({ where: { id: a }, data: { status: 'in_progress' } });
    await runHomeUndo(prisma, MIKE_USER_ID, res.action_id, NOW);
    expect(await status(a)).toBe('in_progress');
    expect(await status(b)).toBe('triage');
    const res2 = await release(prisma, MIKE_USER_ID, [b], NOW);
    await expect(runHomeUndo(prisma, MIKE_USER_ID, res2.action_id, new Date(NOW.getTime() + 73 * 3600_000))).rejects.toMatchObject({ code: 'undo_expired' });
    expect(await status(b)).toBe('not_started');
    await drop(prisma, MIKE_USER_ID, [b], NOW).catch(() => {});
  });

  it('Release plan on a queue project releases every triage task there and makes the project ready; Undo reverses both', async () => {
    const a = await mk('plan a', queueProject);
    const b = await mk('plan b', queueProject);
    await prisma.task.update({ where: { id: b }, data: { blocked_by: { connect: { id: a } } } });
    const res = await runHomeAct(prisma, MIKE_USER_ID, { action: 'triage_release_plan', group_key: `project:${queueProject}` }, OPTS);
    expect(await status(a)).toBe('not_started');
    expect(await status(b)).toBe('not_started');
    // The dependency stays, so the existing gate keeps b behind a.
    expect((await prisma.task.findUniqueOrThrow({ where: { id: b }, include: { blocked_by: true } })).blocked_by.map((x) => x.id)).toEqual([a]);
    expect((await prisma.project.findUniqueOrThrow({ where: { id: queueProject } })).status).toBe('ready');
    expect((await prisma.homeAction.findUniqueOrThrow({ where: { id: res.action_id } })).action).toBe('triage_release_plan');
    await runHomeUndo(prisma, MIKE_USER_ID, res.action_id, NOW);
    expect(await status(a)).toBe('triage');
    expect(await status(b)).toBe('triage');
    expect((await prisma.project.findUniqueOrThrow({ where: { id: queueProject } })).status).toBe('queue');
    await drop(prisma, MIKE_USER_ID, [a, b], NOW);
  });

  it('Undo keeps the project ready when one of its tasks has moved on', async () => {
    const a = await mk('keep a', queueProject);
    const b = await mk('keep b', queueProject);
    const res = await releasePlan(prisma, MIKE_USER_ID, `project:${queueProject}`, NOW);
    await prisma.task.update({ where: { id: a }, data: { status: 'in_progress' } });
    await runHomeUndo(prisma, MIKE_USER_ID, res.action_id, NOW);
    expect(await status(a)).toBe('in_progress');
    expect(await status(b)).toBe('triage');
    expect((await prisma.project.findUniqueOrThrow({ where: { id: queueProject } })).status).toBe('ready');
    await prisma.project.update({ where: { id: queueProject }, data: { status: 'queue' } });
    await drop(prisma, MIKE_USER_ID, [b], NOW);
  });

  it('Release plan on a quote project says it is still a quote and changes nothing', async () => {
    const a = await mk('quote a', quoteProject);
    const before = await prisma.homeAction.count({ where: { user_id: MIKE_USER_ID, action: 'triage_release_plan' } });
    await expect(runHomeAct(prisma, MIKE_USER_ID, { action: 'triage_release_plan', group_key: `project:${quoteProject}` }, OPTS)).rejects.toMatchObject({
      code: 'still_a_quote',
      message: 'That project is still a quote. Nothing was released.',
    });
    expect(await status(a)).toBe('triage');
    expect((await prisma.project.findUniqueOrThrow({ where: { id: quoteProject } })).status).toBe('quote');
    expect(await prisma.homeAction.count({ where: { user_id: MIKE_USER_ID, action: 'triage_release_plan' } })).toBe(before);
    // One task on a quote project is held the same way.
    await expect(release(prisma, MIKE_USER_ID, [a], NOW)).rejects.toMatchObject({ code: 'still_a_quote' });
    expect((await mine()).find((g) => g.project_id === quoteProject)?.still_quote).toBe(true);
    await drop(prisma, MIKE_USER_ID, [a], NOW);
  });

  it('a mixed pass group releases the live ones, leaves the quote ones, and readies the queue project', async () => {
    const live = await mk('mix live', liveProject, { tags: [`${pass}:mix`] });
    const quote = await mk('mix quote', quoteProject, { tags: [`${pass}:mix`] });
    const queued = await mk('mix queue', queueProject, { tags: [`${pass}:mix`] });
    await releasePlan(prisma, MIKE_USER_ID, `pass:${pass}:mix`, NOW);
    expect(await status(live)).toBe('not_started');
    expect(await status(queued)).toBe('not_started');
    expect(await status(quote)).toBe('triage');
    expect((await prisma.project.findUniqueOrThrow({ where: { id: queueProject } })).status).toBe('ready');
    await prisma.project.update({ where: { id: queueProject }, data: { status: 'queue' } });
    await drop(prisma, MIKE_USER_ID, [quote], NOW);
  });

  it('Drop moves tasks to abandoned and Undo returns them to triage', async () => {
    const a = await mk('drop a', liveProject);
    const res = await runHomeAct(prisma, MIKE_USER_ID, { action: 'triage_drop', task_ids: [a] }, OPTS);
    expect(await status(a)).toBe('abandoned');
    expect(((await prisma.homeAction.findUniqueOrThrow({ where: { id: res.action_id } })).after as { line: string }).line).toBe('Dropped 1 idea from Triage.');
    await runHomeUndo(prisma, MIKE_USER_ID, res.action_id, NOW);
    expect(await status(a)).toBe('triage');
    await drop(prisma, MIKE_USER_ID, [a], NOW);
  });

  it('only releases tasks that are still in triage', async () => {
    const a = await mk('moved', liveProject);
    await prisma.task.update({ where: { id: a }, data: { status: 'not_started' } });
    await expect(release(prisma, MIKE_USER_ID, [a], NOW)).rejects.toMatchObject({ code: 'changed_since' });
  });

  describe('anyone but Mike', () => {
    it('loads nothing and can change nothing', async () => {
      const a = await mk('hands off', liveProject);
      expect(await loadTriage(prisma, otherAdminId)).toBeNull();
      await expect(release(prisma, otherAdminId, [a], NOW)).rejects.toMatchObject({ statusCode: 404 });
      await expect(drop(prisma, otherAdminId, [a], NOW)).rejects.toMatchObject({ statusCode: 404 });
      await expect(releasePlan(prisma, otherAdminId, `project:${liveProject}`, NOW)).rejects.toMatchObject({ statusCode: 404 });
      await expect(runHomeAct(prisma, otherAdminId, { action: 'triage_release', task_ids: [a] }, OPTS)).rejects.toMatchObject({ statusCode: 404 });
      expect(await status(a)).toBe('triage');
      await drop(prisma, MIKE_USER_ID, [a], NOW);
    });

    it('GET /api/home carries the section for Mike only, and triage tasks appear nowhere else as work', async () => {
      const a = await mk('visible only in triage', liveProject, { assignee_id: MIKE_USER_ID });
      authMock.mockResolvedValue({ userId: MIKE_USER_ID, role: 'admin', email: 'm@test', via: 'session' } satisfies Partial<AuthPayload>);
      const mikeBody = await (await getHome()).json();
      expect(mikeBody.triage.groups.some((g: { tasks: { task_id: string }[] }) => g.tasks.some((t) => t.task_id === a))).toBe(true);
      const { triage: _t, ...rest } = mikeBody;
      void _t;
      expect(JSON.stringify(rest)).not.toContain(a);

      authMock.mockResolvedValue({ userId: otherAdminId, role: 'admin', email: 'o@test', via: 'session' } satisfies Partial<AuthPayload>);
      const otherBody = await (await getHome()).json();
      expect('triage' in otherBody).toBe(false);
      expect(JSON.stringify(otherBody)).not.toContain(a);
      await drop(prisma, MIKE_USER_ID, [a], NOW);
    });
  });
});

// @vitest-environment node
/**
 * Slice 7b against a real Postgres: bounded learned weights, the Monday "Learned:" lines, Undo, Put back, the switch, and
 * the guards, through the learn run, the whole home screen and the real routes. Skips unless DATABASE_URL names the
 * scratch Postgres on localhost:55433. It makes its own users, clients, tasks and taps and removes only those. Run on its
 * own clean database:
 *   DATABASE_URL=postgresql://citadel:citadel@localhost:55433/home_s7b_it npx vitest run lib/home/__tests__/slice7b.integration.test.ts
 *
 * Auth is the only mock. The loaders, the selection, the run, the stores and the routes are real.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { randomUUID } from 'crypto';
import { NextRequest } from 'next/server';

const auth = vi.hoisted(() => ({ who: null as null | { userId: string; role: string; email: string; via: string } }));
vi.mock('@/lib/auth/middleware', () => ({
  requireAuth: vi.fn(async () => auth.who),
}));

import { prisma } from '@/lib/db/prisma';
import { GET as getHome } from '@/app/api/home/route';
import { POST as postUndo } from '@/app/api/home/undo/route';
import { GET as getLearned, POST as postLearned } from '@/app/api/home/learned/route';
import { runLearn } from '../learn/run';
import { taskKey } from '../item-key';

const SCRATCH = /localhost:55433/.test(process.env.DATABASE_URL ?? '');
/** Mondays in his zone, 10:00 Eastern (EST). */
const MON_1 = new Date('2026-11-30T15:00:00Z');
const MON_2 = new Date('2026-12-07T15:00:00Z');
const MON_3 = new Date('2026-12-14T15:00:00Z');
const TUE = new Date('2026-12-01T15:00:00Z');
const DAY = 86_400_000;

describe.skipIf(!SCRATCH)('Slice 7b: learned weights (real database)', () => {
  const tag = `s7b-${Date.now()}`;
  const adminId = randomUUID();
  const techId = randomUUID();
  const overlookAdminId = randomUUID();
  const ids = [adminId, techId, overlookAdminId];
  const clientX = randomUUID();
  const clientY = randomUUID();
  const xTasks: string[] = [];
  let secTask = '';
  const taskIds: string[] = [];

  const as = (userId: string, role: string, via = 'session') => {
    auth.who = { userId, role, email: `${userId}@example.test`, via };
  };
  const post = (url: string, body: unknown, handler: (r: NextRequest) => Promise<Response>) =>
    handler(new NextRequest(`http://localhost:3000${url}`, { method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } }));

  /** Rows no learn step may touch, as one string. */
  async function shared() {
    const [tasks, asks, waits, projects, arcs, decisions] = await Promise.all([
      prisma.task.findMany({ orderBy: { id: 'asc' }, select: { id: true, status: true, tags: true, due_date: true, updated_at: true } }),
      prisma.emailAsk.findMany({ orderBy: { id: 'asc' }, select: { id: true, state: true, updated_at: true } }),
      prisma.wait.findMany({ orderBy: { id: 'asc' }, select: { id: true, state: true, updated_at: true } }),
      prisma.project.findMany({ orderBy: { id: 'asc' }, select: { id: true, status: true, updated_at: true } }),
      prisma.arc.findMany({ orderBy: { id: 'asc' }, select: { id: true, closed_at: true, updated_at: true } }),
      prisma.decision.findMany({ orderBy: { id: 'asc' }, select: { id: true, status: true, updated_at: true } }),
    ]);
    return JSON.stringify({ tasks, asks, waits, projects, arcs, decisions });
  }
  const home = async () => {
    as(adminId, 'admin');
    const res = await getHome();
    return { status: res.status, body: await res.json() };
  };
  const nextTitles = (body: { sections: { next: { title: string }[] } }) => body.sections.next.map((i) => i.title);
  const weightRows = () => prisma.homeScoreWeight.findMany({ where: { user_id: adminId }, orderBy: { evidence_key: 'asc' } });

  beforeAll(async () => {
    await prisma.user.createMany({
      data: [
        { id: adminId, email: `admin-${tag}@example.test`, password_hash: 'x', name: 'Admin 7b', role: 'admin' },
        { id: techId, email: `tech-${tag}@example.test`, password_hash: 'x', name: 'Tech 7b', role: 'tech' },
        { id: overlookAdminId, email: `ovl-${tag}@example.test`, password_hash: 'x', name: 'Overlook 7b', role: 'admin' },
      ],
    });
    await prisma.userPreference.createMany({
      data: [
        { user_id: adminId, home_view: 'home', timezone: 'America/New_York' },
        { user_id: techId, home_view: 'overlook', timezone: 'America/New_York' },
        { user_id: overlookAdminId, home_view: 'overlook', timezone: 'America/New_York' },
      ],
    });
    await prisma.client.createMany({
      data: [
        { id: clientX, name: `Nerd Herd ${tag}`, status: 'active' },
        { id: clientY, name: `Other Co ${tag}`, status: 'active' },
      ],
    });
    // Four class-1 tasks someone waits on, all reading urgency 50 on Monday November 30: Y's is the oldest, so Y leads Next.
    const mk = (title: string, client: string, created: string) =>
      prisma.task.create({
        data: { title, status: 'not_started', tags: [], assignee_id: adminId, created_by_id: null, client_id: client, promised_to: 'The client', estimated_minutes: 10, created_at: new Date(created) },
      });
    const y = await mk(`Y task ${tag}`, clientY, '2026-11-24T14:00:00Z');
    for (const [i, at] of ['15:00', '16:00', '17:00'].entries()) {
      const t = await mk(`X task ${i + 1} ${tag}`, clientX, `2026-11-24T${at}:00Z`);
      xTasks.push(t.id);
    }
    // An emergency on client X: a security task. It must stay first in Needs you now whatever is learned.
    const sec = await prisma.task.create({
      data: { title: `X security ${tag}`, status: 'in_progress', tags: ['security'], assignee_id: adminId, created_by_id: null, client_id: clientX, estimated_minutes: 10, created_at: new Date('2026-11-26T15:00:00Z') },
    });
    secTask = sec.id;
    taskIds.push(y.id, ...xTasks, sec.id);
    // 20 days of taps: the first ever on November 10, then "This matters more" on three of X's tasks on three different days.
    await prisma.homeAction.createMany({
      data: [
        { user_id: adminId, item_key: taskKey(randomUUID()), action: 'record', source: 'home', after: { recorded: { did: 'open_task', undo: false } }, created_at: new Date('2026-11-10T15:00:00Z') },
        ...xTasks.map((id, i) => ({ user_id: adminId, item_key: taskKey(id), action: 'matters_more', source: 'home', after: {}, created_at: new Date(`2026-11-${17 + i}T15:00:00Z`) })),
      ],
    });
    // The routes read the clock themselves: pin the date (only Date) to the first Monday so the screen is the one he would see.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(MON_1);
  });

  afterAll(async () => {
    vi.useRealTimers();
    await prisma.homeScoreWeight.deleteMany({ where: { user_id: { in: ids } } });
    await prisma.homeKeeperSettings.deleteMany({ where: { user_id: { in: ids } } });
    await prisma.homeMeasure.deleteMany({ where: { user_id: { in: ids } } });
    await prisma.homeKeeperRun.deleteMany({ where: { user_id: { in: ids } } });
    await prisma.homeAction.deleteMany({ where: { user_id: { in: ids } } });
    await prisma.homeItemState.deleteMany({ where: { user_id: { in: ids } } });
    await prisma.homeDay.deleteMany({ where: { user_id: { in: ids } } });
    await prisma.task.deleteMany({ where: { id: { in: taskIds } } });
    await prisma.client.deleteMany({ where: { id: { in: [clientX, clientY] } } });
    await prisma.user.deleteMany({ where: { id: { in: ids } } });
    await prisma.$disconnect();
  });

  let before = '';
  let baselineNext: string[] = [];

  it('before any run: no weights, Y (the oldest) leads Next, the emergency is first in Needs you now', async () => {
    before = await shared();
    const { status, body } = await home();
    expect(status).toBe(200);
    baselineNext = nextTitles(body);
    expect(baselineNext[0]).toBe(`Y task ${tag}`);
    expect(baselineNext).not.toContain(`X task 3 ${tag}`);
    expect(body.sections.needs_you_now[0].key).toBe(taskKey(secTask));
    expect(await weightRows()).toEqual([]);
  });

  it('a dry run on Monday lists the Learned lines and writes nothing', async () => {
    const res = await runLearn(prisma, adminId, MON_1, { dryRun: true });
    const learned = res.lines!.filter((l) => l.action === 'keeper_learned');
    expect(learned.length).toBeGreaterThanOrEqual(1);
    expect(learned.map((l) => l.line)).toContain(`Learned: Nerd Herd ${tag} work now comes up a little sooner.`);
    expect(learned.length).toBeLessThanOrEqual(3);
    expect(await weightRows()).toEqual([]);
    expect(await prisma.homeAction.count({ where: { user_id: adminId, action: 'keeper_learned' } })).toBe(0);
    expect(await prisma.homeKeeperRun.count({ where: { user_id: adminId } })).toBe(0);
  });

  it('a Tuesday run never shifts', async () => {
    const res = await runLearn(prisma, adminId, TUE, { dryRun: false });
    expect(res.monday).toBe(false);
    expect(res.learned ?? []).toEqual([]);
    expect(await weightRows()).toEqual([]);
  });

  it('a Monday run moves the weights by exactly one step and writes one Learned line each, with Undo for 7 days', async () => {
    const res = await runLearn(prisma, adminId, MON_1, { dryRun: false });
    const rows = await weightRows();
    expect(rows.map((r) => [r.evidence_key, r.weight_pct])).toEqual([
      [`client:${clientX}`, 105],
      ['type:task', 105],
    ]);
    expect(rows.every((r) => r.signals_up === 3 && r.signals_down === 0 && r.held_until === null && r.changed_by_action_id)).toBe(true);
    const lines = await prisma.homeAction.findMany({ where: { user_id: adminId, action: 'keeper_learned' } });
    expect(lines).toHaveLength(2);
    for (const l of lines) {
      expect(l).toMatchObject({ source: 'keeper', item_key: null });
      expect(l.undo_until!.getTime()).toBe(MON_1.getTime() + 7 * DAY);
    }
    expect(res.action_ids.length).toBeGreaterThanOrEqual(2);
  });

  it('on the screen: the lines are under Handled for you with Undo, X leads Next, and the emergency is still first', async () => {
    const { status, body } = await home();
    expect(status).toBe(200);
    const learned = body.sections.handled.filter((h: { text: string }) => h.text.startsWith('Learned:'));
    expect(learned).toHaveLength(2);
    expect(learned.every((l: { undo_action_id: string | null }) => !!l.undo_action_id)).toBe(true);
    expect(learned.map((l: { text: string }) => l.text)).toContain(`Learned: Nerd Herd ${tag} work now comes up a little sooner.`);
    const learnedX = learned.find((l: { text: string }) => l.text.includes('Nerd Herd'));
    expect(learnedX.details).toEqual(['You moved 3 items up and set none aside in the last 4 weeks.', 'This changes order only. It never changes what counts as an emergency or a real date.']);
    // The weight changed the order inside the class: the three X tasks now lead Next, and the older Y task is out of Next.
    const titles = nextTitles(body);
    expect(titles).toEqual([`X task 1 ${tag}`, `X task 2 ${tag}`, `X task 3 ${tag}`]);
    expect(titles).not.toEqual(baselineNext);
    expect(body.sections.next[0].reason).toContain('Comes up a little sooner because you moved');
    expect(body.sections.needs_you_now[0].key).toBe(taskKey(secTask));
    expect(body.sections.needs_you_now[0].reason).not.toContain('Comes up a little');
    // Sentences only: no number from a weight, a score or a class.
    expect(JSON.stringify(body)).not.toMatch(/"(score|urgency|weight|weight_pct|multiplier|consequence_class|importance|evidence_key)"\s*:/);
  });

  it('GET /api/home/learned lists sentences only', async () => {
    as(adminId, 'admin');
    const res = await getLearned();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.on).toBe(true);
    expect(body.items).toHaveLength(2);
    expect(body.items.map((i: { sentence: string }) => i.sentence)).toContain(`Nerd Herd ${tag} work comes up a little sooner, since November 30`);
    expect(JSON.stringify(body)).not.toMatch(/weight|pct|percent|signals|105/i);
  });

  it('Put back sets the weight to 100, holds the key 30 days, and writes its own action with Undo for 24 hours', async () => {
    as(adminId, 'admin');
    const res = await post('/api/home/learned', { action: 'put_back', evidence_key: `client:${clientX}` }, postLearned);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.items).toHaveLength(1);
    const row = (await weightRows()).find((r) => r.evidence_key === `client:${clientX}`)!;
    expect(row.weight_pct).toBe(100);
    expect(row.held_until!.getTime()).toBe(MON_1.getTime() + 30 * DAY);
    const act = await prisma.homeAction.findFirst({ where: { user_id: adminId, action: 'weight_put_back' } });
    expect(act).toMatchObject({ source: 'home' });
    expect(act!.undo_until!.getTime()).toBe(MON_1.getTime() + DAY);
    // A key that is not learned any more is a 404.
    const again = await post('/api/home/learned', { action: 'put_back', evidence_key: `client:${clientX}` }, postLearned);
    expect(again.status).toBe(404);
  });

  it('Undo of a Learned line (the existing undo route) puts the weight back to 100 and holds it 30 days; compare and set', async () => {
    const line = await prisma.homeAction.findFirst({ where: { user_id: adminId, action: 'keeper_learned', after: { path: ['weights', '0', 'evidence_key'], equals: 'type:task' } } });
    expect(line).not.toBeNull();
    as(adminId, 'admin');
    const res = await post('/api/home/undo', { action_id: line!.id }, postUndo);
    expect(res.status).toBe(200);
    const row = (await weightRows()).find((r) => r.evidence_key === 'type:task')!;
    expect(row.weight_pct).toBe(100);
    expect(row.held_until!.getTime()).toBe(MON_1.getTime() + 30 * DAY);
    // A second undo is refused.
    expect((await post('/api/home/undo', { action_id: line!.id }, postUndo)).status).not.toBe(200);
    // The undone line leaves Handled for you.
    const { body } = await home();
    expect(body.sections.handled.filter((h: { id: string }) => h.id === line!.id)).toEqual([]);
  });

  it('the next Monday makes no shift for a held key, even with the same taps in the window', async () => {
    vi.setSystemTime(MON_2);
    const res = await runLearn(prisma, adminId, MON_2, { dryRun: false });
    expect(res.monday).toBe(true);
    expect(res.learned ?? []).toEqual([]);
    expect((await weightRows()).every((r) => r.weight_pct === 100)).toBe(true);
    expect(await prisma.homeAction.count({ where: { user_id: adminId, action: 'keeper_learned' } })).toBe(2);
  });

  it('with Learn from my taps off nothing shifts; the switch is a session route', async () => {
    as(adminId, 'admin');
    const off = await post('/api/home/learned', { action: 'learning', on: false }, postLearned);
    expect(off.status).toBe(200);
    expect((await off.json()).on).toBe(false);
    expect((await prisma.homeKeeperSettings.findUnique({ where: { user_id: adminId } }))!.learn_weights).toBe(false);
    // Free the holds so only the switch is in the way.
    await prisma.homeScoreWeight.updateMany({ where: { user_id: adminId }, data: { held_until: null } });
    vi.setSystemTime(MON_3);
    const res = await runLearn(prisma, adminId, MON_3, { dryRun: false });
    expect(res.monday).toBe(true);
    expect(res.learned ?? []).toEqual([]);
    expect((await weightRows()).every((r) => r.weight_pct === 100)).toBe(true);
    const on = await post('/api/home/learned', { action: 'learning', on: true }, postLearned);
    expect((await on.json()).on).toBe(true);
  });

  it('an API key gets 403 on both verbs, and nothing changes', async () => {
    const rowsBefore = JSON.stringify(await weightRows());
    as(adminId, 'admin', 'api_key');
    expect((await getLearned()).status).toBe(403);
    expect((await post('/api/home/learned', { action: 'learning', on: false }, postLearned)).status).toBe(403);
    expect((await post('/api/home/learned', { action: 'put_back', evidence_key: 'type:task' }, postLearned)).status).toBe(403);
    expect(JSON.stringify(await weightRows())).toBe(rowsBefore);
    expect((await prisma.homeKeeperSettings.findUnique({ where: { user_id: adminId } }))!.learn_weights).toBe(true);
  });

  it('a tech user and an overlook admin have no rows and get a 403 from the home and learned routes', async () => {
    for (const [id, role] of [[techId, 'tech'], [overlookAdminId, 'admin']] as const) {
      expect(await runLearn(prisma, id, MON_1, { dryRun: false })).toEqual({ dry_run: false, skipped: 'home_off', action_ids: [] });
      expect(await prisma.homeScoreWeight.count({ where: { user_id: id } })).toBe(0);
      expect(await prisma.homeAction.count({ where: { user_id: id } })).toBe(0);
      as(id, role);
      expect((await getHome()).status).toBe(403);
      expect((await getLearned()).status).toBe(403);
      expect((await post('/api/home/learned', { action: 'learning', on: false }, postLearned)).status).toBe(403);
      expect(await prisma.homeKeeperSettings.count({ where: { user_id: id } })).toBe(0);
    }
  });

  it('no Task, Arc, EmailAsk, Wait, Project or Decision row changed', async () => {
    expect(await shared()).toBe(before);
  });
});

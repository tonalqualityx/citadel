// @vitest-environment node
/**
 * Slice 7a against a real Postgres: the learn step (the weekly measures line and the approval-speed guard) through the
 * route's own run function and the whole home screen. Skips unless DATABASE_URL names the scratch Postgres on
 * localhost:55433. It makes its own users, client, project, tasks and logs and removes only those. Run on its own clean
 * database:
 *   DATABASE_URL=postgresql://citadel:citadel@localhost:55433/home_s7a_it npx vitest run lib/home/__tests__/slice7a.integration.test.ts
 *
 * Auth is the only mock (for GET /api/home). The loaders, the selection, the run and the measures are real.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { randomUUID } from 'crypto';

const auth = vi.hoisted(() => ({ who: null as null | { userId: string; role: string; email: string; via: string } }));
vi.mock('@/lib/auth/middleware', () => ({
  requireAuth: vi.fn(async () => auth.who),
}));

import { prisma } from '@/lib/db/prisma';
import { GET as getHome } from '@/app/api/home/route';
import { runLearn } from '../learn/run';
import { taskKey } from '../item-key';

const SCRATCH = /localhost:55433/.test(process.env.DATABASE_URL ?? '');
/** Mondays in his zone, 10:00 Eastern (EST, UTC-5). The week before the first is Monday 2026-11-16 to Sunday 2026-11-22. */
const MON_1 = new Date('2026-11-23T15:00:00Z');
const TUE = new Date('2026-11-24T15:00:00Z');
const WEEK_DAYS = ['2026-11-16', '2026-11-17', '2026-11-18', '2026-11-19', '2026-11-20'];

describe.skipIf(!SCRATCH)('Slice 7a: the weekly measures line and the guard (real database)', () => {
  const tag = `s7a-${Date.now()}`;
  const adminId = randomUUID();
  const techId = randomUUID();
  const overlookAdminId = randomUUID();
  const youngAdminId = randomUUID();
  const ids = [adminId, techId, overlookAdminId, youngAdminId];
  const clientId = randomUUID();
  const projectId = randomUUID();
  const taskIds: string[] = [];
  const askIds: string[] = [];
  let securityTaskId = '';
  let changedTaskId = '';

  const as = (userId: string, role: string) => {
    auth.who = { userId, role, email: `${userId}@example.test`, via: 'session' };
  };

  /** Rows no learn run may touch, as one string. */
  async function shared() {
    const [tasks, asks, waits, projects] = await Promise.all([
      prisma.task.findMany({ orderBy: { id: 'asc' }, select: { id: true, status: true, tags: true, updated_at: true } }),
      prisma.emailAsk.findMany({ orderBy: { id: 'asc' }, select: { id: true, state: true, updated_at: true } }),
      prisma.wait.findMany({ orderBy: { id: 'asc' }, select: { id: true, state: true, updated_at: true } }),
      prisma.project.findMany({ orderBy: { id: 'asc' }, select: { id: true, status: true, updated_at: true } }),
    ]);
    return JSON.stringify({ tasks, asks, waits, projects, counts: [tasks.length, asks.length, waits.length, projects.length] });
  }
  const homeBody = async () => {
    as(adminId, 'admin');
    const res = await getHome();
    return { status: res.status, body: await res.json() };
  };

  beforeAll(async () => {
    await prisma.user.createMany({
      data: [
        { id: adminId, email: `admin-${tag}@example.test`, password_hash: 'x', name: 'Admin 7a', role: 'admin' },
        { id: techId, email: `tech-${tag}@example.test`, password_hash: 'x', name: 'Tech 7a', role: 'tech' },
        { id: overlookAdminId, email: `ovl-${tag}@example.test`, password_hash: 'x', name: 'Overlook 7a', role: 'admin' },
        { id: youngAdminId, email: `young-${tag}@example.test`, password_hash: 'x', name: 'Young 7a', role: 'admin' },
      ],
    });
    await prisma.userPreference.createMany({
      data: [
        { user_id: adminId, home_view: 'home', timezone: 'America/New_York' },
        { user_id: techId, home_view: 'overlook', timezone: 'America/New_York' },
        { user_id: overlookAdminId, home_view: 'overlook', timezone: 'America/New_York' },
        { user_id: youngAdminId, home_view: 'home', timezone: 'America/New_York' },
      ],
    });
    await prisma.client.create({ data: { id: clientId, name: `Client ${tag}`, status: 'active' } });
    await prisma.project.create({ data: { id: projectId, name: `Project ${tag}`, client_id: clientId, status: 'in_progress' } });

    // An emergency created Tuesday 09:00 ET, his first tap an hour later; and a task whose status he changed from home.
    const sec = await prisma.task.create({
      data: { title: 'Rotate keys', status: 'in_progress', tags: ['security'], assignee_id: adminId, created_by_id: adminId, client_id: clientId, estimated_minutes: 10, created_at: new Date('2026-11-17T14:00:00Z') },
    });
    const chg = await prisma.task.create({
      data: { title: 'Send notes', status: 'done', completed_at: new Date('2026-11-18T15:00:00Z'), tags: [], assignee_id: adminId, created_by_id: adminId, client_id: clientId, estimated_minutes: 10, created_at: new Date('2026-11-12T14:00:00Z') },
    });
    securityTaskId = sec.id;
    changedTaskId = chg.id;
    taskIds.push(sec.id, chg.id);
    await prisma.activityLog.create({ data: { user_id: adminId, action: 'status_changed', entity_type: 'task', entity_id: chg.id, entity_name: chg.title, changes: { status: { from: 'in_progress', to: 'done' } }, created_at: new Date('2026-11-18T15:00:00Z') } });
    // His taps: the first ever on Tuesday 11-10 (so the log measures start there), one an hour after the emergency, one with the status change.
    await prisma.homeAction.createMany({
      data: [
        { user_id: adminId, item_key: taskKey(randomUUID()), action: 'record', source: 'home', after: { recorded: { did: 'open_task', undo: false } }, created_at: new Date('2026-11-10T15:00:00Z') },
        { user_id: adminId, item_key: taskKey(sec.id), action: 'record', source: 'home', after: { recorded: { did: 'open_task', undo: false } }, created_at: new Date('2026-11-17T15:00:00Z') },
        { user_id: adminId, item_key: taskKey(chg.id), action: 'record', source: 'home', after: { recorded: { did: 'done', undo: false } }, created_at: new Date('2026-11-18T15:00:30Z') },
      ],
    });
    // Five nightly snapshots for the week before the first Monday, and the Friday before it.
    await prisma.homeMeasure.createMany({
      data: [
        { user_id: adminId, date: new Date('2026-11-13T00:00:00Z'), kind: 'daily', value: { date: '2026-11-13', open_items: 180, past_day: 5, owed: [] } },
        ...WEEK_DAYS.map((d, i) => ({
          user_id: adminId,
          date: new Date(`${d}T00:00:00Z`),
          kind: 'daily',
          value: { date: d, open_items: 184 + i, past_day: 6, owed: i === 0 ? [{ key: 'thread:a:b', label: 'Re: quote', age_bd: 5 }] : [] },
        })),
      ],
    });
  });

  afterAll(async () => {
    await prisma.homeMeasure.deleteMany({ where: { user_id: { in: ids } } });
    await prisma.homeKeeperRun.deleteMany({ where: { user_id: { in: ids } } });
    await prisma.homeAction.deleteMany({ where: { user_id: { in: ids } } });
    await prisma.homeItemState.deleteMany({ where: { user_id: { in: ids } } });
    await prisma.homeDay.deleteMany({ where: { user_id: { in: ids } } });
    await prisma.activityLog.deleteMany({ where: { user_id: { in: ids } } });
    await prisma.task.deleteMany({ where: { id: { in: taskIds } } });
    await prisma.emailAsk.deleteMany({ where: { id: { in: askIds } } });
    await prisma.project.deleteMany({ where: { id: projectId } });
    await prisma.client.deleteMany({ where: { id: clientId } });
    await prisma.user.deleteMany({ where: { id: { in: ids } } });
    await prisma.$disconnect();
  });

  let before = '';

  it('a dry run on Monday returns the line and writes nothing', async () => {
    before = await shared();
    const actions = await prisma.homeAction.count({ where: { user_id: adminId } });
    const res = await runLearn(prisma, adminId, MON_1, { dryRun: true });
    expect(res.monday).toBe(true);
    expect(res.lines).toHaveLength(1);
    expect(res.lines![0].action).toBe('keeper_measures');
    expect(res.lines![0].line).toBe('Last week: 1 emergency, seen within 4 working hours. 1 reply waited over 3 business days. 1 of 1 task changes were made here. 188 open items, 6 past their day.');
    expect(await prisma.homeMeasure.count({ where: { user_id: adminId, kind: 'week' } })).toBe(0);
    expect(await prisma.homeKeeperRun.count({ where: { user_id: adminId } })).toBe(0);
    expect(await prisma.homeAction.count({ where: { user_id: adminId } })).toBe(actions);
  });

  it('a Monday run writes the week row, the daily row and exactly one keeper line with no Undo', async () => {
    const res = await runLearn(prisma, adminId, MON_1, { dryRun: false });
    expect(res.already_ran).toBeUndefined();
    expect(res.action_ids).toHaveLength(1);
    const week = await prisma.homeMeasure.findMany({ where: { user_id: adminId, kind: 'week' } });
    expect(week).toHaveLength(1);
    expect(week[0].date.toISOString().slice(0, 10)).toBe('2026-11-16');
    expect(await prisma.homeMeasure.count({ where: { user_id: adminId, kind: 'daily', date: new Date('2026-11-23T00:00:00Z') } })).toBe(1);
    const lines = await prisma.homeAction.findMany({ where: { user_id: adminId, action: { in: ['keeper_measures', 'keeper_guard'] } } });
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ action: 'keeper_measures', source: 'keeper', undo_until: null, item_key: null });
    const run = await prisma.homeKeeperRun.findMany({ where: { user_id: adminId, kind: 'learn' } });
    expect(run).toHaveLength(1);
    expect(run[0].finished_at).not.toBeNull();
  });

  it('the line appears under Handled for you on GET /api/home, with no Undo and no scoring field', async () => {
    const { status, body } = await homeBody();
    expect(status).toBe(200);
    const line = body.sections.handled.find((h: { text: string }) => h.text.startsWith('Last week:'));
    expect(line).toBeDefined();
    expect(line.undo_action_id).toBeNull();
    expect(line.details.length).toBeGreaterThan(0);
    expect(JSON.stringify(body)).not.toMatch(/"(score|urgency|weight|weight_pct|consequence_class|importance)"\s*:/);
    expect(JSON.stringify(line)).not.toMatch(/[–—]|priorit|overdue/i);
  });

  it('a second POST the same day answers already_ran and writes nothing more', async () => {
    const res = await runLearn(prisma, adminId, MON_1, { dryRun: false });
    expect(res).toEqual({ dry_run: false, already_ran: true, action_ids: [] });
    expect(await prisma.homeAction.count({ where: { user_id: adminId, action: 'keeper_measures' } })).toBe(1);
  });

  it('a Tuesday run writes the daily snapshot only: no line, no week row', async () => {
    const res = await runLearn(prisma, adminId, TUE, { dryRun: false });
    expect(res.monday).toBe(false);
    expect(res.lines).toEqual([]);
    expect(res.action_ids).toEqual([]);
    expect(await prisma.homeMeasure.count({ where: { user_id: adminId, kind: 'week' } })).toBe(1);
    expect(await prisma.homeMeasure.count({ where: { user_id: adminId, kind: 'daily', date: new Date('2026-11-24T00:00:00Z') } })).toBe(1);
    expect(await prisma.homeAction.count({ where: { user_id: adminId, action: 'keeper_measures' } })).toBe(1);
  });

  it('a Monday where he has only 2 business days of history writes its week row and no line', async () => {
    // His first tap ever was Thursday 2026-11-19: Thursday and Friday are the only business days of data in that week.
    await prisma.homeAction.create({ data: { user_id: youngAdminId, item_key: taskKey(randomUUID()), action: 'record', source: 'home', after: { recorded: { did: 'open_task', undo: false } }, created_at: new Date('2026-11-19T15:00:00Z') } });
    const res = await runLearn(prisma, youngAdminId, MON_1, { dryRun: false });
    expect(res.monday).toBe(true);
    expect(res.lines).toEqual([]);
    expect(await prisma.homeMeasure.count({ where: { user_id: youngAdminId, kind: 'week' } })).toBe(1);
    expect(await prisma.homeAction.count({ where: { user_id: youngAdminId, action: { in: ['keeper_measures', 'keeper_guard'] } } })).toBe(0);
  });

  it('a tech user and an overlook admin get nothing written and a 403 from GET /api/home', async () => {
    for (const [id, role] of [[techId, 'tech'], [overlookAdminId, 'admin']] as const) {
      expect(await runLearn(prisma, id, MON_1, { dryRun: false })).toEqual({ dry_run: false, skipped: 'home_off', action_ids: [] });
      expect(await runLearn(prisma, id, MON_1, { dryRun: true })).toEqual({ dry_run: true, skipped: 'home_off', action_ids: [] });
      expect(await prisma.homeMeasure.count({ where: { user_id: id } })).toBe(0);
      expect(await prisma.homeKeeperRun.count({ where: { user_id: id } })).toBe(0);
      expect(await prisma.homeAction.count({ where: { user_id: id } })).toBe(0);
      as(id, role);
      expect((await getHome()).status).toBe(403);
    }
  });

  it('task, email ask, wait and project rows are unchanged (counts and updated_at)', async () => {
    expect(await shared()).toBe(before);
    expect(securityTaskId).not.toBe('');
    expect(changedTaskId).not.toBe('');
  });

  it('the guard fires on 24 quick approvals in a week and is written as keeper_guard', async () => {
    // Monday 2026-12-07 reports Monday 11-30 to Sunday 12-06: 24 sign-offs, 23 approved, three seconds apart.
    const start = new Date('2026-12-01T15:00:00Z').getTime();
    const projects = Array.from({ length: 24 }, () => randomUUID());
    await prisma.homeAction.createMany({
      data: projects.map((p, i) => ({
        user_id: adminId,
        item_key: `review:${p}`,
        action: 'record',
        source: 'home',
        after: { recorded: { did: i < 23 ? 'approve_all' : 'let_it_go', undo: false } },
        created_at: new Date(start + i * 3000),
      })),
    });
    const res = await runLearn(prisma, adminId, new Date('2026-12-07T15:00:00Z'), { dryRun: false });
    const guard = res.lines!.find((l) => l.action === 'keeper_guard');
    expect(guard?.line).toBe('You approved 23 of 24 sign-offs and approvals last week, most within 5 seconds of your tap before. If these do not need you, tell Bast and it will suggest asking less.');
    const row = await prisma.homeAction.findFirst({ where: { user_id: adminId, action: 'keeper_guard' } });
    expect(row).toMatchObject({ source: 'keeper', undo_until: null });
  });
});

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { prisma } from '@/lib/db/prisma';
import { createOrGetSession, transitionSession } from '../sessions';
import { onPresence } from '../presence';
import { ensureTimer, lapseStop, observeTimer, stopTimer, sweepLapsedTimers, AUTO_TIMER_DESCRIPTION } from '../timer';
import { startRunningEntry } from '@/lib/services/time-entries';
import { SCRATCH, seedDesign, seedTask, teardownDesign, type DesignFixture } from './fixtures';

const MIN = 60_000;

describe.skipIf(!SCRATCH)('automatic task timer (real database)', () => {
  let f: DesignFixture;
  beforeAll(async () => {
    f = await seedDesign(`tm${Date.now()}`);
  });
  beforeEach(async () => {
    await prisma.designPortalSettings.update({ where: { id: 1 }, data: { auto_timer_enabled: true, auto_timer_lapse_minutes: 5, auto_timer_billable: false } });
    await prisma.site.update({ where: { id: f.siteId }, data: { design_auto_timer: true } });
  });
  afterAll(async () => {
    const ids = [f.designer.userId, f.admin.userId, f.other.userId];
    await prisma.designSession.updateMany({ where: { site_id: f.siteId }, data: { timer_entry_id: null } });
    await teardownDesign({ ...f, taskIds: f.taskIds }).catch(() => undefined);
    await prisma.timeEntry.deleteMany({ where: { user_id: { in: ids } } });
    await prisma.$disconnect();
  });

  async function open(actor = f.designer) {
    const taskId = await seedTask(f);
    const { session } = await createOrGetSession(actor, taskId);
    return { taskId, session };
  }
  const entries = (userId: string, taskId?: string) => prisma.timeEntry.findMany({ where: { user_id: userId, ...(taskId ? { task_id: taskId } : {}) }, orderBy: { started_at: 'asc' } });
  const sess = (id: string) => prisma.designSession.findUniqueOrThrow({ where: { id } });

  it('two opens (even concurrent) make one non-billable auto entry and do not touch the task', async () => {
    const { taskId, session } = await open();
    const [a, b] = await Promise.all([onPresence(session, true, f.designer), onPresence(session, true, f.designer)]);
    expect(a?.running).toBe(true);
    expect(b?.running).toBe(true);
    const rows = await entries(f.designer.userId, taskId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ is_running: true, is_billable: false, description: AUTO_TIMER_DESCRIPTION });
    expect((await sess(session.id)).timer_entry_id).toBe(rows[0].id);
    const t = await prisma.task.findUniqueOrThrow({ where: { id: taskId } });
    expect(t.status).toBe('not_started');
    expect(t.is_focus).toBe(false);
  });

  it('auto_timer_billable flips is_billable', async () => {
    await prisma.designPortalSettings.update({ where: { id: 1 }, data: { auto_timer_billable: true } });
    const { taskId, session } = await open();
    await onPresence(session, true, f.designer);
    expect((await entries(f.designer.userId, taskId))[0].is_billable).toBe(true);
  });

  it('hidden polls do not keep alive; a lapse stops at last presence on the next poll; a visible poll restarts', async () => {
    const { taskId, session } = await open();
    const t0 = new Date();
    await ensureTimer(session, f.designer, t0);
    await ensureTimer(session, f.designer, new Date(t0.getTime() + 2 * MIN));
    expect((await sess(session.id)).timer_presence_at?.getTime()).toBe(t0.getTime() + 2 * MIN);
    // a hidden poll 3 min later does not move presence and does not lapse yet
    await observeTimer(session, f.designer, new Date(t0.getTime() + 5 * MIN));
    expect((await sess(session.id)).timer_presence_at?.getTime()).toBe(t0.getTime() + 2 * MIN);
    // a poll 18 min after last presence lapses it
    const view = await observeTimer(session, f.designer, new Date(t0.getTime() + 20 * MIN));
    expect(view?.running).toBe(false);
    const [first] = await entries(f.designer.userId, taskId);
    expect(first.is_running).toBe(false);
    expect(first.ended_at?.getTime()).toBe(t0.getTime() + 2 * MIN);
    expect(first.duration).toBe(2);
    expect((await sess(session.id)).timer_entry_id).toBeNull();
    await onPresence(session, true, f.designer);
    const rows = await entries(f.designer.userId, taskId);
    expect(rows).toHaveLength(2);
    expect(rows[1].is_running).toBe(true);
  });

  it('the sweep stops a lapsed entry at last presence and leaves fresh ones', async () => {
    const adm = await open(f.admin);
    const fresh = await open();
    const t0 = new Date(Date.now() + 1000); // presence after the entry's real started_at
    await ensureTimer(adm.session, f.admin, t0);
    await ensureTimer(fresh.session, f.designer, new Date(t0.getTime() + 28 * MIN));
    expect(await sweepLapsedTimers(new Date(t0.getTime() + 30 * MIN))).toBeGreaterThanOrEqual(1);
    const a = (await entries(f.admin.userId, adm.taskId))[0];
    expect(a.is_running).toBe(false);
    expect(a.ended_at?.getTime()).toBe(t0.getTime());
    expect((await entries(f.designer.userId, fresh.taskId))[0].is_running).toBe(true);
    expect(await lapseStop(fresh.session, new Date(t0.getTime() + 30 * MIN))).toBe(false);
  });

  it('two users on one task get two entries', async () => {
    const taskId = await seedTask(f);
    const { session: s1 } = await createOrGetSession(f.designer, taskId);
    await onPresence(s1, true, f.designer);
    await prisma.designSession.update({ where: { id: s1.id }, data: { status: 'closed' } });
    const { session: s2 } = await createOrGetSession(f.admin, taskId);
    await onPresence(s2, true, f.admin);
    expect(await entries(f.designer.userId, taskId)).toHaveLength(1);
    expect(await entries(f.admin.userId, taskId)).toHaveLength(1);
    expect((await entries(f.designer.userId, taskId))[0].is_running).toBe(true);
  });

  it('a running entry on another task (manual) is stopped first; same-task manual entry is kept', async () => {
    const other = await seedTask(f, 'other');
    await startRunningEntry({ userId: f.designer.userId, taskId: other, touchTask: false });
    const { taskId, session } = await open();
    await onPresence(session, true, f.designer);
    expect((await entries(f.designer.userId, other))[0].is_running).toBe(false);
    expect(await prisma.timeEntry.count({ where: { user_id: f.designer.userId, is_running: true } })).toBe(1);

    await stopTimer(session);
    await startRunningEntry({ userId: f.designer.userId, taskId, touchTask: false });
    const v = await onPresence(session, true, f.designer);
    expect(v?.running).toBe(true);
    const mine = await entries(f.designer.userId, taskId);
    expect(mine.filter((e) => e.is_running)).toHaveLength(1);
    expect((await sess(session.id)).timer_entry_id).toBeNull(); // not owned, never lapse-stopped
  });

  it('an admin opener gets an entry; a viewing admin, other designer and pm get none', async () => {
    const { taskId, session } = await open(f.admin);
    expect((await onPresence(session, true, f.admin))?.running).toBe(true);
    const before = await prisma.timeEntry.count({ where: { task_id: taskId } });
    expect(await onPresence(session, true, f.designer)).toBeNull();
    expect(await onPresence(session, true, { userId: f.other.userId, role: 'pm' })).toBeNull();
    expect(await prisma.timeEntry.count({ where: { task_id: taskId } })).toBe(before);

    const d = await open(f.designer);
    expect(await onPresence(d.session, true, f.admin)).toBeNull();
    expect(await entries(f.admin.userId, d.taskId)).toHaveLength(0);
  });

  it('the global and per-site switches start nothing', async () => {
    await prisma.designPortalSettings.update({ where: { id: 1 }, data: { auto_timer_enabled: false } });
    const a = await open();
    await onPresence(a.session, true, f.designer);
    expect(await entries(f.designer.userId, a.taskId)).toHaveLength(0);
    await prisma.designPortalSettings.update({ where: { id: 1 }, data: { auto_timer_enabled: true } });
    await prisma.site.update({ where: { id: f.siteId }, data: { design_auto_timer: false } });
    await onPresence(a.session, true, f.designer);
    expect(await entries(f.designer.userId, a.taskId)).toHaveLength(0);
  });

  it('publish status changes leave it running; close stops it and a later poll does not restart it', async () => {
    const { taskId, session } = await open();
    await transitionSession(session.id, 'awaiting_input', 'worker');
    await onPresence(session, true, f.designer);
    await transitionSession(session.id, 'publishing', 'server');
    await onPresence(session, true, f.designer);
    await transitionSession(session.id, 'awaiting_input', 'server');
    await onPresence(session, false, f.designer);
    expect((await entries(f.designer.userId, taskId))[0].is_running).toBe(true);

    expect(await stopTimer(session)).toBe(true);
    const e = (await entries(f.designer.userId, taskId))[0];
    expect(e.is_running).toBe(false);
    expect((await sess(session.id)).timer_entry_id).toBeNull();
    await prisma.designSession.update({ where: { id: session.id }, data: { status: 'closed' } });
    await onPresence(session, true, f.designer);
    expect(await entries(f.designer.userId, taskId)).toHaveLength(1);
  });
});

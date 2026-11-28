// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import crypto from 'crypto';
import { prisma } from '@/lib/db/prisma';
import { SCRATCH } from '@/lib/engine/__tests__/seed';
import { BAST_USER_ID } from '@/lib/oracle/projects/gate-constants';
import { applyRecurringPick } from '@/lib/recurring-work/pick';

describe.skipIf(!SCRATCH)('recurring work picks (real database)', () => {
  const tag = crypto.randomBytes(3).toString('hex');
  let userId = '';
  let rowId = '';
  const schedule = { cron_expr: '45 7-22 * * *', schedule_text: 'every hour, 7am to 10pm', is_active: true, paused_on_purpose: false };

  const cards = () => prisma.task.findMany({ where: { created_by_id: userId }, orderBy: { created_at: 'asc' } });
  const row = () => prisma.recurringWork.findUniqueOrThrow({ where: { id: rowId } });

  beforeAll(async () => {
    userId = (await prisma.user.create({ data: { email: `pick-${tag}@example.test`, name: 'Pick Tester', role: 'admin', password_hash: 'not-a-login' } })).id;
    rowId = (
      await prisma.recurringWork.create({
        data: { kind: 'machine_job', title: `Pick job ${tag}`, job_key: `pick-job-${tag}`, ...schedule },
      })
    ).id;
  });
  afterAll(async () => {
    if (!userId) return;
    if (rowId) await prisma.recurringWork.deleteMany({ where: { id: rowId } });
    await prisma.activityLog.deleteMany({ where: { user_id: userId } });
    await prisma.task.deleteMany({ where: { created_by_id: userId } });
    await prisma.user.deleteMany({ where: { id: userId } });
  });

  it('keep records the pick and files nothing', async () => {
    const r = await applyRecurringPick({ id: rowId, pick: 'keep', userId });
    expect(r).toEqual({ filed: false, already_open: false, task: null });
    expect((await row()).mike_pick).toBe('keep');
    expect(await cards()).toHaveLength(0);
  });

  it('two cut taps at once file exactly one card for Bast', async () => {
    const results = await Promise.allSettled([
      applyRecurringPick({ id: rowId, pick: 'cut', userId }),
      applyRecurringPick({ id: rowId, pick: 'cut', userId }),
    ]);
    const made = await cards();
    expect(made).toHaveLength(1);
    expect(made[0].assignee_id).toBe(BAST_USER_ID);
    expect(made[0].tags).toContain('repo:bast-machine');
    expect(made[0].description).toContain(`pick-job-${tag}`);
    expect(made[0].recurring_work_id).toBeNull();
    const after = await row();
    expect(after.mike_pick).toBe('cut');
    expect(after.pick_task_id).toBe(made[0].id);
    expect(results.filter((x) => x.status === 'fulfilled' && x.value.filed)).toHaveLength(1);
  });

  it('a repeat tap while the card is open files nothing and changes nothing', async () => {
    const r = await applyRecurringPick({ id: rowId, pick: 'weekly', userId });
    expect(r.already_open).toBe(true);
    expect(await cards()).toHaveLength(1);
    expect((await row()).mike_pick).toBe('cut');
  });

  it('after the card is done, make weekly files a new card; the schedule never changed', async () => {
    const [first] = await cards();
    await prisma.task.update({ where: { id: first.id }, data: { status: 'done' } });
    const r = await applyRecurringPick({ id: rowId, pick: 'weekly', userId });
    expect(r.filed).toBe(true);
    expect(await cards()).toHaveLength(2);
    const after = await row();
    expect(after.mike_pick).toBe('weekly');
    expect(after.pick_task_id).toBe(r.task?.id);
    expect({ cron_expr: after.cron_expr, schedule_text: after.schedule_text, is_active: after.is_active, paused_on_purpose: after.paused_on_purpose }).toEqual(schedule);
  });
});

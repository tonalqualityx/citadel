import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Mock } from 'vitest';

vi.mock('@/lib/db/prisma', () => {
  const prisma: Record<string, unknown> = {
    recurringWork: { create: vi.fn(), findMany: vi.fn(), update: vi.fn(), updateMany: vi.fn(), delete: vi.fn(), deleteMany: vi.fn() },
    troubadorSchedule: { findMany: vi.fn() },
    site: { findMany: vi.fn() },
    maintenanceGenerationLog: { groupBy: vi.fn() },
    $executeRaw: vi.fn(),
  };
  prisma.$transaction = vi.fn(async (cb: (tx: unknown) => unknown) => cb(prisma));
  return { prisma };
});

import { prisma } from '@/lib/db/prisma';
import { maintenanceScheduleText, publishScheduleText, syncEngineRows, syncEngineRowsSafe } from '../engine-sync';

const p = prisma as unknown as Record<string, Record<string, Mock>> & { $executeRaw: Mock; $transaction: Mock };

const CLIENT = 'c0000000-0000-4000-8000-000000000001';
const SITE = 's0000000-0000-4000-8000-000000000001';
const SITE2 = 's0000000-0000-4000-8000-000000000002';
const USER = 'u0000000-0000-4000-8000-000000000001';
const SCHED = 'a0000000-0000-4000-8000-000000000001';
const PLAN = 'b0000000-0000-4000-8000-000000000001';
const PLAN2 = 'b0000000-0000-4000-8000-000000000002';

const schedule = (o: Record<string, unknown> = {}) => ({
  id: SCHED, name: 'Blog for Acme', status: 'active', client_id: CLIENT, site_id: SITE, default_assignee_id: USER,
  publish_per_week: 2, last_run_at: new Date('2026-11-20T10:00:00Z'), site: { name: 'Acme Site' }, ...o,
});
const msite = (o: Record<string, unknown> = {}) => ({
  id: SITE, name: 'Acme Site', client_id: CLIENT, maintenance_assignee_id: USER, maintenance_plan_id: PLAN,
  maintenance_plan: { id: PLAN, name: 'Gold', frequency: 'monthly' }, ...o,
});
const troubadorRow = (o: Record<string, unknown> = {}) => ({
  id: 'row-t', source_kind: 'troubador_schedule', source_id: SCHED, is_active: true, is_plumbing: false,
  title: 'Blog for Acme', client_id: CLIENT, site_id: SITE, owner_id: USER, produces: 'a blog post published on Acme Site',
  schedule_text: '2 posts a week', last_run_at: new Date('2026-11-20T10:00:00Z'), paused_on_purpose: false, created_at: new Date('2026-11-01'), ...o,
});
const maintRow = (o: Record<string, unknown> = {}) => ({
  id: 'row-m', source_kind: 'maintenance_plan', source_id: PLAN, is_active: true, is_plumbing: false,
  title: 'Gold maintenance: Acme Site', client_id: CLIENT, site_id: SITE, owner_id: USER, produces: 'Gold upkeep on Acme Site',
  schedule_text: 'monthly', last_run_at: null, paused_on_purpose: false, created_at: new Date('2026-11-01'), ...o,
});

beforeEach(() => {
  vi.clearAllMocks();
  p.troubadorSchedule.findMany.mockResolvedValue([]);
  p.site.findMany.mockResolvedValue([]);
  p.maintenanceGenerationLog.groupBy.mockResolvedValue([]);
  p.recurringWork.findMany.mockResolvedValue([]);
  p.recurringWork.create.mockResolvedValue({});
  p.recurringWork.update.mockResolvedValue({});
  p.recurringWork.updateMany.mockImplementation(async ({ where }: { where: { id: { in: string[] } } }) => ({ count: where.id.in.length }));
});

describe('wording helpers', () => {
  it('words the Troubador rate', () => {
    expect(publishScheduleText(2)).toBe('2 posts a week');
    expect(publishScheduleText(1)).toBe('1 post a week');
    expect(publishScheduleText(0.5)).toBe('1 post every 2 weeks');
    expect(publishScheduleText(0.25)).toBe('1 post every 4 weeks');
    expect(publishScheduleText(1.5)).toBe('1.5 posts a week');
    expect(publishScheduleText(0.4)).toBe('0.4 posts a week');
    expect(publishScheduleText(0)).toBe('no posts scheduled');
  });
  it('words the maintenance frequency', () => {
    expect(maintenanceScheduleText('monthly')).toBe('monthly');
    expect(maintenanceScheduleText('bi_monthly')).toBe('every 2 months');
    expect(maintenanceScheduleText('quarterly')).toBe('quarterly');
    expect(maintenanceScheduleText('semi_annually')).toBe('every 6 months');
    expect(maintenanceScheduleText('annually')).toBe('yearly');
  });
});

describe('syncEngineRows', () => {
  it('takes the advisory lock first and queries only active/paused, undeleted schedules', async () => {
    await syncEngineRows();
    expect(p.$executeRaw).toHaveBeenCalledTimes(1);
    expect(p.$executeRaw.mock.invocationCallOrder[0]).toBeLessThan(p.troubadorSchedule.findMany.mock.invocationCallOrder[0]);
    expect(p.troubadorSchedule.findMany.mock.calls[0][0].where).toEqual({ is_deleted: false, status: { in: ['active', 'paused'] } });
  });

  it('creates rows for active and paused schedules', async () => {
    p.troubadorSchedule.findMany.mockResolvedValue([schedule(), schedule({ id: 'a0000000-0000-4000-8000-000000000002', status: 'paused', publish_per_week: '0.50' })]);
    const res = await syncEngineRows();
    expect(res).toEqual({ created: 2, updated: 0, deactivated: 0, unchanged: 0, total: 2 });
    const [a, b] = p.recurringWork.create.mock.calls.map((c) => c[0].data);
    expect(a).toMatchObject({
      kind: 'engine', source_kind: 'troubador_schedule', source_id: SCHED, title: 'Blog for Acme', client_id: CLIENT, site_id: SITE, owner_id: USER,
      schedule_text: '2 posts a week', produces: 'a blog post published on Acme Site', paused_on_purpose: false, is_active: true, is_plumbing: false,
    });
    expect(a.last_run_at).toEqual(new Date('2026-11-20T10:00:00Z'));
    expect(b).toMatchObject({ paused_on_purpose: true, schedule_text: '1 post every 2 weeks' });
  });

  it('deactivates rows for ended, deleted or gone schedules', async () => {
    p.recurringWork.findMany.mockResolvedValue([troubadorRow()]);
    const res = await syncEngineRows();
    expect(res).toMatchObject({ created: 0, deactivated: 1, total: 0 });
    expect(p.recurringWork.updateMany).toHaveBeenCalledWith({ where: { id: { in: ['row-t'] } }, data: { is_active: false } });
  });

  it('makes one maintenance row per site on a qualifying plan, with the latest generation time', async () => {
    p.site.findMany.mockResolvedValue([msite(), msite({ id: SITE2, name: 'Other', maintenance_plan_id: PLAN })]);
    p.maintenanceGenerationLog.groupBy.mockResolvedValue([{ maintenance_plan_id: PLAN, site_id: SITE, _max: { generated_at: new Date('2026-11-01T00:00:00Z') } }]);
    const res = await syncEngineRows();
    expect(res.created).toBe(2);
    expect(p.maintenanceGenerationLog.groupBy).toHaveBeenCalledTimes(1);
    expect(p.site.findMany.mock.calls[0][0].where).toMatchObject({
      is_deleted: false, maintenance_plan_id: { not: null }, maintenance_plan: { is_active: true },
    });
    const [a, b] = p.recurringWork.create.mock.calls.map((c) => c[0].data);
    expect(a).toMatchObject({ kind: 'engine', source_kind: 'maintenance_plan', source_id: PLAN, site_id: SITE, client_id: CLIENT, owner_id: USER, title: 'Gold maintenance: Acme Site', schedule_text: 'monthly', produces: 'Gold upkeep on Acme Site' });
    expect(a.last_run_at).toEqual(new Date('2026-11-01T00:00:00Z'));
    expect(b.site_id).toBe(SITE2);
    expect(b.last_run_at).toBeNull();
  });

  it('truncates a long maintenance title to 200', async () => {
    p.site.findMany.mockResolvedValue([msite({ name: 'x'.repeat(255) })]);
    await syncEngineRows();
    expect(p.recurringWork.create.mock.calls[0][0].data.title).toHaveLength(200);
  });

  it('a site switching plans deactivates the old row and creates a new one', async () => {
    p.recurringWork.findMany.mockResolvedValue([maintRow()]);
    p.site.findMany.mockResolvedValue([msite({ maintenance_plan_id: PLAN2, maintenance_plan: { id: PLAN2, name: 'Silver', frequency: 'quarterly' } })]);
    const res = await syncEngineRows();
    expect(res).toMatchObject({ created: 1, deactivated: 1 });
    expect(p.recurringWork.create.mock.calls[0][0].data).toMatchObject({ source_id: PLAN2, schedule_text: 'quarterly', title: 'Silver maintenance: Acme Site' });
    expect(p.recurringWork.updateMany).toHaveBeenCalledWith({ where: { id: { in: ['row-m'] } }, data: { is_active: false } });
  });

  it('a site that no longer qualifies (plan inactive, site deleted or off the plan) has its row deactivated', async () => {
    p.recurringWork.findMany.mockResolvedValue([maintRow()]);
    const res = await syncEngineRows();
    expect(res).toMatchObject({ created: 0, deactivated: 1, total: 0 });
  });

  it('brings an inactive row back to active', async () => {
    p.recurringWork.findMany.mockResolvedValue([troubadorRow({ is_active: false })]);
    p.troubadorSchedule.findMany.mockResolvedValue([schedule()]);
    const res = await syncEngineRows();
    expect(res).toMatchObject({ created: 0, updated: 1, deactivated: 0 });
    expect(p.recurringWork.update.mock.calls[0][0].data).toMatchObject({ is_active: true });
  });

  it('a no-op sync writes nothing', async () => {
    p.recurringWork.findMany.mockResolvedValue([troubadorRow(), maintRow()]);
    p.troubadorSchedule.findMany.mockResolvedValue([schedule()]);
    p.site.findMany.mockResolvedValue([msite()]);
    const res = await syncEngineRows();
    expect(res).toEqual({ created: 0, updated: 0, deactivated: 0, unchanged: 2, total: 2 });
    expect(p.recurringWork.create).not.toHaveBeenCalled();
    expect(p.recurringWork.update).not.toHaveBeenCalled();
    expect(p.recurringWork.updateMany).not.toHaveBeenCalled();
  });

  it('updates a drifted row, writing only the synced fields', async () => {
    p.recurringWork.findMany.mockResolvedValue([troubadorRow({ title: 'Old name', paused_on_purpose: false })]);
    p.troubadorSchedule.findMany.mockResolvedValue([schedule({ status: 'paused' })]);
    const res = await syncEngineRows();
    expect(res.updated).toBe(1);
    const data = p.recurringWork.update.mock.calls[0][0].data;
    expect(Object.keys(data).sort()).toEqual(
      ['client_id', 'is_active', 'is_plumbing', 'last_run_at', 'owner_id', 'paused_on_purpose', 'produces', 'schedule_text', 'site_id', 'title'].sort()
    );
    for (const k of ['initiative_id', 'sort_order', 'group_label', 'priority', 'destinations', 'mike_pick', 'usage_week_tokens', 'kind']) expect(data).not.toHaveProperty(k);
    expect(data).toMatchObject({ title: 'Blog for Acme', paused_on_purpose: true });
  });

  it('with duplicate keys, the oldest row is the match and the other is left alone', async () => {
    p.recurringWork.findMany.mockResolvedValue([troubadorRow({ id: 'old' }), troubadorRow({ id: 'dup', title: 'stale' })]);
    p.troubadorSchedule.findMany.mockResolvedValue([schedule()]);
    const res = await syncEngineRows();
    expect(res).toMatchObject({ unchanged: 1, updated: 0, deactivated: 0 });
    expect(p.recurringWork.update).not.toHaveBeenCalled();
  });

  it('never deletes', async () => {
    p.recurringWork.findMany.mockResolvedValue([troubadorRow(), maintRow()]);
    await syncEngineRows();
    expect(p.recurringWork.delete).not.toHaveBeenCalled();
    expect(p.recurringWork.deleteMany).not.toHaveBeenCalled();
  });
});

describe('syncEngineRowsSafe', () => {
  it('logs a failure and never throws', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    p.$transaction.mockRejectedValueOnce(new Error('db down'));
    await expect(syncEngineRowsSafe('PATCH /api/x')).resolves.toBeUndefined();
    expect(err).toHaveBeenCalled();
    expect(String(err.mock.calls[0][0])).toContain('PATCH /api/x');
    err.mockRestore();
  });
});

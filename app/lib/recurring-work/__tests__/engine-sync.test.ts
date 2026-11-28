import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Mock } from 'vitest';

vi.mock('@/lib/db/prisma', () => {
  const prisma: Record<string, unknown> = {
    recurringWork: { create: vi.fn(), findMany: vi.fn(), update: vi.fn(), updateMany: vi.fn(), delete: vi.fn(), deleteMany: vi.fn() },
    troubadorSchedule: { findMany: vi.fn() },
    maintenancePlan: { findMany: vi.fn() },
    site: { groupBy: vi.fn() },
    maintenanceGenerationLog: { groupBy: vi.fn() },
    $executeRaw: vi.fn(),
  };
  prisma.$transaction = vi.fn(async (cb: (tx: unknown) => unknown) => cb(prisma));
  return { prisma };
});

import { prisma } from '@/lib/db/prisma';
import { BAST_USER_ID } from '@/lib/oracle/projects/gate-constants';
import { maintenanceProducesText, maintenanceScheduleText, publishScheduleText, syncEngineRows, syncEngineRowsSafe } from '../engine-sync';

const p = prisma as unknown as Record<string, Record<string, Mock>> & { $executeRaw: Mock; $transaction: Mock };

const CLIENT = 'c0000000-0000-4000-8000-000000000001';
const SITE = 's0000000-0000-4000-8000-000000000001';
const USER = 'u0000000-0000-4000-8000-000000000001';
const SCHED = 'a0000000-0000-4000-8000-000000000001';
const PLAN = 'b0000000-0000-4000-8000-000000000001';
const PLAN2 = 'b0000000-0000-4000-8000-000000000002';

const schedule = (o: Record<string, unknown> = {}) => ({
  id: SCHED, name: 'Blog for Acme', status: 'active', client_id: CLIENT, site_id: SITE, default_assignee_id: USER,
  publish_per_week: 2, last_run_at: new Date('2026-11-20T10:00:00Z'), site: { name: 'Acme Site' }, ...o,
});
const plan = (o: Record<string, unknown> = {}) => ({ id: PLAN, name: 'Gold', frequency: 'monthly', ...o });
const siteCount = (id: string, n: number) => ({ maintenance_plan_id: id, _count: { _all: n } });
const troubadorRow = (o: Record<string, unknown> = {}) => ({
  id: 'row-t', source_kind: 'troubador_schedule', source_id: SCHED, is_active: true, is_plumbing: false,
  title: 'Blog for Acme', client_id: CLIENT, site_id: SITE, owner_id: USER, produces: 'a blog post published on Acme Site',
  schedule_text: '2 posts a week', last_run_at: new Date('2026-11-20T10:00:00Z'), paused_on_purpose: false, created_at: new Date('2026-11-01'), ...o,
});
const maintRow = (o: Record<string, unknown> = {}) => ({
  id: 'row-m', source_kind: 'maintenance_plan', source_id: PLAN, is_active: true, is_plumbing: false,
  title: 'Gold maintenance', client_id: null, site_id: null, owner_id: BAST_USER_ID,
  produces: 'a maintenance task each month for each of the 2 sites on Gold',
  schedule_text: 'monthly', last_run_at: null, paused_on_purpose: false, created_at: new Date('2026-11-01'), ...o,
});

beforeEach(() => {
  vi.clearAllMocks();
  p.troubadorSchedule.findMany.mockResolvedValue([]);
  p.maintenancePlan.findMany.mockResolvedValue([]);
  p.site.groupBy.mockResolvedValue([]);
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
  it('words what a plan row produces, with its reach', () => {
    expect(maintenanceProducesText('Essentials', 'monthly', 47)).toBe('a maintenance task each month for each of the 47 sites on Essentials');
    expect(maintenanceProducesText('Essentials', 'monthly', 1)).toBe('a maintenance task each month for the 1 site on Essentials');
    expect(maintenanceProducesText('Essentials', 'monthly', 0)).toBe('a maintenance task each month for each site on Essentials, none on it yet');
    expect(maintenanceProducesText('X', 'bi_monthly', 2)).toContain('every 2 months');
    expect(maintenanceProducesText('X', 'quarterly', 2)).toContain('each quarter');
    expect(maintenanceProducesText('X', 'semi_annually', 2)).toContain('every 6 months');
    expect(maintenanceProducesText('X', 'annually', 2)).toContain('each year');
    expect(maintenanceProducesText('X', 'every_other_day', 2)).toContain('every other day');
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

  it('makes ONE maintenance row per active plan, whatever its site count', async () => {
    p.maintenancePlan.findMany.mockResolvedValue([plan(), plan({ id: PLAN2, name: 'Silver', frequency: 'quarterly' })]);
    p.site.groupBy.mockResolvedValue([siteCount(PLAN, 47)]);
    const res = await syncEngineRows();
    expect(res).toMatchObject({ created: 2, total: 2 });
    expect(p.maintenancePlan.findMany.mock.calls[0][0].where).toEqual({ is_active: true });
    expect(p.site.groupBy.mock.calls[0][0].where).toMatchObject({ is_deleted: false, maintenance_plan_id: { in: [PLAN, PLAN2] } });
    const [a, b] = p.recurringWork.create.mock.calls.map((c) => c[0].data);
    expect(a).toEqual({
      kind: 'engine', source_kind: 'maintenance_plan', source_id: PLAN, title: 'Gold maintenance', client_id: null, site_id: null,
      owner_id: BAST_USER_ID, group_label: 'Client sites', schedule_text: 'monthly',
      produces: 'a maintenance task each month for each of the 47 sites on Gold', last_run_at: null, paused_on_purpose: false,
      is_active: true, is_plumbing: false,
    });
    // a plan with zero sites (and no SOPs) still gets a row
    expect(b).toMatchObject({ source_id: PLAN2, title: 'Silver maintenance', schedule_text: 'quarterly', produces: 'a maintenance task each quarter for each site on Silver, none on it yet' });
  });

  it('takes last_run_at from the newest generation log for the plan, across sites', async () => {
    p.maintenancePlan.findMany.mockResolvedValue([plan()]);
    p.maintenanceGenerationLog.groupBy.mockResolvedValue([{ maintenance_plan_id: PLAN, _max: { generated_at: new Date('2026-11-01T00:00:00Z') } }]);
    await syncEngineRows();
    expect(p.maintenanceGenerationLog.groupBy.mock.calls[0][0]).toMatchObject({ by: ['maintenance_plan_id'], where: { maintenance_plan_id: { in: [PLAN] } } });
    expect(p.recurringWork.create.mock.calls[0][0].data.last_run_at).toEqual(new Date('2026-11-01T00:00:00Z'));
  });

  it('truncates a long maintenance title to 200 and produces to 300', async () => {
    p.maintenancePlan.findMany.mockResolvedValue([plan({ name: 'x'.repeat(100) })]);
    await syncEngineRows();
    const data = p.recurringWork.create.mock.calls[0][0].data;
    expect(data.title.length).toBeLessThanOrEqual(200);
    expect(data.produces.length).toBeLessThanOrEqual(300);
  });

  it('a plan update never writes group_label, and writes only the synced fields', async () => {
    p.recurringWork.findMany.mockResolvedValue([maintRow({ group_label: 'Moved by a person' })]);
    p.maintenancePlan.findMany.mockResolvedValue([plan()]);
    p.site.groupBy.mockResolvedValue([siteCount(PLAN, 3)]);
    const res = await syncEngineRows();
    expect(res).toMatchObject({ updated: 1, created: 0 });
    const data = p.recurringWork.update.mock.calls[0][0].data;
    expect(data).not.toHaveProperty('group_label');
    expect(data.produces).toBe('a maintenance task each month for each of the 3 sites on Gold');
  });

  it('a plan that is no longer active has its row deactivated', async () => {
    p.recurringWork.findMany.mockResolvedValue([maintRow()]);
    const res = await syncEngineRows();
    expect(res).toMatchObject({ created: 0, deactivated: 1, total: 0 });
    expect(p.recurringWork.updateMany).toHaveBeenCalledWith({ where: { id: { in: ['row-m'] } }, data: { is_active: false } });
  });

  it('a site moving between plans changes only the two plan rows\' reach, creating nothing', async () => {
    p.recurringWork.findMany.mockResolvedValue([maintRow(), maintRow({ id: 'row-m2', source_id: PLAN2, title: 'Silver maintenance', produces: 'a maintenance task each month for each of the 1 sites on Silver' })]);
    p.maintenancePlan.findMany.mockResolvedValue([plan(), plan({ id: PLAN2, name: 'Silver' })]);
    p.site.groupBy.mockResolvedValue([siteCount(PLAN, 2), siteCount(PLAN2, 1)]);
    const res = await syncEngineRows();
    expect(res).toMatchObject({ created: 0, deactivated: 0, updated: 1, unchanged: 1 });
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
    p.maintenancePlan.findMany.mockResolvedValue([plan()]);
    p.site.groupBy.mockResolvedValue([siteCount(PLAN, 2)]);
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

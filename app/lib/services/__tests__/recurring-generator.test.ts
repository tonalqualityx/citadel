import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Mock } from 'vitest';

vi.mock('@/lib/work/ask-closure', () => ({ closeAsksForTasks: vi.fn() }));
vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    charter: { findUnique: vi.fn(), findMany: vi.fn() },
    charterGenerationLog: { findUnique: vi.fn() },
    recurringWork: { findMany: vi.fn() },
    client: { findFirst: vi.fn() },
    $transaction: vi.fn(),
  },
}));

import { prisma } from '@/lib/db/prisma';
import { generateAllDueCharterTasks, generateCharterTasks, generateStandaloneRecurringTasks } from '../charter-generator';

const p = prisma as unknown as Record<string, Record<string, Mock> & Mock>;

const SOP = { id: 'sop-1', title: 'Monthly report', content: null, is_active: true, default_priority: 3, function_id: null, energy_estimate: null, mystery_factor: null, battery_impact: null, estimated_minutes: 30, needs_review: false, template_requirements: null, review_requirements: null };
const row = (o: Record<string, unknown> = {}) => ({ id: 'rw-1', kind: 'citadel_task', charter_id: null, sop_id: 'sop-1', sop: SOP, cadence: 'monthly', client_id: null, site_id: null, is_active: true, sort_order: 0, ...o });

let tx: { task: { findMany: Mock; updateMany: Mock; create: Mock }; charterGenerationLog: { create: Mock } };

beforeEach(() => {
  vi.clearAllMocks();
  tx = { task: { findMany: vi.fn().mockResolvedValue([]), updateMany: vi.fn().mockResolvedValue({ count: 0 }), create: vi.fn() }, charterGenerationLog: { create: vi.fn() } };
  p.$transaction.mockImplementation(async (fn: (t: unknown) => unknown) => fn(tx));
  p.charterGenerationLog.findUnique.mockResolvedValue(null);
  p.client.findFirst.mockResolvedValue({ id: 'indelible-id' });
});

describe('generateStandaloneRecurringTasks', () => {
  it('reads only active citadel_task rows with no charter, a SOP and a cadence', async () => {
    p.recurringWork.findMany.mockResolvedValue([]);
    await generateStandaloneRecurringTasks();
    expect(p.recurringWork.findMany.mock.calls[0][0].where).toEqual({
      is_active: true, kind: 'citadel_task', charter_id: null, sop_id: { not: null }, cadence: { not: null },
    });
  });

  it('creates a task linked to the row, with no charter, not retainer work, on Indelible when the row has no client', async () => {
    p.recurringWork.findMany.mockResolvedValue([row({ site_id: 'site-1' })]);
    const out = await generateStandaloneRecurringTasks();
    const data = tx.task.create.mock.calls[0][0].data;
    expect(data).toMatchObject({ recurring_work_id: 'rw-1', charter_id: null, client_id: 'indelible-id', site_id: 'site-1', is_retainer_work: false, sop_id: 'sop-1', title: 'Monthly report' });
    expect(tx.charterGenerationLog.create.mock.calls[0][0].data).toMatchObject({ charter_id: null, scheduled_task_id: 'rw-1', tasks_created: 1 });
    expect(out.results).toHaveLength(1);
    expect(p.client.findFirst.mock.calls[0][0].where.name).toEqual({ equals: 'Indelible', mode: 'insensitive' });
  });

  it("uses the row's own client and does not look Indelible up", async () => {
    p.recurringWork.findMany.mockResolvedValue([row({ client_id: 'client-9' })]);
    await generateStandaloneRecurringTasks();
    expect(tx.task.create.mock.calls[0][0].data.client_id).toBe('client-9');
    expect(p.client.findFirst).not.toHaveBeenCalled();
  });

  it('skips with a warning when there is no client and no Indelible client', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    p.client.findFirst.mockResolvedValue(null);
    p.recurringWork.findMany.mockResolvedValue([row()]);
    const out = await generateStandaloneRecurringTasks();
    expect(tx.task.create).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalled();
    expect(out.results).toEqual([]);
    warn.mockRestore();
  });

  it('skips a machine or engine row even if one reaches the loop', async () => {
    p.recurringWork.findMany.mockResolvedValue([row({ kind: 'machine_job' }), row({ id: 'rw-2', kind: 'engine' })]);
    await generateStandaloneRecurringTasks();
    expect(tx.task.create).not.toHaveBeenCalled();
  });

  it('dedups by period: a row already logged for the period makes nothing', async () => {
    p.charterGenerationLog.findUnique.mockResolvedValue({ id: 'log' });
    p.recurringWork.findMany.mockResolvedValue([row()]);
    const out = await generateStandaloneRecurringTasks();
    expect(p.charterGenerationLog.findUnique.mock.calls[0][0].where.scheduled_task_id_period).toMatchObject({ scheduled_task_id: 'rw-1' });
    expect(tx.task.create).not.toHaveBeenCalled();
    expect(out.results).toEqual([]);
  });

  it('abandons earlier open tasks by recurring_work_id only (no charter fallback)', async () => {
    tx.task.findMany.mockResolvedValue([{ id: 't-old' }]);
    tx.task.updateMany.mockResolvedValue({ count: 1 });
    p.recurringWork.findMany.mockResolvedValue([row()]);
    const out = await generateStandaloneRecurringTasks();
    const where = tx.task.findMany.mock.calls[0][0].where;
    expect(where.OR).toEqual([{ recurring_work_id: 'rw-1' }]);
    expect(where.status.notIn).toEqual(expect.arrayContaining(['done', 'abandoned', 'triage']));
    expect(out.results[0]).toMatchObject({ tasksCreated: 1, tasksAbandoned: 1 });
  });

  it('logs a row error without stopping the others', async () => {
    p.recurringWork.findMany.mockResolvedValue([row({ id: 'bad' }), row({ id: 'good' })]);
    p.$transaction.mockRejectedValueOnce(new Error('boom'));
    const out = await generateStandaloneRecurringTasks();
    expect(out.errors).toEqual([{ recurringWorkId: 'bad', error: 'boom' }]);
    expect(out.results.map((r) => r.recurringWorkId)).toEqual(['good']);
  });
});

describe('charter rows', () => {
  const charter = (rows: unknown[]) => ({ id: 'c1', name: 'Plan', status: 'active', is_deleted: false, client_id: 'cl1', client: {}, scheduled_tasks: rows });

  it('stay retainer work, keep the charter id, and now carry recurring_work_id', async () => {
    p.charter.findUnique.mockResolvedValue(charter([row({ id: 'rw-c', charter_id: 'c1' })]));
    const result = await generateCharterTasks('c1');
    expect(tx.task.create.mock.calls[0][0].data).toMatchObject({ charter_id: 'c1', client_id: 'cl1', is_retainer_work: true, recurring_work_id: 'rw-c' });
    expect(tx.task.create.mock.calls[0][0].data.site_id).toBeUndefined();
    expect(tx.charterGenerationLog.create.mock.calls[0][0].data).toMatchObject({ charter_id: 'c1', scheduled_task_id: 'rw-c' });
    expect(result).toMatchObject({ tasksCreated: 1 });
  });

  it('abandon lookup uses recurring_work_id, falling back to charter + SOP for tasks with no link', async () => {
    p.charter.findUnique.mockResolvedValue(charter([row({ id: 'rw-c', charter_id: 'c1' })]));
    await generateCharterTasks('c1');
    expect(tx.task.findMany.mock.calls[0][0].where.OR).toEqual([
      { recurring_work_id: 'rw-c' },
      { recurring_work_id: null, charter_id: 'c1', sop_id: 'sop-1' },
    ]);
  });

  it('only reads citadel_task rows', async () => {
    p.charter.findUnique.mockResolvedValue(charter([]));
    await generateCharterTasks('c1');
    expect(p.charter.findUnique.mock.calls[0][0].include.scheduled_tasks.where).toEqual({ is_active: true, kind: 'citadel_task' });
  });
});

describe('generateAllDueCharterTasks', () => {
  it('one run covers charters and standalone rows, and adds both to the totals', async () => {
    p.charter.findMany.mockResolvedValue([{ id: 'c1' }]);
    p.charter.findUnique.mockResolvedValue({ id: 'c1', name: 'Plan', status: 'active', is_deleted: false, client_id: 'cl1', client: {}, scheduled_tasks: [row({ id: 'rw-c', charter_id: 'c1' })] });
    p.recurringWork.findMany.mockResolvedValue([row({ id: 'rw-s' })]);
    const summary = await generateAllDueCharterTasks();
    expect(summary.totalChartersProcessed).toBe(1);
    expect(summary.standalone).toHaveLength(1);
    expect(summary.totalTasksCreated).toBe(2);
    expect(summary.errors).toEqual([]);
  });
});

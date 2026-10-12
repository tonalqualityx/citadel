import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Mock } from 'vitest';
import { Prisma } from '@prisma/client';

vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    ritualRun: { create: vi.fn() },
    todayPick: { count: vi.fn(), findFirst: vi.fn(), findMany: vi.fn(), createMany: vi.fn() },
  },
}));

import { prisma } from '@/lib/db/prisma';
import { rolloverTodayPicksIfNeeded } from '@/lib/services/today-rollover';

const today = new Date('2026-10-12T00:00:00.000Z');
const friday = new Date('2026-10-09T00:00:00.000Z');
const markerCreate = prisma.ritualRun.create as Mock;
const count = prisma.todayPick.count as Mock;
const findFirst = prisma.todayPick.findFirst as Mock;
const findMany = prisma.todayPick.findMany as Mock;
const createMany = prisma.todayPick.createMany as Mock;

function prior(over: Record<string, unknown>) {
  return {
    id: 'p', date: friday, item_type: 'arc', arc_id: 'arc-1', task_id: null, session_external_id: null,
    charter_id: null, accord_id: null, label: null, sort: 0, started_at: null, completed_at: null,
    arc: { closed_at: null, tasks: [{ status: 'in_progress' }] }, task: null, accord: null, ...over,
  };
}

describe('rolloverTodayPicksIfNeeded', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    markerCreate.mockResolvedValue({});
    count.mockResolvedValue(0);
    findFirst.mockResolvedValue({ date: friday });
    createMany.mockResolvedValue({ count: 0 });
  });

  it('copies the last working day\'s live, unfinished picks onto today', async () => {
    const started = new Date('2026-10-09T14:00:00Z');
    findMany.mockResolvedValue([
      prior({ arc_id: 'arc-open', sort: 0, started_at: started }),
      prior({ arc_id: 'arc-done', sort: 1, arc: { closed_at: null, tasks: [{ status: 'done' }] } }),
      prior({ arc_id: 'arc-finished-pick', sort: 2, completed_at: new Date() }),
    ]);

    await expect(rolloverTodayPicksIfNeeded(today)).resolves.toBe(1);
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { date: friday } }));
    expect(createMany).toHaveBeenCalledWith({
      data: [expect.objectContaining({ date: today, item_type: 'arc', arc_id: 'arc-open', sort: 0, started_at: started })],
    });
  });

  it('runs at most once per day (marker already exists)', async () => {
    markerCreate.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: 'x' })
    );
    await expect(rolloverTodayPicksIfNeeded(today)).resolves.toBe(0);
    expect(count).not.toHaveBeenCalled();
    expect(createMany).not.toHaveBeenCalled();
  });

  it('leaves a day alone that already has picks', async () => {
    count.mockResolvedValue(2);
    await expect(rolloverTodayPicksIfNeeded(today)).resolves.toBe(0);
    expect(createMany).not.toHaveBeenCalled();
  });

  it('does nothing when there is no prior day in the lookback window', async () => {
    findFirst.mockResolvedValue(null);
    await expect(rolloverTodayPicksIfNeeded(today)).resolves.toBe(0);
    expect(createMany).not.toHaveBeenCalled();
  });

  it('rethrows unexpected marker errors', async () => {
    markerCreate.mockRejectedValue(new Error('db down'));
    await expect(rolloverTodayPicksIfNeeded(today)).rejects.toThrow('db down');
  });
});

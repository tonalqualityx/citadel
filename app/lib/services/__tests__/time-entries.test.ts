import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Mock } from 'vitest';

vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    timeEntry: { findMany: vi.fn(), findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
    task: { findUnique: vi.fn(), updateMany: vi.fn() },
  },
}));

import { prisma } from '@/lib/db/prisma';
import { durationMinutes, startRunningEntry, stopRunningEntry } from '../time-entries';

const te = prisma.timeEntry as unknown as Record<string, Mock>;
const task = prisma.task as unknown as Record<string, Mock>;

beforeEach(() => {
  vi.clearAllMocks();
  te.findMany.mockResolvedValue([]);
  te.create.mockResolvedValue({ id: 'new' });
  te.update.mockResolvedValue({ id: 'u' });
  task.findUnique.mockResolvedValue({ project_id: 'proj' });
});

describe('durationMinutes', () => {
  const t0 = new Date('2026-01-01T00:00:00Z');
  it('rounds up whole minutes, floors seconds first', () => {
    expect(durationMinutes(t0, new Date(t0.getTime() + 0))).toBe(0);
    expect(durationMinutes(t0, new Date(t0.getTime() + 1000))).toBe(1);
    expect(durationMinutes(t0, new Date(t0.getTime() + 60_000))).toBe(1);
    expect(durationMinutes(t0, new Date(t0.getTime() + 60_999))).toBe(1);
    expect(durationMinutes(t0, new Date(t0.getTime() + 61_000))).toBe(2);
  });
});

describe('startRunningEntry', () => {
  it('stops the user other running entries, then creates; touchTask runs the three task updates', async () => {
    te.findMany.mockResolvedValue([{ id: 'old', started_at: new Date(Date.now() - 125_000) }]);
    await startRunningEntry({ userId: 'u1', taskId: 't1', touchTask: true });
    expect(te.findMany).toHaveBeenCalledWith({ where: { user_id: 'u1', is_running: true } });
    const upd = te.update.mock.calls[0][0];
    expect(upd.where).toEqual({ id: 'old' });
    expect(upd.data.is_running).toBe(false);
    expect(upd.data.duration).toBe(3);
    const created = te.create.mock.calls[0][0].data;
    expect(created).toMatchObject({ task_id: 't1', project_id: 'proj', user_id: 'u1', is_running: true, duration: 0 });
    expect('description' in created).toBe(false);
    expect('is_billable' in created).toBe(false);
    expect(task.updateMany).toHaveBeenCalledTimes(3);
  });

  it('touchTask false leaves the task alone and passes description and billing through', async () => {
    await startRunningEntry({ userId: 'u1', taskId: 't1', projectId: 'p9', description: 'Design portal (auto)', isBillable: false, touchTask: false });
    expect(task.updateMany).not.toHaveBeenCalled();
    expect(task.findUnique).not.toHaveBeenCalled();
    expect(te.create.mock.calls[0][0].data).toMatchObject({ project_id: 'p9', description: 'Design portal (auto)', is_billable: false });
  });
});

describe('stopRunningEntry', () => {
  it('by entry id uses the supplied ended_at and ceil minutes', async () => {
    const start = new Date('2026-01-01T00:00:00Z');
    te.findUnique.mockResolvedValue({ id: 'e1', started_at: start });
    const end = new Date(start.getTime() + 90_000);
    await stopRunningEntry({ entryId: 'e1', endedAt: end });
    expect(te.update.mock.calls[0][0]).toMatchObject({ where: { id: 'e1' }, data: { is_running: false, ended_at: end, duration: 2 } });
  });

  it('by user id stops every running entry and returns the count', async () => {
    te.findMany.mockResolvedValue([{ id: 'a', started_at: new Date() }, { id: 'b', started_at: new Date() }]);
    expect(await stopRunningEntry({ userId: 'u1' })).toBe(2);
    expect(te.update).toHaveBeenCalledTimes(2);
  });
});

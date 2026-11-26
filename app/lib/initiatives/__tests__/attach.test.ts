import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Mock } from 'vitest';

vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    initiative: { findFirst: vi.fn() },
    project: { findFirst: vi.fn(), update: vi.fn() },
    task: { findFirst: vi.fn(), update: vi.fn() },
    recurringWork: { findFirst: vi.fn(), update: vi.fn() },
  },
}));

import { prisma } from '@/lib/db/prisma';
import { attachBodySchema, attachItem, detachItem } from '../attach';

const p = prisma as unknown as Record<string, Record<string, Mock>>;
const INIT = '33333333-3333-4333-8333-333333333333';
const RW = '55555555-5555-4555-8555-555555555555';
const TASK = '66666666-6666-4666-8666-666666666666';

beforeEach(() => {
  vi.clearAllMocks();
  p.initiative.findFirst.mockResolvedValue({ id: INIT });
});

describe('attachBodySchema', () => {
  it('takes exactly one of project_id, task_id, recurring_work_id', () => {
    expect(attachBodySchema.safeParse({ recurring_work_id: RW }).success).toBe(true);
    expect(attachBodySchema.safeParse({ task_id: TASK }).success).toBe(true);
    expect(attachBodySchema.safeParse({}).success).toBe(false);
    expect(attachBodySchema.safeParse({ task_id: TASK, recurring_work_id: RW }).success).toBe(false);
  });
});

describe('recurring_work_id attach and detach', () => {
  it('attaches a recurring row, naming it by title or SOP title', async () => {
    p.recurringWork.findFirst.mockResolvedValue({ id: RW, title: null, sop: { title: 'Monthly report' }, initiative_id: null });
    const out = await attachItem(INIT, { recurring_work_id: RW });
    expect(p.recurringWork.update).toHaveBeenCalledWith({ where: { id: RW }, data: { initiative_id: INIT } });
    expect(out).toMatchObject({ attached: true, kind: 'recurring_work', id: RW, name: 'Monthly report', moved_from: null });
  });

  it('404 for an unknown recurring row', async () => {
    p.recurringWork.findFirst.mockResolvedValue(null);
    await expect(attachItem(INIT, { recurring_work_id: RW })).rejects.toMatchObject({ statusCode: 404 });
  });

  it('detaches only when it points at this initiative', async () => {
    p.recurringWork.findFirst.mockResolvedValue({ id: RW, title: 'Report', sop: null, initiative_id: 'other' });
    await expect(detachItem(INIT, { recurring_work_id: RW })).rejects.toMatchObject({ statusCode: 409 });
    p.recurringWork.findFirst.mockResolvedValue({ id: RW, title: 'Report', sop: null, initiative_id: INIT });
    await detachItem(INIT, { recurring_work_id: RW });
    expect(p.recurringWork.update).toHaveBeenCalledWith({ where: { id: RW }, data: { initiative_id: null } });
  });

  it('still attaches a task as before', async () => {
    p.task.findFirst.mockResolvedValue({ id: TASK, title: 'T', initiative_id: null });
    await attachItem(INIT, { task_id: TASK });
    expect(p.task.update).toHaveBeenCalledWith({ where: { id: TASK }, data: { initiative_id: INIT } });
  });
});

import { describe, it, expect, vi } from 'vitest';
import { completeStageTask, findTaskByTag } from '../track-core';
import type { PrismaClient } from '@prisma/client';

// Triage sweep for portal v2 code: a triage task is parked for Mike, so no stage helper may find it or complete it.
describe('stage helpers never touch a triage task', () => {
  it('findTaskByTag excludes abandoned and triage', async () => {
    const findFirst = vi.fn().mockResolvedValue(null);
    await findTaskByTag({ task: { findFirst } } as unknown as PrismaClient, 'p1', 'design-stage:review');
    expect(findFirst.mock.calls[0][0].where.status).toEqual({ notIn: ['abandoned', 'triage'] });
  });

  it('completeStageTask never writes done over a triage or abandoned task', async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 0 });
    const tx = { task: { updateMany } };
    const changed = await completeStageTask('t1', 'u1', { tx, done: new Set<string>() } as never);
    expect(changed).toBe(false);
    expect(updateMany.mock.calls[0][0].where.status).toEqual({ notIn: ['abandoned', 'triage'] });
  });
});

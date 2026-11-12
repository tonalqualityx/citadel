import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Mock } from 'vitest';

vi.mock('@/lib/db/prisma', () => ({
  prisma: { task: { findUnique: vi.fn() }, user: { findUnique: vi.fn() } },
}));

import { prisma } from '@/lib/db/prisma';
import { suppressedForTriage } from '../notification-triage-guard';

const taskFind = prisma.task.findUnique as Mock;
const userFind = prisma.user.findUnique as Mock;

beforeEach(() => vi.clearAllMocks());

describe('suppressedForTriage', () => {
  it.each(['tech', 'designer'])('suppresses a triage task notice for role %s', async (role) => {
    taskFind.mockResolvedValue({ status: 'triage' });
    userFind.mockResolvedValue({ role });
    expect(await suppressedForTriage('u1', 'task', 't1')).toBe(true);
  });

  it.each(['pm', 'admin'])('lets role %s (an owner) through', async (role) => {
    taskFind.mockResolvedValue({ status: 'triage' });
    userFind.mockResolvedValue({ role });
    expect(await suppressedForTriage('u1', 'task', 't1')).toBe(false);
  });

  it('never suppresses a task that is not in triage, or a non-task entity', async () => {
    taskFind.mockResolvedValue({ status: 'not_started' });
    userFind.mockResolvedValue({ role: 'designer' });
    expect(await suppressedForTriage('u1', 'task', 't1')).toBe(false);
    expect(await suppressedForTriage('u1', 'project', 'p1')).toBe(false);
  });
});

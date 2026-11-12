/** The cron generators abandon last period's open tasks; a triage task (Mike's to release or drop) is never one of them. */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Mock } from 'vitest';

vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    charter: { findUnique: vi.fn() },
    charterGenerationLog: { findUnique: vi.fn() },
    site: { findUnique: vi.fn() },
    maintenanceGenerationLog: { findUnique: vi.fn() },
    task: { findMany: vi.fn() },
    $transaction: vi.fn(),
  },
}));

import { prisma } from '@/lib/db/prisma';
import { generateCharterTasks } from '../charter-generator';
import { generateMaintenanceTasksForSite } from '../maintenance-generator';

const p = prisma as unknown as Record<string, Record<string, Mock> & Mock>;

beforeEach(() => vi.clearAllMocks());

describe('generators leave triage tasks alone', () => {
  it('charter generator: the previous-period filter excludes triage', async () => {
    p.charter.findUnique.mockResolvedValue({ id: 'c', status: 'active', is_deleted: false, client: {}, scheduled_tasks: [{ id: 's', sop_id: 'sop', cadence: 'monthly', sop: {}, charter_ware: null }] });
    p.charterGenerationLog.findUnique.mockResolvedValue(null);
    const txFindMany = vi.fn().mockRejectedValue(new Error('stop'));
    p.$transaction.mockImplementation(async (fn: (tx: unknown) => unknown) => fn({ task: { findMany: txFindMany } }));
    await expect(generateCharterTasks('c')).rejects.toThrow('stop');
    expect(txFindMany.mock.calls[0][0].where.status.notIn).toEqual(expect.arrayContaining(['done', 'abandoned', 'triage']));
  });

  it('maintenance generator: the previous-period filter excludes triage', async () => {
    p.site.findUnique.mockResolvedValue({ id: 'x', is_deleted: false, client: {}, maintenance_plan: { id: 'm', frequency: 'monthly', sops: [] } });
    p.maintenanceGenerationLog.findUnique.mockResolvedValue(null);
    p.task.findMany.mockRejectedValue(new Error('stop'));
    await expect(generateMaintenanceTasksForSite('x')).rejects.toThrow('stop');
    expect(p.task.findMany.mock.calls[0][0].where.status.notIn).toEqual(expect.arrayContaining(['done', 'abandoned', 'triage']));
  });
});

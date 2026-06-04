import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Mock } from 'vitest';

vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    troubadorRun: { findUnique: vi.fn(), update: vi.fn() },
    article: { findMany: vi.fn() },
  },
}));

import { prisma } from '@/lib/db/prisma';
import { recomputeProductionStage } from '../run-stage';

const mockRunFindUnique = prisma.troubadorRun.findUnique as Mock;
const mockRunUpdate = prisma.troubadorRun.update as Mock;
const mockArticleFindMany = prisma.article.findMany as Mock;

const statuses = (...s: string[]) => s.map((status) => ({ status }));

describe('recomputeProductionStage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRunUpdate.mockResolvedValue({});
  });

  it('moves in_production -> publishing when all live articles are approved/scheduled', async () => {
    mockRunFindUnique.mockResolvedValue({ stage: 'in_production' });
    mockArticleFindMany.mockResolvedValue(statuses('approved', 'approved', 'scheduled'));

    await recomputeProductionStage('run-1');

    expect(mockRunUpdate).toHaveBeenCalledWith({
      where: { id: 'run-1' },
      data: { stage: 'publishing' },
    });
  });

  it('keeps/sets in_production while any article is still being written/reviewed', async () => {
    mockRunFindUnique.mockResolvedValue({ stage: 'publishing' });
    mockArticleFindMany.mockResolvedValue(statuses('approved', 'needs_revision'));

    await recomputeProductionStage('run-1');

    expect(mockRunUpdate).toHaveBeenCalledWith({
      where: { id: 'run-1' },
      data: { stage: 'in_production' },
    });
  });

  it('moves to done when every live article is published or postponed', async () => {
    mockRunFindUnique.mockResolvedValue({ stage: 'publishing' });
    mockArticleFindMany.mockResolvedValue(statuses('published', 'published', 'postponed'));

    await recomputeProductionStage('run-1');

    expect(mockRunUpdate).toHaveBeenCalledWith({
      where: { id: 'run-1' },
      data: { stage: 'done' },
    });
  });

  it('does nothing when the run is not in the production phase', async () => {
    mockRunFindUnique.mockResolvedValue({ stage: 'researching' });

    await recomputeProductionStage('run-1');

    expect(mockArticleFindMany).not.toHaveBeenCalled();
    expect(mockRunUpdate).not.toHaveBeenCalled();
  });

  it('does not update when the computed stage already matches', async () => {
    mockRunFindUnique.mockResolvedValue({ stage: 'publishing' });
    mockArticleFindMany.mockResolvedValue(statuses('approved', 'scheduled'));

    await recomputeProductionStage('run-1');

    expect(mockRunUpdate).not.toHaveBeenCalled();
  });
});

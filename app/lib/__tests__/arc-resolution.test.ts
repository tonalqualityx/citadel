import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Mock } from 'vitest';

vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    arc: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
    },
  },
}));

import { prisma } from '@/lib/db/prisma';
import { resolveArc } from '../arc-resolution';
import { ApiError } from '@/lib/api/errors';

const mockFindUnique = prisma.arc.findUnique as Mock;
const mockFindMany = prisma.arc.findMany as Mock;
const mockCreate = prisma.arc.create as Mock;

beforeEach(() => {
  vi.clearAllMocks();
});

describe('resolveArc', () => {
  it('returns null when neither arc_id nor arc_name is given', async () => {
    await expect(resolveArc({})).resolves.toBeNull();
  });

  it('throws 400 when both arc_id and arc_name are given', async () => {
    await expect(resolveArc({ arc_id: 'a1', arc_name: 'Some arc' })).rejects.toMatchObject({
      statusCode: 400,
    });
  });

  it('uses arc_id as-is when the arc exists', async () => {
    mockFindUnique.mockResolvedValue({ id: 'a1', name: 'Existing' });
    await expect(resolveArc({ arc_id: 'a1' })).resolves.toBe('a1');
    expect(mockFindUnique).toHaveBeenCalledWith({ where: { id: 'a1' } });
  });

  it('throws 404 when arc_id does not exist', async () => {
    mockFindUnique.mockResolvedValue(null);
    await expect(resolveArc({ arc_id: 'missing' })).rejects.toMatchObject({ statusCode: 404 });
  });

  it('reuses an existing, non-complete arc by exact name', async () => {
    mockFindMany.mockResolvedValue([
      { id: 'a2', name: 'Reusable', created_at: new Date(), tasks: [{ status: 'in_progress' }] },
    ]);
    await expect(resolveArc({ arc_name: 'Reusable' })).resolves.toBe('a2');
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('skips a complete arc and creates a new one attributed to the origin session', async () => {
    mockFindMany.mockResolvedValue([
      { id: 'a3', name: 'Done arc', created_at: new Date(), tasks: [{ status: 'done' }] },
    ]);
    mockCreate.mockResolvedValue({ id: 'a4' });

    await expect(
      resolveArc({ arc_name: 'Done arc', originSessionExternalId: 'sess-1' })
    ).resolves.toBe('a4');
    // Clarity Phase 7 — id and cover_url are generated (a fresh UUID + a deterministic
    // pool pick keyed by that UUID, see lib/utils/deterministic-cover.ts) rather than
    // fixed values, so this only asserts their shape, not an exact value.
    expect(mockCreate).toHaveBeenCalledWith({
      data: {
        id: expect.stringMatching(/^[0-9a-f-]{36}$/),
        name: 'Done arc',
        origin_session_external_id: 'sess-1',
        cover_url: expect.stringMatching(/^\/covers\/.+\.jpg$/),
      },
    });
  });

  it('creates a new arc with null origin when none is given', async () => {
    mockFindMany.mockResolvedValue([]);
    mockCreate.mockResolvedValue({ id: 'a5' });

    await expect(resolveArc({ arc_name: 'Brand new' })).resolves.toBe('a5');
    expect(mockCreate).toHaveBeenCalledWith({
      data: {
        id: expect.stringMatching(/^[0-9a-f-]{36}$/),
        name: 'Brand new',
        origin_session_external_id: null,
        cover_url: expect.stringMatching(/^\/covers\/.+\.jpg$/),
      },
    });
  });
});

describe('ApiError sanity', () => {
  it('is the error class resolveArc throws', () => {
    expect(new ApiError('x', 404)).toBeInstanceOf(Error);
  });
});

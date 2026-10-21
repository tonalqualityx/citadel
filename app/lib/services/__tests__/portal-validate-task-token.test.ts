import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockFindFirst = vi.fn();
vi.mock('@/lib/db/prisma', () => ({ prisma: { task: { findFirst: (...a: unknown[]) => mockFindFirst(...a) } } }));

import { validateTaskToken } from '@/lib/services/portal';

beforeEach(() => vi.clearAllMocks());

const baseTask = { id: 't1', portal_token_expires_at: null, project: { portal_visibility: 'inherit' } };

describe('validateTaskToken', () => {
  it('loads the project visibility alongside the task', async () => {
    mockFindFirst.mockResolvedValue(baseTask);
    await validateTaskToken('tok');
    expect(mockFindFirst.mock.calls[0][0].include.project).toEqual({
      select: { portal_visibility: true, status: true, is_deleted: true },
    });
  });

  it('returns the task for a visible project and for a project-less task', async () => {
    mockFindFirst.mockResolvedValue(baseTask);
    expect(await validateTaskToken('tok')).toBe(baseTask);
    const noProject = { ...baseTask, project: null };
    mockFindFirst.mockResolvedValue(noProject);
    expect(await validateTaskToken('tok')).toBe(noProject);
  });

  it('rejects (null, so routes 404) a task whose project portal_visibility is hidden', async () => {
    mockFindFirst.mockResolvedValue({ ...baseTask, project: { portal_visibility: 'hidden' } });
    expect(await validateTaskToken('tok')).toBeNull();
  });

  it('rejects a deleted requester so every token route 404s', async () => {
    mockFindFirst.mockResolvedValue({ ...baseTask, requested_by_contact: { id: 'k1', is_deleted: true } });
    expect(await validateTaskToken('tok')).toBeNull();
    const live = { ...baseTask, requested_by_contact: { id: 'k1', is_deleted: false } };
    mockFindFirst.mockResolvedValue(live);
    expect(await validateTaskToken('tok')).toBe(live);
  });

  it.each(['quote', 'queue', 'suspended', 'cancelled'])('rejects a task whose project status is %s', async (status) => {
    mockFindFirst.mockResolvedValue({ ...baseTask, project: { portal_visibility: 'inherit', status, is_deleted: false } });
    expect(await validateTaskToken('tok')).toBeNull();
  });

  it('rejects a task whose project is deleted, accepts client-visible statuses', async () => {
    mockFindFirst.mockResolvedValue({ ...baseTask, project: { portal_visibility: 'inherit', status: 'in_progress', is_deleted: true } });
    expect(await validateTaskToken('tok')).toBeNull();
    for (const status of ['ready', 'in_progress', 'review', 'done']) {
      const ok = { ...baseTask, project: { portal_visibility: 'inherit', status, is_deleted: false } };
      mockFindFirst.mockResolvedValue(ok);
      expect(await validateTaskToken('tok')).toBe(ok);
    }
  });

  it('still rejects an expired token', async () => {
    mockFindFirst.mockResolvedValue({ ...baseTask, portal_token_expires_at: new Date(Date.now() - 1000) });
    expect(await validateTaskToken('tok')).toBeNull();
  });
});

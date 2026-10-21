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
    expect(mockFindFirst.mock.calls[0][0].include.project).toEqual({ select: { portal_visibility: true } });
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

  it('still rejects an expired token', async () => {
    mockFindFirst.mockResolvedValue({ ...baseTask, portal_token_expires_at: new Date(Date.now() - 1000) });
    expect(await validateTaskToken('tok')).toBeNull();
  });
});

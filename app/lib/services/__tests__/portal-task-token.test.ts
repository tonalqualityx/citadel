import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    task: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
  },
}));

import { ensureTaskPortalToken } from '../portal';
import { prisma } from '@/lib/db/prisma';
import type { Mock } from 'vitest';

const mockFindUnique = prisma.task.findUnique as Mock;
const mockUpdate = prisma.task.update as Mock;

describe('ensureTaskPortalToken', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.NEXT_PUBLIC_APP_URL;
  });

  it('mints a fresh token when the task has none and returns the public URL', async () => {
    mockFindUnique.mockResolvedValue({
      id: 'task-1',
      is_deleted: false,
      portal_token: null,
      portal_token_expires_at: null,
    });
    mockUpdate.mockResolvedValue({});

    const result = await ensureTaskPortalToken('task-1');

    expect(result).not.toBeNull();
    expect(result!.token).toMatch(/^[0-9a-f]{128}$/);
    expect(result!.url).toBe(`http://localhost:3000/portal/task-approval/${result!.token}`);
    expect(result!.expiresAt).toBeInstanceOf(Date);
    expect(mockUpdate).toHaveBeenCalledWith({
      where: { id: 'task-1' },
      data: expect.objectContaining({ portal_token: result!.token }),
    });
  });

  it('reuses an existing unexpired token without minting a new one', async () => {
    const future = new Date(Date.now() + 86400000);
    mockFindUnique.mockResolvedValue({
      id: 'task-1',
      is_deleted: false,
      portal_token: 'existing-token',
      portal_token_expires_at: future,
    });

    const result = await ensureTaskPortalToken('task-1');

    expect(result!.token).toBe('existing-token');
    expect(result!.url).toContain('/portal/task-approval/existing-token');
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('re-mints when the existing token is expired', async () => {
    mockFindUnique.mockResolvedValue({
      id: 'task-1',
      is_deleted: false,
      portal_token: 'old-token',
      portal_token_expires_at: new Date(Date.now() - 1000),
    });
    mockUpdate.mockResolvedValue({});

    const result = await ensureTaskPortalToken('task-1');

    expect(result!.token).not.toBe('old-token');
    expect(mockUpdate).toHaveBeenCalled();
  });

  it('honors NEXT_PUBLIC_APP_URL for the public URL', async () => {
    process.env.NEXT_PUBLIC_APP_URL = 'https://citadel.becomeindelible.com';
    mockFindUnique.mockResolvedValue({
      id: 'task-1',
      is_deleted: false,
      portal_token: 'tok',
      portal_token_expires_at: new Date(Date.now() + 86400000),
    });

    const result = await ensureTaskPortalToken('task-1');

    expect(result!.url).toBe('https://citadel.becomeindelible.com/portal/task-approval/tok');
  });

  it('returns null for a missing or deleted task', async () => {
    mockFindUnique.mockResolvedValue(null);
    expect(await ensureTaskPortalToken('nope')).toBeNull();

    mockFindUnique.mockResolvedValue({ id: 'task-1', is_deleted: true, portal_token: null, portal_token_expires_at: null });
    expect(await ensureTaskPortalToken('task-1')).toBeNull();
  });
});

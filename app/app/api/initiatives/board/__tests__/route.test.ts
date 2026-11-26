import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Mock } from 'vitest';

vi.mock('@/lib/auth/middleware', () => ({ requireAuth: vi.fn() }));
vi.mock('@/lib/initiatives/board', () => ({ loadInitiativeBoard: vi.fn() }));

import { requireAuth } from '@/lib/auth/middleware';
import { loadInitiativeBoard } from '@/lib/initiatives/board';
import { ApiError } from '@/lib/api/errors';
import { GET } from '../route';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('GET /api/initiatives/board', () => {
  it('answers the board for a signed-in user', async () => {
    (requireAuth as Mock).mockResolvedValue({ userId: 'u', role: 'admin' });
    const board = { quarter: '2026-Q4', summary: {}, focus_id: null, initiatives: [] };
    (loadInitiativeBoard as Mock).mockResolvedValue(board);
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(board);
  });

  it('refuses without a session', async () => {
    (requireAuth as Mock).mockRejectedValue(new ApiError('Unauthorized', 401));
    const res = await GET();
    expect(res.status).toBe(401);
    expect(loadInitiativeBoard).not.toHaveBeenCalled();
  });
});

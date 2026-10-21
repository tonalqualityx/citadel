import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GET } from '../route';
import { MIKE_USER_ID } from '@/lib/waits/owner';

vi.mock('@/lib/auth/middleware', () => ({ requireAuth: vi.fn() }));
vi.mock('@/lib/db/prisma', () => ({ prisma: {} }));
vi.mock('@/lib/waits/load-blocks', () => ({ loadRitualBlocks: vi.fn() }));

import { requireAuth } from '@/lib/auth/middleware';
import { loadRitualBlocks } from '@/lib/waits/load-blocks';
import { AuthError } from '@/lib/api/errors';
import type { Mock } from 'vitest';

const row = (i: number) => ({ id: `w${i}`, title: `T${i}` });

beforeEach(() => {
  vi.clearAllMocks();
  (requireAuth as Mock).mockResolvedValue({ userId: MIKE_USER_ID, role: 'admin', email: 'mike@becomeindelible.com' });
});

describe('GET /api/waits/mine', () => {
  it('returns the three blocks and the ritual summary for the signed-in user', async () => {
    (loadRitualBlocks as Mock).mockResolvedValue({
      blocking_today: { rows: [row(1), row(2), row(3), row(4), row(5)], more: 3, total: 8, overflow: [row(6)] },
      due_this_week: { rows: [], more: 0, total: 0 },
      admin: { rows: [], more: 0, total: 0 },
      generated_at: '2026-10-21T14:00:00.000Z',
    });
    const res = await GET();
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.summary).toBe('5 blocking a client, 3 more behind them.');
    expect(json.blocking_today.rows).toHaveLength(5);
    expect((loadRitualBlocks as Mock).mock.calls[0][1]).toBe(MIKE_USER_ID);
  });

  it('requires authentication', async () => {
    (requireAuth as Mock).mockRejectedValue(new AuthError('Authentication required', 401));
    expect((await GET()).status).toBe(401);
  });
});

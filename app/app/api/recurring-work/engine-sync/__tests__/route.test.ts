import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Mock } from 'vitest';
import { POST } from '../route';

vi.mock('@/lib/auth/middleware', () => ({ requireAuth: vi.fn(), requireRole: vi.fn() }));
vi.mock('@/lib/recurring-work/engine-sync', () => ({ syncEngineRows: vi.fn() }));

import { requireAuth, requireRole } from '@/lib/auth/middleware';
import { syncEngineRows } from '@/lib/recurring-work/engine-sync';
import { ApiError } from '@/lib/api/errors';

beforeEach(() => {
  vi.clearAllMocks();
  (requireAuth as Mock).mockResolvedValue({ userId: 'u1', email: 'b@x.com', role: 'pm' });
  (requireRole as Mock).mockReturnValue(undefined);
  (syncEngineRows as Mock).mockResolvedValue({ created: 2, updated: 1, deactivated: 0, unchanged: 5, total: 8 });
});

describe('POST /api/recurring-work/engine-sync', () => {
  it('requires pm or admin and passes the result through', async () => {
    const res = await POST();
    expect(requireRole).toHaveBeenCalledWith(expect.anything(), ['pm', 'admin']);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ created: 2, updated: 1, deactivated: 0, unchanged: 5, total: 8 });
  });

  it('rejects an unauthenticated caller without syncing', async () => {
    (requireAuth as Mock).mockRejectedValue(new ApiError('Unauthorized', 401));
    const res = await POST();
    expect(res.status).toBe(401);
    expect(syncEngineRows).not.toHaveBeenCalled();
  });

  it('rejects a wrong role without syncing', async () => {
    (requireRole as Mock).mockImplementation(() => { throw new ApiError('Forbidden', 403); });
    const res = await POST();
    expect(res.status).toBe(403);
    expect(syncEngineRows).not.toHaveBeenCalled();
  });
});

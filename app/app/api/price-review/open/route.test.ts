import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { POST } from './route';

vi.mock('@/lib/auth/middleware', () => ({ requireAuth: vi.fn(), requireRole: vi.fn() }));
vi.mock('@/lib/db/prisma', () => ({ prisma: {} }));
vi.mock('@/lib/price-review/open', () => ({
  openPriceReviews: vi.fn(async (_db: unknown, opts: { dryRun?: boolean }) => ({ dry_run: !!opts.dryRun, opened: [] })),
}));

import { requireAuth, requireRole } from '@/lib/auth/middleware';
import { openPriceReviews } from '@/lib/price-review/open';
import { AuthError } from '@/lib/api/errors';
import type { Mock } from 'vitest';

const post = (qs = '') => POST(new NextRequest(`http://localhost/api/price-review/open${qs}`, { method: 'POST' }));

beforeEach(() => {
  vi.clearAllMocks();
  (requireAuth as Mock).mockResolvedValue({ userId: 'u1', role: 'admin', email: 'a@example.com' });
  (requireRole as Mock).mockImplementation(() => {});
});

describe('POST /api/price-review/open', () => {
  it('needs a session', async () => {
    (requireAuth as Mock).mockRejectedValue(new AuthError('Authentication required', 401));
    expect((await post()).status).toBe(401);
    expect(openPriceReviews).not.toHaveBeenCalled();
  });

  it('is staff only', async () => {
    (requireRole as Mock).mockImplementation(() => {
      throw new AuthError('Insufficient permissions', 403);
    });
    expect((await post()).status).toBe(403);
    expect(openPriceReviews).not.toHaveBeenCalled();
  });

  it('passes dry_run=1 through and nothing else turns it on', async () => {
    expect((await (await post('?dry_run=1')).json()).dry_run).toBe(true);
    expect((await (await post()).json()).dry_run).toBe(false);
    expect((await (await post('?dry_run=true')).json()).dry_run).toBe(false);
  });
});

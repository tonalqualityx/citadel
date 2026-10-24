import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { POST } from '../route';
import { MemStore } from '@/lib/waits/testing-mem-store';
import { MIKE_USER_ID } from '@/lib/waits/owner';

const store = new MemStore();

vi.mock('@/lib/auth/middleware', () => ({ requireAuth: vi.fn(), requireRole: vi.fn() }));
vi.mock('@/lib/waits/prisma-store', () => ({ prismaSweepStore: () => store }));
vi.mock('@/lib/services/slack-notifications', () => ({ sendSlackNotification: vi.fn(async () => true) }));
vi.mock('@/lib/price-review/open', () => ({ openPriceReviews: vi.fn() }));
vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    user: { findUnique: vi.fn(async () => ({ is_active: true })) },
    function: { findUnique: vi.fn(async () => null) },
    projectTeamAssignment: { findMany: vi.fn(async () => []) },
    accord: { findUnique: vi.fn(async () => null) },
  },
}));

import { requireAuth, requireRole } from '@/lib/auth/middleware';
import { openPriceReviews } from '@/lib/price-review/open';
import type { Mock } from 'vitest';

const post = (qs = '') => POST(new NextRequest(`http://localhost/api/waits/sweep${qs}`, { method: 'POST' }));

beforeEach(() => {
  vi.clearAllMocks();
  store.waits.clear();
  store.events.length = 0;
  (requireAuth as Mock).mockResolvedValue({ userId: MIKE_USER_ID, role: 'admin', email: 'mike@becomeindelible.com' });
  (requireRole as Mock).mockImplementation(() => {});
  (openPriceReviews as Mock).mockResolvedValue({ dry_run: false, opened: [], already_open: [], not_yet: [], stale_waits: [], note: '' });
});
afterEach(() => {
  delete process.env.PRICE_REVIEW_SEND;
});

describe('the sweep opens price reviews first', () => {
  it('opens for real on a real pass and only reports on a dry run', async () => {
    await post();
    expect((openPriceReviews as Mock).mock.calls[0][1]).toEqual({ dryRun: false });
    await post('?dry_run=1');
    expect((openPriceReviews as Mock).mock.calls[1][1]).toEqual({ dryRun: true });
  });

  it('puts the opener report in the sweep JSON', async () => {
    const body = await (await post('?dry_run=1')).json();
    expect(body.price_review).toMatchObject({ opened: [] });
    expect(body.dry_run).toBe(true);
  });

  it('a failing opener never stops the sweep', async () => {
    (openPriceReviews as Mock).mockRejectedValue(new Error('db down'));
    const res = await post();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.price_review).toEqual({ error: 'db down' });
    expect(body.counts).toBeDefined();
  });
});

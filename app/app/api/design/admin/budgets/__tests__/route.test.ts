import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { GET } from '../route';
import { signIn, anonymous, DESIGNER_ID } from '@/lib/design/__tests__/route-test-kit';

vi.mock('@/lib/auth/middleware', () => ({ requireAuth: vi.fn() }));
vi.mock('@/lib/db/prisma', () => ({
  prisma: { user: { findUnique: vi.fn(), findMany: vi.fn() }, designBudget: { findMany: vi.fn() }, designPortalSettings: { findUnique: vi.fn() } },
}));
vi.mock('@/lib/design/budget', async (orig) => ({ ...(await orig<typeof import('@/lib/design/budget')>()), monthSpend: vi.fn() }));

import { requireAuth } from '@/lib/auth/middleware';
import { prisma } from '@/lib/db/prisma';
import { monthSpend } from '@/lib/design/budget';

const auth = requireAuth as Mock;
const userFind = prisma.user.findUnique as Mock;
const call = () => GET();
const dec = (n: number) => ({ toString: () => String(n) });

beforeEach(() => {
  vi.clearAllMocks();
  signIn(auth, userFind, 'admin');
  (prisma.user.findMany as Mock).mockResolvedValue([{ id: DESIGNER_ID, name: 'Dee' }]);
  (prisma.designBudget.findMany as Mock).mockResolvedValue([{ user_id: DESIGNER_ID, monthly_cap_usd: dec(300), session_raise_cap_usd: null }]);
  (prisma.designPortalSettings.findUnique as Mock).mockResolvedValue(null);
  (monthSpend as Mock).mockResolvedValue(42.5);
});

describe('GET /api/design/admin/budgets', () => {
  it('lists each designer with caps and this month\'s spend', async () => {
    const res = await call();
    expect(res.status).toBe(200);
    expect((await res.json()).budgets).toEqual([
      { user: { id: DESIGNER_ID, name: 'Dee' }, monthly_cap_usd: 300, session_raise_cap_usd: null, effective_session_raise_cap_usd: 50, month_spend_usd: 42.5 },
    ]);
  });
  it('anonymous 401; designer, pm 403; API key 403', async () => {
    anonymous(auth);
    expect((await call()).status).toBe(401);
    for (const role of ['designer', 'pm'] as const) { signIn(auth, userFind, role); expect((await call()).status).toBe(403); }
    signIn(auth, userFind, 'admin', { via: 'api_key' });
    expect((await call()).status).toBe(403);
  });
});

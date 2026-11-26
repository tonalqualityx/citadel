import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import type { Mock } from 'vitest';

vi.mock('@/lib/auth/middleware', () => ({ requireAuth: vi.fn() }));
vi.mock('@/lib/db/prisma', () => ({ prisma: { charter: { findFirst: vi.fn() } } }));
vi.mock('@/lib/retainer-months/service', () => ({ charterMonths: vi.fn() }));

import { requireAuth } from '@/lib/auth/middleware';
import { prisma } from '@/lib/db/prisma';
import { charterMonths } from '@/lib/retainer-months/service';
import { GET } from '../route';

const ID = '11111111-1111-4111-8111-111111111111';
const ctx = { params: Promise.resolve({ id: ID }) };
const req = () => new NextRequest(`http://localhost/api/charters/${ID}/retainer-months`);

beforeEach(() => {
  vi.clearAllMocks();
  (requireAuth as Mock).mockResolvedValue({ userId: 'u', role: 'admin' });
});

describe('GET /api/charters/[id]/retainer-months', () => {
  it('returns the current month and past lines as data', async () => {
    (prisma.charter.findFirst as Mock).mockResolvedValue({ id: ID, billing_period: 'monthly' });
    (charterMonths as Mock).mockResolvedValue({ current: { id: 'm' }, upcoming: { id: 'n', state: 'planning' }, past: [{ month: '2026-11', hours_allotted: 10, used_minutes: 690, outside_minutes: 180 }] });
    const res = await GET(req(), ctx);
    expect(await res.json()).toEqual({
      charter_id: ID, billing_period: 'monthly', current: { id: 'm' }, upcoming: { id: 'n', state: 'planning' },
      past: [{ month: '2026-11', hours_allotted: 10, used_minutes: 690, outside_minutes: 180 }],
    });
  });
  it('404s for an unknown charter', async () => {
    (prisma.charter.findFirst as Mock).mockResolvedValue(null);
    expect((await GET(req(), ctx)).status).toBe(404);
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import type { Mock } from 'vitest';
import { GET, POST } from '../route';

vi.mock('@/lib/auth/middleware', () => ({
  requireAuth: vi.fn(),
  requireRole: vi.fn(),
}));

vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    cronChipState: {
      findMany: vi.fn(),
      upsert: vi.fn(),
    },
    userPreference: {
      findUnique: vi.fn(),
    },
  },
}));

import { requireAuth, requireRole } from '@/lib/auth/middleware';
import { prisma } from '@/lib/db/prisma';

const mockRequireAuth = vi.mocked(requireAuth);
const mockRequireRole = vi.mocked(requireRole);
const mockFindMany = prisma.cronChipState.findMany as Mock;
const mockUpsert = prisma.cronChipState.upsert as Mock;
const mockUserPreferenceFindUnique = prisma.userPreference.findUnique as Mock;

function postReq(body: object): NextRequest {
  return new NextRequest('http://localhost:3000/api/oracle/cron-chips', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockRequireAuth.mockResolvedValue({ userId: 'user-1', role: 'admin', email: 'admin@example.com' });
  mockRequireRole.mockImplementation(() => {});
  mockUserPreferenceFindUnique.mockResolvedValue(null);
});

describe('GET /api/oracle/cron-chips', () => {
  it('returns every saved chip state', async () => {
    mockFindMany.mockResolvedValue([
      { cron_key: 'nexus::email-check', snoozed_until: null, dismissed_reason: 'boom' },
    ]);

    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.states).toHaveLength(1);
  });
});

describe('POST /api/oracle/cron-chips', () => {
  it('snoozing sets snoozed_until to the start of the next local day and clears dismiss', async () => {
    mockUpsert.mockResolvedValue({
      cron_key: 'nexus::email-check',
      snoozed_until: new Date('2026-07-28T00:00:00.000Z'),
      dismissed_reason: null,
    });

    const res = await POST(postReq({ cron_key: 'nexus::email-check', action: 'snooze' }));
    expect(res.status).toBe(200);
    expect(mockUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { cron_key: 'nexus::email-check' },
        create: expect.objectContaining({ cron_key: 'nexus::email-check', dismissed_reason: null }),
        update: expect.objectContaining({ dismissed_reason: null }),
      })
    );
  });

  it('dismissing stores the given reason and clears snooze', async () => {
    mockUpsert.mockResolvedValue({
      cron_key: 'nexus::email-check',
      snoozed_until: null,
      dismissed_reason: 'boom',
    });

    const res = await POST(postReq({ cron_key: 'nexus::email-check', action: 'dismiss', reason: 'boom' }));
    expect(res.status).toBe(200);
    expect(mockUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: { dismissed_reason: 'boom', snoozed_until: null },
      })
    );
  });

  it('rejects dismiss with no reason', async () => {
    const res = await POST(postReq({ cron_key: 'nexus::email-check', action: 'dismiss' }));
    expect(res.status).toBe(400);
    expect(mockUpsert).not.toHaveBeenCalled();
  });

  it('requires admin role', async () => {
    mockRequireRole.mockImplementation(() => {
      throw new Error('Forbidden');
    });

    await expect(POST(postReq({ cron_key: 'x', action: 'snooze' }))).resolves.toBeDefined();
    expect(mockUpsert).not.toHaveBeenCalled();
  });
});

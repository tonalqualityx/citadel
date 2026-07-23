import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import type { Mock } from 'vitest';
import { GET } from '../route';

// Clarity Phase 4b — GET /api/email-asks: the machine-side classifier's read for pending
// archive intents (state=archive_requested), plus general state/account filtering.

vi.mock('@/lib/auth/middleware', () => ({
  requireAuth: vi.fn(),
}));

vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    emailAsk: {
      findMany: vi.fn(),
    },
  },
}));

import { requireAuth } from '@/lib/auth/middleware';
import { prisma } from '@/lib/db/prisma';

const mockRequireAuth = vi.mocked(requireAuth);
const mockFindMany = prisma.emailAsk.findMany as Mock;

function ask(overrides: Record<string, unknown> = {}) {
  return {
    id: 'ask-1',
    message_id: 'msg-1',
    thread_id: null,
    account: 'mike@becomeindelible.com',
    from_name: null,
    from_email: 'client@herba.com',
    subject: 'Site is down',
    gist: null,
    queue: null,
    severity: null,
    is_urgent: false,
    state: 'archive_requested',
    training_note: null,
    task_id: null,
    deep_link: 'https://mail.google.com/mail/u/0/#inbox/msg-1',
    received_at: new Date('2026-07-21T20:00:00.000Z'),
    created_at: new Date(),
    updated_at: new Date(),
    ...overrides,
  };
}

function getRequest(params: Record<string, string> = {}): NextRequest {
  const searchParams = new URLSearchParams(params);
  return new NextRequest(`http://localhost:3000/api/email-asks?${searchParams.toString()}`);
}

beforeEach(() => {
  vi.clearAllMocks();
  mockRequireAuth.mockResolvedValue({ userId: 'user-123', role: 'admin', email: 'admin@example.com' });
  mockFindMany.mockResolvedValue([]);
});

describe('GET /api/email-asks', () => {
  it('requires auth', async () => {
    const { AuthError } = await import('@/lib/api/errors');
    mockRequireAuth.mockRejectedValue(new AuthError('Unauthorized', 401));

    const res = await GET(getRequest());
    expect(res.status).toBe(401);
  });

  it('returns every ask when no filters are given', async () => {
    mockFindMany.mockResolvedValue([ask({ id: 'a1' }), ask({ id: 'a2' })]);

    const res = await GET(getRequest());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.asks.map((a: { id: string }) => a.id)).toEqual(['a1', 'a2']);
    expect(body.meta.total).toBe(2);
    expect(mockFindMany).toHaveBeenCalledWith({
      where: {},
      orderBy: { received_at: 'desc' },
    });
  });

  it('filters by state=archive_requested — the classifier\'s pending-archive read', async () => {
    mockFindMany.mockResolvedValue([ask({ id: 'a1', state: 'archive_requested' })]);

    const res = await GET(getRequest({ state: 'archive_requested' }));
    expect(res.status).toBe(200);
    expect(mockFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { state: 'archive_requested' } })
    );
  });

  it('filters by account', async () => {
    mockFindMany.mockResolvedValue([]);

    await GET(getRequest({ account: 'mike@whoismikedion.com' }));
    expect(mockFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { account: 'mike@whoismikedion.com' } })
    );
  });

  it('filters by both state and account together', async () => {
    mockFindMany.mockResolvedValue([]);

    await GET(getRequest({ state: 'archive_requested', account: 'mike@becomeindelible.com' }));
    expect(mockFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { state: 'archive_requested', account: 'mike@becomeindelible.com' },
      })
    );
  });

  it('rejects an invalid state value', async () => {
    const res = await GET(getRequest({ state: 'not-a-real-state' }));
    expect(res.status).toBe(400);
  });

  it('includes training_note in the response shape', async () => {
    mockFindMany.mockResolvedValue([ask({ id: 'a1', training_note: 'this was actually noise' })]);

    const res = await GET(getRequest());
    const body = await res.json();
    expect(body.asks[0].training_note).toBe('this was actually noise');
  });

  describe('Clarity Phase 6 — calendar_requested filter', () => {
    it('filters by calendar_requested=true — the machine-side calendar executor\'s read', async () => {
      mockFindMany.mockResolvedValue([ask({ id: 'a1', calendar_requested: true })]);

      const res = await GET(getRequest({ calendar_requested: 'true' }));
      expect(res.status).toBe(200);
      expect(mockFindMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { calendar_requested: true } })
      );
    });

    it('combines calendar_requested with state/account filters', async () => {
      mockFindMany.mockResolvedValue([]);

      await GET(getRequest({ calendar_requested: 'true', account: 'mike@whoismikedion.com' }));
      expect(mockFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { account: 'mike@whoismikedion.com', calendar_requested: true },
        })
      );
    });

    it('rejects an invalid calendar_requested value (only "true" is accepted)', async () => {
      const res = await GET(getRequest({ calendar_requested: 'false' }));
      expect(res.status).toBe(400);
    });

    it('includes the new Phase 6 fields in the response shape', async () => {
      mockFindMany.mockResolvedValue([
        ask({
          id: 'a1',
          intent: 'meeting',
          proposed_event_at: new Date('2026-07-24T19:30:00.000Z'),
          proposed_event_title: 'Kickoff call',
          proposed_event_minutes: 30,
          calendar_requested: true,
          calendar_event_id: 'gcal-1',
        }),
      ]);

      const res = await GET(getRequest());
      const body = await res.json();
      expect(body.asks[0]).toMatchObject({
        intent: 'meeting',
        proposed_event_title: 'Kickoff call',
        proposed_event_minutes: 30,
        calendar_requested: true,
        calendar_event_id: 'gcal-1',
      });
    });
  });
});

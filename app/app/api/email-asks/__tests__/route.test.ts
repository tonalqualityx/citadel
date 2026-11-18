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
      count: vi.fn(),
    },
  },
}));

import { requireAuth } from '@/lib/auth/middleware';
import { prisma } from '@/lib/db/prisma';

const mockRequireAuth = vi.mocked(requireAuth);
const mockFindMany = prisma.emailAsk.findMany as Mock;
const mockCount = prisma.emailAsk.count as Mock;

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
  mockCount.mockResolvedValue(0);
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
  describe('paging and search (the chat owed-email list)', () => {
    it('does not count or reorder when no limit or offset is given', async () => {
      mockFindMany.mockResolvedValue([ask({ id: 'a1' })]);
      const body = await (await GET(getRequest({ state: 'open' }))).json();
      expect(mockCount).not.toHaveBeenCalled();
      expect(body.meta).toEqual({ total: 1, offset: 0, returned: 1, remaining: 0 });
    });

    it('pages with limit and offset, a stable order, and the full matching total', async () => {
      mockFindMany.mockResolvedValue([ask({ id: 'a21' }), ask({ id: 'a22' })]);
      mockCount.mockResolvedValue(284);
      const res = await GET(getRequest({ state: 'open', limit: '20', offset: '20' }));
      const body = await res.json();
      expect(res.status).toBe(200);
      expect(mockFindMany).toHaveBeenCalledWith({
        where: { state: 'open' },
        orderBy: [{ received_at: 'desc' }, { id: 'desc' }],
        take: 20,
        skip: 20,
      });
      expect(mockCount).toHaveBeenCalledWith({ where: { state: 'open' } });
      expect(body.meta).toEqual({ total: 284, offset: 20, returned: 2, remaining: 262 });
    });

    it('filters by sender name or address, subject words and a received range', async () => {
      await GET(
        getRequest({
          state: 'open',
          limit: '10',
          from: 'Wargo',
          subject: 'newsletter  email',
          received_after: '2026-11-10',
          received_before: '2026-11-11',
        })
      );
      expect(mockFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            state: 'open',
            received_at: { gte: new Date('2026-11-10T00:00:00.000Z'), lt: new Date('2026-11-11T00:00:00.000Z') },
            OR: [
              { from_name: { contains: 'Wargo', mode: 'insensitive' } },
              { from_email: { contains: 'Wargo', mode: 'insensitive' } },
            ],
            AND: [
              { subject: { contains: 'newsletter', mode: 'insensitive' } },
              { subject: { contains: 'email', mode: 'insensitive' } },
            ],
          },
        })
      );
    });

    it('rejects a bad offset or date', async () => {
      expect((await GET(getRequest({ offset: '-1' }))).status).toBe(400);
      expect((await GET(getRequest({ received_after: 'not a date' }))).status).toBe(400);
    });
  });
});

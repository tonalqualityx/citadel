import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import type { Mock } from 'vitest';
import { POST } from '../route';

vi.mock('@/lib/auth/middleware', () => ({
  requireAuth: vi.fn(),
}));

vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    calendarEvent: {
      upsert: vi.fn(),
      deleteMany: vi.fn(),
    },
  },
}));

import { requireAuth } from '@/lib/auth/middleware';
import { prisma } from '@/lib/db/prisma';

const mockRequireAuth = vi.mocked(requireAuth);
const mockUpsert = prisma.calendarEvent.upsert as Mock;
const mockDeleteMany = prisma.calendarEvent.deleteMany as Mock;

function postRequest(body: unknown): NextRequest {
  return new NextRequest('http://localhost:3000/api/oracle/calendar-sync', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer test-key' },
  });
}

const WINDOW_START = '2026-07-21T00:00:00.000Z';
const WINDOW_END = '2026-07-28T00:00:00.000Z';

beforeEach(() => {
  vi.clearAllMocks();
  mockRequireAuth.mockResolvedValue({ userId: 'user-123', role: 'admin', email: 'mike@becomeindelible.com' });
  mockUpsert.mockResolvedValue({});
  mockDeleteMany.mockResolvedValue({ count: 0 });
});

describe('POST /api/oracle/calendar-sync', () => {
  it('upserts each event by event_id and prunes within the window', async () => {
    mockDeleteMany.mockResolvedValue({ count: 2 });

    const res = await POST(
      postRequest({
        window_start: WINDOW_START,
        window_end: WINDOW_END,
        events: [
          {
            event_id: 'evt-1',
            title: 'Being Nerds at BRIC',
            starts_at: '2026-07-21T13:00:00.000Z',
            ends_at: '2026-07-21T21:05:00.000Z',
          },
          {
            event_id: 'evt-2',
            title: 'Get the boys',
            starts_at: '2026-07-21T20:30:00.000Z',
            ends_at: '2026-07-21T21:50:00.000Z',
          },
        ],
      })
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.upserted).toBe(2);
    expect(body.pruned).toBe(2);
    expect(mockUpsert).toHaveBeenCalledTimes(2);
    expect(mockUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { event_id: 'evt-1' },
        create: expect.objectContaining({ event_id: 'evt-1', title: 'Being Nerds at BRIC', all_day: false }),
        update: expect.objectContaining({ title: 'Being Nerds at BRIC' }),
      })
    );
    expect(mockDeleteMany).toHaveBeenCalledWith({
      where: {
        starts_at: { gte: new Date(WINDOW_START), lte: new Date(WINDOW_END) },
        event_id: { notIn: ['evt-1', 'evt-2'] },
      },
    });
  });

  it('deletes every row in the window when events is empty (all cancelled)', async () => {
    mockDeleteMany.mockResolvedValue({ count: 5 });

    const res = await POST(
      postRequest({ window_start: WINDOW_START, window_end: WINDOW_END, events: [] })
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.upserted).toBe(0);
    expect(body.pruned).toBe(5);
    expect(mockDeleteMany).toHaveBeenCalledWith({
      where: {
        starts_at: { gte: new Date(WINDOW_START), lte: new Date(WINDOW_END) },
        event_id: { notIn: [] },
      },
    });
  });

  it('defaults all_day to false when omitted', async () => {
    await POST(
      postRequest({
        window_start: WINDOW_START,
        window_end: WINDOW_END,
        events: [
          {
            event_id: 'evt-3',
            title: 'Home',
            starts_at: '2026-07-21T00:00:00.000Z',
            ends_at: '2026-07-22T00:00:00.000Z',
            all_day: true,
          },
        ],
      })
    );

    expect(mockUpsert).toHaveBeenCalledWith(
      expect.objectContaining({ create: expect.objectContaining({ all_day: true }) })
    );
  });

  it('rejects a missing window_start/window_end', async () => {
    const res = await POST(postRequest({ events: [] }));
    expect(res.status).toBe(400);
  });

  it('rejects window_start after window_end', async () => {
    const res = await POST(
      postRequest({ window_start: WINDOW_END, window_end: WINDOW_START, events: [] })
    );
    expect(res.status).toBe(400);
  });

  it('rejects an event missing required fields', async () => {
    const res = await POST(
      postRequest({
        window_start: WINDOW_START,
        window_end: WINDOW_END,
        events: [{ event_id: 'evt-1' }],
      })
    );
    expect(res.status).toBe(400);
  });

  it('caps events at 500', async () => {
    const events = Array.from({ length: 501 }, (_, i) => ({
      event_id: `evt-${i}`,
      title: 'Event',
      starts_at: '2026-07-21T13:00:00.000Z',
      ends_at: '2026-07-21T14:00:00.000Z',
    }));

    const res = await POST(
      postRequest({ window_start: WINDOW_START, window_end: WINDOW_END, events })
    );
    expect(res.status).toBe(400);
  });

  it('rejects when unauthenticated', async () => {
    const { AuthError } = await import('@/lib/api/errors');
    mockRequireAuth.mockRejectedValue(new AuthError('Authentication required', 401));

    const res = await POST(
      postRequest({ window_start: WINDOW_START, window_end: WINDOW_END, events: [] })
    );
    expect(res.status).toBe(401);
  });
});

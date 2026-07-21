import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import type { Mock } from 'vitest';
import { GET } from '../route';

vi.mock('@/lib/auth/middleware', () => ({
  requireAuth: vi.fn(),
  requireRole: vi.fn(),
}));

vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    meeting: {
      findMany: vi.fn(),
    },
    task: {
      findMany: vi.fn(),
    },
  },
}));

import { requireAuth, requireRole } from '@/lib/auth/middleware';
import { prisma } from '@/lib/db/prisma';

const mockRequireAuth = vi.mocked(requireAuth);
const mockRequireRole = vi.mocked(requireRole);
const mockMeetingFindMany = prisma.meeting.findMany as Mock;
const mockTaskFindMany = prisma.task.findMany as Mock;

function createGetRequest(params: Record<string, string> = {}): NextRequest {
  const searchParams = new URLSearchParams(params);
  return new NextRequest(`http://localhost:3000/api/today/calendar?${searchParams.toString()}`);
}

beforeEach(() => {
  vi.clearAllMocks();
  mockRequireAuth.mockResolvedValue({ userId: 'user-123', role: 'admin', email: 'admin@example.com' });
  mockRequireRole.mockImplementation(() => {});
  mockMeetingFindMany.mockResolvedValue([]);
  mockTaskFindMany.mockResolvedValue([]);
});

describe('GET /api/today/calendar', () => {
  it('returns the day meetings with a start/end derived from an assumed duration', async () => {
    mockMeetingFindMany
      .mockResolvedValueOnce([
        { id: 'm1', title: 'Chris — call', meeting_date: new Date('2026-07-21T13:00:00.000Z') },
      ])
      .mockResolvedValueOnce([
        { meeting_date: new Date('2026-07-21T13:00:00.000Z') },
      ]);

    const res = await GET(createGetRequest({ date: '2026-07-21' }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.date).toBe('2026-07-21');
    expect(body.meetings).toHaveLength(1);
    expect(body.meetings[0].title).toBe('Chris — call');
    expect(new Date(body.meetings[0].end).getTime()).toBeGreaterThan(
      new Date(body.meetings[0].start).getTime()
    );
  });

  it('returns a 5-day week strip starting at the requested date, as raw counts (no encoding)', async () => {
    mockMeetingFindMany.mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    mockTaskFindMany.mockResolvedValueOnce([]);

    const res = await GET(createGetRequest({ date: '2026-07-21' }));
    const body = await res.json();

    expect(body.week).toHaveLength(5);
    expect(body.week[0].date).toBe('2026-07-21');
    expect(body.week[4].date).toBe('2026-07-25');
    for (const day of body.week) {
      expect(day).toHaveProperty('meeting_minutes');
      expect(day).toHaveProperty('meetings_count');
      expect(day).toHaveProperty('due_tasks_count');
      expect(day).not.toHaveProperty('packed');
      expect(day).not.toHaveProperty('fill_percent');
    }
  });

  it('defaults to today when no date param is given', async () => {
    const res = await GET(createGetRequest());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('counts due tasks per day within the week window', async () => {
    mockMeetingFindMany.mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    mockTaskFindMany.mockResolvedValueOnce([
      { due_date: new Date('2026-07-22T12:00:00.000Z') },
      { due_date: new Date('2026-07-22T18:00:00.000Z') },
    ]);

    const res = await GET(createGetRequest({ date: '2026-07-21' }));
    const body = await res.json();

    const day22 = body.week.find((d: { date: string }) => d.date === '2026-07-22');
    expect(day22.due_tasks_count).toBe(2);
  });
});

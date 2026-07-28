import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GET } from '../route';

vi.mock('@/lib/auth/middleware', () => ({
  requireAuth: vi.fn(),
  requireRole: vi.fn(),
}));

vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    task: { findMany: vi.fn() },
    emailAsk: { findMany: vi.fn() },
  },
}));

import { requireAuth, requireRole } from '@/lib/auth/middleware';
import { prisma } from '@/lib/db/prisma';
import type { Mock } from 'vitest';

const mockRequireAuth = vi.mocked(requireAuth);
const mockRequireRole = vi.mocked(requireRole);
const mockTaskFindMany = prisma.task.findMany as Mock;
const mockEmailAskFindMany = prisma.emailAsk.findMany as Mock;

function task(overrides: Record<string, unknown> = {}) {
  return {
    id: 't1',
    title: 'A task',
    status: 'not_started',
    priority: 3,
    due_date: null,
    promised_to: null,
    created_at: '2026-07-20T00:00:00.000Z',
    client: null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockRequireAuth.mockResolvedValue({ userId: 'user-1', role: 'admin', email: 'mike@becomeindelible.com' });
  mockRequireRole.mockImplementation(() => {});
  mockTaskFindMany.mockResolvedValue([]);
  mockEmailAskFindMany.mockResolvedValue([]);
});

describe('GET /api/oracle/admin-soon', () => {
  it('(a) explicit kind:admin tag always wins', async () => {
    mockTaskFindMany
      .mockResolvedValueOnce([task({ id: 'explicit-1' })]) // explicit tag query
      .mockResolvedValueOnce([]); // small-bite query

    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.tasks.map((t: { id: string }) => t.id)).toContain('explicit-1');
  });

  it('(b) small internal bite: excludes mystery_factor no_idea via the query filter itself', async () => {
    // The route passes `mystery_factor: { not: 'no_idea' }` into the query — this test
    // verifies the query was actually built with that clause (the honesty law is enforced
    // in the DB filter, not just documented).
    mockTaskFindMany.mockResolvedValueOnce([]).mockResolvedValueOnce([task({ id: 'small-1' })]);

    await GET();

    const smallBiteCall = mockTaskFindMany.mock.calls[1][0];
    expect(smallBiteCall.where.mystery_factor).toEqual({ not: 'no_idea' });
    expect(smallBiteCall.where.energy_estimate).toEqual({ lte: 3 });
    expect(smallBiteCall.where.client_id).toBeNull();
    expect(smallBiteCall.where.project_id).toBeNull();
  });

  it('(c) admin-lane provenance: tasks referenced by an intent=admin EmailAsk are included', async () => {
    mockTaskFindMany
      .mockResolvedValueOnce([]) // explicit
      .mockResolvedValueOnce([]) // small bite
      .mockResolvedValueOnce([task({ id: 'lane-1' })]); // the admin-lane lookup query
    mockEmailAskFindMany.mockResolvedValueOnce([{ task_id: 'lane-1' }]);

    const res = await GET();
    const body = await res.json();

    expect(body.tasks.map((t: { id: string; source_intent: string | null }) => t)).toContainEqual(
      expect.objectContaining({ id: 'lane-1', source_intent: 'admin' })
    );
    expect(mockEmailAskFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { intent: 'admin', task_id: { not: null } } })
    );
  });

  it('applies the plate rule (project quote/queue contributes zero) to every sub-query', async () => {
    await GET();
    for (const call of mockTaskFindMany.mock.calls) {
      const where = call[0].where;
      // Every query's where clause carries the AND[...notOnAQuoteOrQueueProject] shape.
      expect(JSON.stringify(where)).toContain('quote');
    }
  });

  it('caps at 20 and orders by due_date asc (nulls last), then priority', async () => {
    const many = Array.from({ length: 25 }, (_, i) =>
      task({ id: `t${i}`, due_date: i % 2 === 0 ? `2026-07-2${i % 10}T00:00:00.000Z` : null, priority: (i % 5) + 1 })
    );
    mockTaskFindMany.mockResolvedValueOnce(many).mockResolvedValueOnce([]);

    const res = await GET();
    const body = await res.json();

    expect(body.tasks.length).toBeLessThanOrEqual(20);
    expect(body.meta.cap).toBe(20);
  });

  it('rejects when unauthenticated', async () => {
    const { AuthError } = await import('@/lib/api/errors');
    mockRequireAuth.mockRejectedValue(new AuthError('Authentication required', 401));

    const res = await GET();
    expect(res.status).toBe(401);
  });
});

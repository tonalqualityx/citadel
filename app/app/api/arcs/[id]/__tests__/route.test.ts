import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import type { Mock } from 'vitest';
import { GET, PATCH } from '../route';

vi.mock('@/lib/auth/middleware', () => ({
  requireAuth: vi.fn(),
}));

vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    arc: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    client: {
      findUnique: vi.fn(),
    },
    project: {
      findUnique: vi.fn(),
    },
  },
}));

import { requireAuth } from '@/lib/auth/middleware';
import { prisma } from '@/lib/db/prisma';

const mockRequireAuth = vi.mocked(requireAuth);
const mockArcFindUnique = prisma.arc.findUnique as Mock;
const mockArcUpdate = prisma.arc.update as Mock;
const mockClientFindUnique = prisma.client.findUnique as Mock;
const mockProjectFindUnique = prisma.project.findUnique as Mock;

function arc(overrides: Record<string, unknown> = {}) {
  return {
    id: 'arc-1',
    name: 'Arc name',
    description: null,
    client_id: null,
    client: null,
    project_id: null,
    project: null,
    origin_session_external_id: null,
    closed_at: null,
    created_at: new Date(),
    updated_at: new Date(),
    tasks: [],
    ...overrides,
  };
}

function getRequest(): NextRequest {
  return new NextRequest('http://localhost:3000/api/arcs/arc-1');
}

function patchRequest(body: object): NextRequest {
  return new NextRequest('http://localhost:3000/api/arcs/arc-1', {
    method: 'PATCH',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  });
}

const params = Promise.resolve({ id: 'arc-1' });

beforeEach(() => {
  vi.clearAllMocks();
  mockRequireAuth.mockResolvedValue({ userId: 'user-123', role: 'pm', email: 'pm@example.com' });
});

describe('GET /api/arcs/[id]', () => {
  it('returns the arc with its tasks and derived status', async () => {
    mockArcFindUnique.mockResolvedValue(
      arc({ tasks: [{ id: 't1', title: 'Task 1', status: 'in_progress', priority: 2, due_date: null, assignee_id: null, assignee: null }] })
    );

    const res = await GET(getRequest(), { params });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.status).toBe('open');
    expect(body.tasks).toHaveLength(1);
    expect(body.tasks[0].title).toBe('Task 1');
  });

  it('404s when the arc does not exist', async () => {
    mockArcFindUnique.mockResolvedValue(null);
    const res = await GET(getRequest(), { params });
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body.error).toBe('Arc not found');
  });
});

describe('PATCH /api/arcs/[id]', () => {
  beforeEach(() => {
    mockArcFindUnique.mockResolvedValue(arc());
  });

  it('updates name and description', async () => {
    mockArcUpdate.mockResolvedValue(arc({ name: 'Renamed', description: 'New desc' }));

    const res = await PATCH(patchRequest({ name: 'Renamed', description: 'New desc' }), { params });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.name).toBe('Renamed');
    expect(mockArcUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ name: 'Renamed', description: 'New desc' }),
      })
    );
  });

  it('404s when the arc does not exist', async () => {
    mockArcFindUnique.mockResolvedValue(null);
    const res = await PATCH(patchRequest({ name: 'X' }), { params });
    expect(res.status).toBe(404);
  });

  it('setting closed_at closes the thread (status becomes complete even with open tasks)', async () => {
    const closedAt = new Date().toISOString();
    mockArcUpdate.mockResolvedValue(
      arc({ closed_at: new Date(closedAt), tasks: [{ id: 't1', title: 'T', status: 'not_started', priority: 3, due_date: null, assignee_id: null, assignee: null }] })
    );

    const res = await PATCH(patchRequest({ closed_at: closedAt }), { params });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.status).toBe('complete');
    expect(mockArcUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ closed_at: expect.any(Date) }) })
    );
  });

  it('setting closed_at to null reopens the arc', async () => {
    mockArcFindUnique.mockResolvedValue(arc({ closed_at: new Date() }));
    mockArcUpdate.mockResolvedValue(
      arc({ closed_at: null, tasks: [{ id: 't1', title: 'T', status: 'not_started', priority: 3, due_date: null, assignee_id: null, assignee: null }] })
    );

    const res = await PATCH(patchRequest({ closed_at: null }), { params });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.status).toBe('open');
    expect(mockArcUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ closed_at: null }) })
    );
  });

  it('leaves closed_at untouched when absent from the body', async () => {
    mockArcUpdate.mockResolvedValue(arc({ name: 'Renamed' }));

    await PATCH(patchRequest({ name: 'Renamed' }), { params });

    const callArgs = mockArcUpdate.mock.calls[0][0] as { data: Record<string, unknown> };
    expect('closed_at' in callArgs.data).toBe(false);
  });

  it('rejects an invalid client_id (validation failure, not a UUID)', async () => {
    const res = await PATCH(patchRequest({ client_id: 'not-a-uuid' }), { params });
    expect(res.status).toBe(400);
  });

  it('404s when client_id does not exist', async () => {
    mockClientFindUnique.mockResolvedValue(null);
    const res = await PATCH(
      patchRequest({ client_id: '550e8400-e29b-41d4-a716-446655440000' }),
      { params }
    );
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body.error).toBe('Client not found');
  });

  it('404s when project_id does not exist', async () => {
    mockProjectFindUnique.mockResolvedValue(null);
    const res = await PATCH(
      patchRequest({ project_id: '550e8400-e29b-41d4-a716-446655440001' }),
      { params }
    );
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body.error).toBe('Project not found');
  });

  // Clarity Phase 5 — the Soothsayer's snooze action.
  describe('snoozed_until', () => {
    it('sets snoozed_until', async () => {
      const until = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString();
      mockArcUpdate.mockResolvedValue(arc({ snoozed_until: new Date(until) }));

      const res = await PATCH(patchRequest({ snoozed_until: until }), { params });
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.snoozed_until).toBe(new Date(until).toISOString());
      expect(mockArcUpdate).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ snoozed_until: expect.any(Date) }) })
      );
    });

    it('setting snoozed_until to null un-snoozes', async () => {
      mockArcFindUnique.mockResolvedValue(arc({ snoozed_until: new Date() }));
      mockArcUpdate.mockResolvedValue(arc({ snoozed_until: null }));

      const res = await PATCH(patchRequest({ snoozed_until: null }), { params });
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.snoozed_until).toBeNull();
      expect(mockArcUpdate).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ snoozed_until: null }) })
      );
    });

    it('leaves snoozed_until untouched when absent from the body', async () => {
      mockArcUpdate.mockResolvedValue(arc({ name: 'Renamed' }));

      await PATCH(patchRequest({ name: 'Renamed' }), { params });

      const callArgs = mockArcUpdate.mock.calls[0][0] as { data: Record<string, unknown> };
      expect('snoozed_until' in callArgs.data).toBe(false);
    });

    it('rejects an invalid snoozed_until (not ISO-8601)', async () => {
      const res = await PATCH(patchRequest({ snoozed_until: 'not-a-date' }), { params });
      expect(res.status).toBe(400);
    });
  });
});

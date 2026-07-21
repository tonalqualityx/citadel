import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import type { Mock } from 'vitest';
import { GET, POST } from '../route';

vi.mock('@/lib/auth/middleware', () => ({
  requireAuth: vi.fn(),
}));

vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    arc: {
      findMany: vi.fn(),
      create: vi.fn(),
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
const mockArcFindMany = prisma.arc.findMany as Mock;
const mockArcCreate = prisma.arc.create as Mock;
const mockClientFindUnique = prisma.client.findUnique as Mock;
const mockProjectFindUnique = prisma.project.findUnique as Mock;

function createGetRequest(params: Record<string, string> = {}): NextRequest {
  const searchParams = new URLSearchParams(params);
  return new NextRequest(`http://localhost:3000/api/arcs?${searchParams.toString()}`);
}

function createPostRequest(body: object): NextRequest {
  return new NextRequest('http://localhost:3000/api/arcs', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  });
}

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

beforeEach(() => {
  vi.clearAllMocks();
  mockRequireAuth.mockResolvedValue({ userId: 'user-123', role: 'pm', email: 'pm@example.com' });
});

describe('GET /api/arcs', () => {
  it('returns arcs with derived status and task counts', async () => {
    mockArcFindMany.mockResolvedValue([
      arc({ id: 'empty-arc', tasks: [] }),
      arc({ id: 'open-arc', tasks: [{ status: 'in_progress' }] }),
      arc({ id: 'complete-arc', tasks: [{ status: 'done' }] }),
    ]);

    const res = await GET(createGetRequest());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.arcs).toHaveLength(3);
    expect(body.arcs.find((a: { id: string }) => a.id === 'empty-arc').status).toBe('empty');
    expect(body.arcs.find((a: { id: string }) => a.id === 'open-arc').status).toBe('open');
    expect(body.arcs.find((a: { id: string }) => a.id === 'complete-arc').status).toBe('complete');
    expect(body.arcs.find((a: { id: string }) => a.id === 'open-arc').task_count).toBe(1);
  });

  it('filters by derived status', async () => {
    mockArcFindMany.mockResolvedValue([
      arc({ id: 'empty-arc', tasks: [] }),
      arc({ id: 'open-arc', tasks: [{ status: 'in_progress' }] }),
    ]);

    const res = await GET(createGetRequest({ status: 'open' }));
    const body = await res.json();

    expect(body.arcs).toHaveLength(1);
    expect(body.arcs[0].id).toBe('open-arc');
  });

  it('rejects an invalid status filter', async () => {
    mockArcFindMany.mockResolvedValue([]);
    const res = await GET(createGetRequest({ status: 'bogus' }));
    expect(res.status).toBe(400);
  });

  it('supports client_id and project_id filters', async () => {
    mockArcFindMany.mockResolvedValue([]);
    const clientId = '550e8400-e29b-41d4-a716-446655440000';
    await GET(createGetRequest({ client_id: clientId }));

    expect(mockArcFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ client_id: clientId }) })
    );
  });
});

describe('POST /api/arcs', () => {
  it('creates an arc with only name provided', async () => {
    mockArcCreate.mockResolvedValue(arc({ name: 'New Arc' }));

    const res = await POST(createPostRequest({ name: 'New Arc' }));
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(body.name).toBe('New Arc');
    expect(body.status).toBe('empty');
    expect(mockArcCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ name: 'New Arc' }) })
    );
  });

  it('rejects an empty name', async () => {
    const res = await POST(createPostRequest({ name: '' }));
    expect(res.status).toBe(400);
  });

  it('rejects a missing name', async () => {
    const res = await POST(createPostRequest({}));
    expect(res.status).toBe(400);
  });

  it('404s when client_id does not exist', async () => {
    mockClientFindUnique.mockResolvedValue(null);
    const res = await POST(
      createPostRequest({ name: 'Arc', client_id: '550e8400-e29b-41d4-a716-446655440000' })
    );
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body.error).toBe('Client not found');
  });

  it('404s when project_id does not exist', async () => {
    mockProjectFindUnique.mockResolvedValue(null);
    const res = await POST(
      createPostRequest({ name: 'Arc', project_id: '550e8400-e29b-41d4-a716-446655440001' })
    );
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body.error).toBe('Project not found');
  });

  it('creates an arc attached to a valid client and project', async () => {
    const clientId = '550e8400-e29b-41d4-a716-446655440000';
    const projectId = '550e8400-e29b-41d4-a716-446655440001';
    mockClientFindUnique.mockResolvedValue({ id: clientId });
    mockProjectFindUnique.mockResolvedValue({ id: projectId });
    mockArcCreate.mockResolvedValue(arc({ client_id: clientId, project_id: projectId }));

    const res = await POST(
      createPostRequest({ name: 'Arc', client_id: clientId, project_id: projectId })
    );

    expect(res.status).toBe(201);
    expect(mockArcCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ client_id: clientId, project_id: projectId }),
      })
    );
  });
});

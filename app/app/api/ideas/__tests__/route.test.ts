import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import type { Mock } from 'vitest';
import { GET, POST } from '../route';

vi.mock('@/lib/auth/middleware', () => ({
  requireAuth: vi.fn(),
}));

vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    idea: {
      findMany: vi.fn(),
      create: vi.fn(),
    },
  },
}));

import { requireAuth } from '@/lib/auth/middleware';
import { prisma } from '@/lib/db/prisma';

const mockRequireAuth = vi.mocked(requireAuth);
const mockIdeaFindMany = prisma.idea.findMany as Mock;
const mockIdeaCreate = prisma.idea.create as Mock;

function idea(overrides: Record<string, unknown> = {}) {
  return {
    id: 'idea-1',
    text: 'An idea',
    source: 'session',
    source_ref: null,
    status: 'open',
    promoted_task_id: null,
    promoted_task: null,
    created_by_id: null,
    created_at: new Date(),
    updated_at: new Date(),
    ...overrides,
  };
}

function getRequest(params: Record<string, string> = {}): NextRequest {
  const searchParams = new URLSearchParams(params);
  return new NextRequest(`http://localhost:3000/api/ideas?${searchParams.toString()}`);
}

function postRequest(body: object): NextRequest {
  return new NextRequest('http://localhost:3000/api/ideas', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockRequireAuth.mockResolvedValue({ userId: 'user-123', role: 'pm', email: 'pm@example.com' });
});

describe('GET /api/ideas', () => {
  it('defaults to status=open', async () => {
    mockIdeaFindMany.mockResolvedValue([idea()]);

    const res = await GET(getRequest());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.ideas).toHaveLength(1);
    expect(mockIdeaFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { status: 'open' } })
    );
  });

  it('supports an explicit status filter', async () => {
    mockIdeaFindMany.mockResolvedValue([idea({ status: 'kept' })]);
    await GET(getRequest({ status: 'kept' }));

    expect(mockIdeaFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { status: 'kept' } })
    );
  });

  it('rejects an invalid status filter', async () => {
    const res = await GET(getRequest({ status: 'bogus' }));
    expect(res.status).toBe(400);
  });
});

describe('POST /api/ideas', () => {
  it('creates an idea with text and source', async () => {
    mockIdeaCreate.mockResolvedValue(idea());

    const res = await POST(postRequest({ text: 'An idea', source: 'session' }));
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(body.text).toBe('An idea');
    expect(body.status).toBe('open');
  });

  it('rejects a missing text', async () => {
    const res = await POST(postRequest({ source: 'session' }));
    expect(res.status).toBe(400);
  });

  it('rejects a missing source', async () => {
    const res = await POST(postRequest({ text: 'An idea' }));
    expect(res.status).toBe(400);
  });

  it('rejects an invalid source enum value', async () => {
    const res = await POST(postRequest({ text: 'An idea', source: 'not-a-source' }));
    expect(res.status).toBe(400);
  });

  it('accepts optional source_ref and created_by_id', async () => {
    const createdById = '550e8400-e29b-41d4-a716-446655440099';
    mockIdeaCreate.mockResolvedValue(
      idea({ source: 'email', source_ref: 'msg-123', created_by_id: createdById })
    );

    const res = await POST(
      postRequest({
        text: 'An idea',
        source: 'email',
        source_ref: 'msg-123',
        created_by_id: createdById,
      })
    );

    expect(res.status).toBe(201);
    expect(mockIdeaCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ source_ref: 'msg-123', created_by_id: createdById }),
      })
    );
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { POST, GET } from '../route';

// Mock the auth middleware
vi.mock('@/lib/auth/middleware', () => ({
  requireAuth: vi.fn(),
  requireRole: vi.fn(),
}));

// Mock Prisma
vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    charter: {
      create: vi.fn(),
      findMany: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
      count: vi.fn(),
    },
  },
}));

// Mock formatters
vi.mock('@/lib/api/formatters', () => ({
  formatCharterResponse: vi.fn((c) => c),
}));

import { requireAuth, requireRole } from '@/lib/auth/middleware';
import { prisma } from '@/lib/db/prisma';
import type { Mock } from 'vitest';

const mockRequireAuth = vi.mocked(requireAuth);
const mockRequireRole = vi.mocked(requireRole);

// Type-safe mock accessors for Prisma methods
const mockCharterCreate = prisma.charter.create as Mock;
const mockCharterFindMany = prisma.charter.findMany as Mock;
const mockCharterCount = prisma.charter.count as Mock;

function createPostRequest(body: object): NextRequest {
  return new NextRequest('http://localhost:3000/api/charters', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  });
}

function createGetRequest(params?: Record<string, string>): NextRequest {
  const url = new URL('http://localhost:3000/api/charters');
  if (params) {
    Object.entries(params).forEach(([key, value]) => {
      url.searchParams.set(key, value);
    });
  }
  return new NextRequest(url, { method: 'GET' });
}

const mockCreatedCharter = {
  id: 'charter-123',
  name: 'Test Charter',
  client_id: '550e8400-e29b-41d4-a716-446655440000',
  accord_id: null,
  billing_period: 'monthly',
  budget_hours: null,
  hourly_rate: null,
  budget_amount: null,
  start_date: '2026-01-01',
  end_date: null,
  status: 'draft',
  is_deleted: false,
  created_by_id: 'user-1',
  created_at: new Date(),
  updated_at: new Date(),
  client: { id: '550e8400-e29b-41d4-a716-446655440000', name: 'Test Client', status: 'active' },
  accord: null,
  created_by: { id: 'user-1', name: 'Test User' },
  _count: { tasks: 0 },
  charter_wares: [],
  scheduled_tasks: [],
};

describe('POST /api/charters', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireAuth.mockResolvedValue({
      userId: 'user-1',
      role: 'admin',
      email: 'admin@example.com',
    });
    mockCharterCreate.mockResolvedValue(mockCreatedCharter);
  });

  it('creates a charter with required fields', async () => {
    const request = createPostRequest({
      name: 'New Charter',
      client_id: '550e8400-e29b-41d4-a716-446655440000',
      billing_period: 'monthly',
      start_date: '2026-01-01',
    });
    const response = await POST(request);

    expect(response.status).toBe(201);
    expect(mockCharterCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          name: 'New Charter',
          client_id: '550e8400-e29b-41d4-a716-446655440000',
          billing_period: 'monthly',
          start_date: '2026-01-01',
          created_by_id: 'user-1',
        }),
      })
    );
  });

  it('creates with all optional fields populated', async () => {
    const request = createPostRequest({
      name: 'Full Charter',
      client_id: '550e8400-e29b-41d4-a716-446655440000',
      accord_id: '660e8400-e29b-41d4-a716-446655440000',
      billing_period: 'annually',
      budget_hours: 40,
      hourly_rate: 150,
      budget_amount: 6000,
      start_date: '2026-01-01',
      end_date: '2026-12-31',
    });
    const response = await POST(request);

    expect(response.status).toBe(201);
    expect(mockCharterCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          name: 'Full Charter',
          billing_period: 'annually',
          budget_hours: 40,
          hourly_rate: 150,
          budget_amount: 6000,
          end_date: '2026-12-31',
        }),
      })
    );
  });

  it('rejects missing name', async () => {
    const request = createPostRequest({
      client_id: '550e8400-e29b-41d4-a716-446655440000',
      billing_period: 'monthly',
      start_date: '2026-01-01',
    });
    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBe('Validation failed');
  });

  it('rejects missing client_id', async () => {
    const request = createPostRequest({
      name: 'No Client',
      billing_period: 'monthly',
      start_date: '2026-01-01',
    });
    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBe('Validation failed');
  });

  it('rejects invalid billing_period', async () => {
    const request = createPostRequest({
      name: 'Bad Period',
      client_id: '550e8400-e29b-41d4-a716-446655440000',
      billing_period: 'weekly',
      start_date: '2026-01-01',
    });
    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBe('Validation failed');
  });

  it('rejects negative budget_hours', async () => {
    const request = createPostRequest({
      name: 'Negative Hours',
      client_id: '550e8400-e29b-41d4-a716-446655440000',
      billing_period: 'monthly',
      start_date: '2026-01-01',
      budget_hours: -10,
    });
    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBe('Validation failed');
  });
});

describe('GET /api/charters', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireAuth.mockResolvedValue({
      userId: 'user-1',
      role: 'admin',
      email: 'admin@example.com',
    });
    mockCharterFindMany.mockResolvedValue([mockCreatedCharter]);
    mockCharterCount.mockResolvedValue(1);
  });

  it('returns paginated list', async () => {
    const request = createGetRequest();
    const response = await GET(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.charters).toHaveLength(1);
    expect(body.total).toBe(1);
    expect(body.page).toBe(1);
    expect(body.limit).toBe(20);
    expect(body.totalPages).toBe(1);
  });

  it('applies search filter', async () => {
    const request = createGetRequest({ search: 'test' });
    await GET(request);

    expect(mockCharterFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          is_deleted: false,
          OR: [
            { name: { contains: 'test', mode: 'insensitive' } },
          ],
        }),
      })
    );
  });

  it('applies status filter', async () => {
    const request = createGetRequest({ status: 'active' });
    await GET(request);

    expect(mockCharterFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          is_deleted: false,
          status: 'active',
        }),
      })
    );
  });

  it('applies client_id filter', async () => {
    const request = createGetRequest({ client_id: '550e8400-e29b-41d4-a716-446655440000' });
    await GET(request);

    expect(mockCharterFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          is_deleted: false,
          client_id: '550e8400-e29b-41d4-a716-446655440000',
        }),
      })
    );
  });

  it('respects pagination params', async () => {
    const request = createGetRequest({ page: '2', limit: '10' });
    await GET(request);

    expect(mockCharterFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        skip: 10,
        take: 10,
      })
    );
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { GET, PATCH, DELETE } from '../route';

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
const mockCharterFindUnique = prisma.charter.findUnique as Mock;
const mockCharterUpdate = prisma.charter.update as Mock;

function createPatchRequest(body: object): NextRequest {
  return new NextRequest('http://localhost:3000/api/charters/charter-123', {
    method: 'PATCH',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  });
}

function createDeleteRequest(): NextRequest {
  return new NextRequest('http://localhost:3000/api/charters/charter-123', {
    method: 'DELETE',
  });
}

const mockCharter = {
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
  charter_commissions: [],
};

describe('GET /api/charters/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireAuth.mockResolvedValue({
      userId: 'user-1',
      role: 'admin',
      email: 'admin@example.com',
    });
  });

  it('returns charter by id', async () => {
    mockCharterFindUnique.mockResolvedValue(mockCharter);
    const request = new NextRequest('http://localhost:3000/api/charters/charter-123', {
      method: 'GET',
    });
    const params = Promise.resolve({ id: 'charter-123' });
    const response = await GET(request, { params });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.id).toBe('charter-123');
    expect(mockCharterFindUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'charter-123', is_deleted: false },
      })
    );
  });

  it('returns 404 for non-existent charter', async () => {
    mockCharterFindUnique.mockResolvedValue(null);
    const request = new NextRequest('http://localhost:3000/api/charters/nonexistent', {
      method: 'GET',
    });
    const params = Promise.resolve({ id: 'nonexistent' });
    const response = await GET(request, { params });
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body.error).toBe('Charter not found');
  });
});

describe('PATCH /api/charters/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireAuth.mockResolvedValue({
      userId: 'user-1',
      role: 'admin',
      email: 'admin@example.com',
    });
    mockCharterUpdate.mockResolvedValue({ ...mockCharter, name: 'Updated Charter' });
  });

  it('updates charter fields', async () => {
    const request = createPatchRequest({
      name: 'Updated Charter',
      budget_hours: 40,
      hourly_rate: 150,
    });
    const params = Promise.resolve({ id: 'charter-123' });
    const response = await PATCH(request, { params });

    expect(response.status).toBe(200);
    expect(mockCharterUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'charter-123' },
        data: expect.objectContaining({
          name: 'Updated Charter',
          budget_hours: 40,
          hourly_rate: 150,
        }),
      })
    );
  });

  it('accepts partial update', async () => {
    const request = createPatchRequest({ name: 'Only Name Updated' });
    const params = Promise.resolve({ id: 'charter-123' });
    const response = await PATCH(request, { params });

    expect(response.status).toBe(200);
    expect(mockCharterUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'charter-123' },
        data: { name: 'Only Name Updated' },
      })
    );
  });

  it('allows nullable fields to be set to null', async () => {
    const request = createPatchRequest({
      accord_id: null,
      budget_hours: null,
      end_date: null,
    });
    const params = Promise.resolve({ id: 'charter-123' });
    const response = await PATCH(request, { params });

    expect(response.status).toBe(200);
    expect(mockCharterUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'charter-123' },
        data: expect.objectContaining({
          accord_id: null,
          budget_hours: null,
          end_date: null,
        }),
      })
    );
  });
});

describe('DELETE /api/charters/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireAuth.mockResolvedValue({
      userId: 'user-1',
      role: 'admin',
      email: 'admin@example.com',
    });
    mockCharterUpdate.mockResolvedValue({ ...mockCharter, is_deleted: true });
  });

  it('soft deletes charter', async () => {
    const request = createDeleteRequest();
    const params = Promise.resolve({ id: 'charter-123' });
    const response = await DELETE(request, { params });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(mockCharterUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'charter-123' },
        data: { is_deleted: true },
      })
    );
  });
});

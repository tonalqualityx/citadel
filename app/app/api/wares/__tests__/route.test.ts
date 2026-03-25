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
    ware: {
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
  formatWareResponse: vi.fn((ware) => ware),
}));

import { requireAuth, requireRole } from '@/lib/auth/middleware';
import { prisma } from '@/lib/db/prisma';
import { GET as GET_DETAIL, PATCH, DELETE } from '../[id]/route';
import type { Mock } from 'vitest';

const mockRequireAuth = vi.mocked(requireAuth);
const mockRequireRole = vi.mocked(requireRole);

// Type-safe mock accessors for Prisma methods
const mockWareCreate = prisma.ware.create as Mock;
const mockWareFindMany = prisma.ware.findMany as Mock;
const mockWareFindUnique = prisma.ware.findUnique as Mock;
const mockWareUpdate = prisma.ware.update as Mock;
const mockWareCount = prisma.ware.count as Mock;

function createPostRequest(body: object): NextRequest {
  return new NextRequest('http://localhost:3000/api/wares', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  });
}

function createGetRequest(params?: Record<string, string>): NextRequest {
  const url = new URL('http://localhost:3000/api/wares');
  if (params) {
    Object.entries(params).forEach(([key, value]) => {
      url.searchParams.set(key, value);
    });
  }
  return new NextRequest(url, { method: 'GET' });
}

function createPatchRequest(body: object): NextRequest {
  return new NextRequest('http://localhost:3000/api/wares/ware-123', {
    method: 'PATCH',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  });
}

function createDeleteRequest(): NextRequest {
  return new NextRequest('http://localhost:3000/api/wares/ware-123', {
    method: 'DELETE',
  });
}

const mockCreatedWare = {
  id: 'ware-123',
  name: 'Test Ware',
  type: 'commission',
  description: null,
  charter_billing_period: null,
  base_price: null,
  price_tiers: null,
  contract_language: null,
  default_schedule: null,
  recipe_id: null,
  recipe: null,
  sort_order: 0,
  is_active: true,
  is_deleted: false,
  created_at: new Date(),
  updated_at: new Date(),
  _count: { accord_charter_items: 0, accord_commission_items: 0 },
};

describe('POST /api/wares', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireAuth.mockResolvedValue({
      userId: 'user-123',
      role: 'pm',
      email: 'pm@example.com',
    });
    mockWareCreate.mockResolvedValue(mockCreatedWare);
  });

  it('creates a ware with required fields only (name + type)', async () => {
    const request = createPostRequest({ name: 'New Ware', type: 'commission' });
    const response = await POST(request);

    expect(response.status).toBe(201);
    expect(mockWareCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          name: 'New Ware',
          type: 'commission',
        }),
      })
    );
  });

  it('creates with all fields populated', async () => {
    const request = createPostRequest({
      name: 'Full Ware',
      type: 'charter',
      description: 'A full ware description',
      charter_billing_period: 'monthly',
      base_price: 500,
      price_tiers: [{ min: 1, max: 10, price: 50 }],
      contract_language: 'Standard terms apply',
      default_schedule: { frequency: 'weekly' },
      recipe_id: '550e8400-e29b-41d4-a716-446655440000',
      sort_order: 5,
      is_active: true,
    });
    const response = await POST(request);

    expect(response.status).toBe(201);
    expect(mockWareCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          name: 'Full Ware',
          type: 'charter',
          description: 'A full ware description',
          charter_billing_period: 'monthly',
          base_price: 500,
          contract_language: 'Standard terms apply',
          sort_order: 5,
          is_active: true,
        }),
      })
    );
  });

  it('rejects missing name', async () => {
    const request = createPostRequest({ type: 'commission' });
    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBe('Validation failed');
  });

  it('rejects empty name', async () => {
    const request = createPostRequest({ name: '', type: 'commission' });
    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBe('Validation failed');
  });

  it('rejects invalid type', async () => {
    const request = createPostRequest({ name: 'Bad Type', type: 'invalid_type' });
    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBe('Validation failed');
  });

  it('rejects negative base_price', async () => {
    const request = createPostRequest({
      name: 'Negative Price Ware',
      type: 'commission',
      base_price: -10,
    });
    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBe('Validation failed');
  });
});

describe('GET /api/wares', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireAuth.mockResolvedValue({
      userId: 'user-123',
      role: 'pm',
      email: 'pm@example.com',
    });
    mockWareFindMany.mockResolvedValue([mockCreatedWare]);
    mockWareCount.mockResolvedValue(1);
  });

  it('returns paginated list', async () => {
    const request = createGetRequest();
    const response = await GET(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.wares).toHaveLength(1);
    expect(body.total).toBe(1);
    expect(body.page).toBe(1);
    expect(body.limit).toBe(20);
    expect(body.totalPages).toBe(1);
  });

  it('applies search filter', async () => {
    const request = createGetRequest({ search: 'test' });
    await GET(request);

    expect(mockWareFindMany).toHaveBeenCalledWith(
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

  it('applies type filter', async () => {
    const request = createGetRequest({ type: 'charter' });
    await GET(request);

    expect(mockWareFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          is_deleted: false,
          type: 'charter',
        }),
      })
    );
  });
});

describe('GET /api/wares/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireAuth.mockResolvedValue({
      userId: 'user-123',
      role: 'pm',
      email: 'pm@example.com',
    });
  });

  it('returns ware by id', async () => {
    mockWareFindUnique.mockResolvedValue(mockCreatedWare);
    const request = new NextRequest('http://localhost:3000/api/wares/ware-123', {
      method: 'GET',
    });
    const params = Promise.resolve({ id: 'ware-123' });
    const response = await GET_DETAIL(request, { params });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.id).toBe('ware-123');
    expect(mockWareFindUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'ware-123', is_deleted: false },
      })
    );
  });

  it('returns 404 for non-existent ware', async () => {
    mockWareFindUnique.mockResolvedValue(null);
    const request = new NextRequest('http://localhost:3000/api/wares/nonexistent', {
      method: 'GET',
    });
    const params = Promise.resolve({ id: 'nonexistent' });
    const response = await GET_DETAIL(request, { params });
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body.error).toBe('Ware not found');
  });
});

describe('PATCH /api/wares/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireAuth.mockResolvedValue({
      userId: 'user-123',
      role: 'pm',
      email: 'pm@example.com',
    });
    mockWareUpdate.mockResolvedValue({ ...mockCreatedWare, name: 'Updated Ware' });
  });

  it('updates ware fields', async () => {
    const request = createPatchRequest({
      name: 'Updated Ware',
      description: 'New description',
      base_price: 200,
    });
    const params = Promise.resolve({ id: 'ware-123' });
    const response = await PATCH(request, { params });

    expect(response.status).toBe(200);
    expect(mockWareUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'ware-123' },
        data: expect.objectContaining({
          name: 'Updated Ware',
          description: 'New description',
          base_price: 200,
        }),
      })
    );
  });

  it('accepts partial update', async () => {
    const request = createPatchRequest({ name: 'Only Name Updated' });
    const params = Promise.resolve({ id: 'ware-123' });
    const response = await PATCH(request, { params });

    expect(response.status).toBe(200);
    expect(mockWareUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'ware-123' },
        data: { name: 'Only Name Updated' },
      })
    );
  });
});

describe('DELETE /api/wares/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireAuth.mockResolvedValue({
      userId: 'user-123',
      role: 'admin',
      email: 'admin@example.com',
    });
    mockWareUpdate.mockResolvedValue({ ...mockCreatedWare, is_deleted: true });
  });

  it('soft deletes ware', async () => {
    const request = createDeleteRequest();
    const params = Promise.resolve({ id: 'ware-123' });
    const response = await DELETE(request, { params });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(mockWareUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'ware-123' },
        data: { is_deleted: true },
      })
    );
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// Mock the auth middleware
vi.mock('@/lib/auth/middleware', () => ({
  requireAuth: vi.fn(),
  requireRole: vi.fn(),
}));

// Mock Prisma
vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    accord: {
      create: vi.fn(),
      findMany: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
      count: vi.fn(),
    },
    client: {
      findUnique: vi.fn(),
    },
  },
}));

// Mock formatters
vi.mock('@/lib/api/formatters', () => ({
  formatAccordResponse: vi.fn((accord) => accord),
}));

import { POST, GET } from '../route';
import { GET as GET_BY_ID, DELETE } from '../[id]/route';
import { PATCH as PATCH_STATUS } from '../[id]/status/route';
import { requireAuth, requireRole } from '@/lib/auth/middleware';
import { prisma } from '@/lib/db/prisma';
import type { Mock } from 'vitest';

const mockRequireAuth = vi.mocked(requireAuth);
const mockRequireRole = vi.mocked(requireRole);

// Type-safe mock accessors for Prisma methods
const mockAccordCreate = prisma.accord.create as Mock;
const mockAccordFindMany = prisma.accord.findMany as Mock;
const mockAccordFindUnique = prisma.accord.findUnique as Mock;
const mockAccordUpdate = prisma.accord.update as Mock;
const mockAccordCount = prisma.accord.count as Mock;
const mockClientFindUnique = prisma.client.findUnique as Mock;

function createPostRequest(body: object): NextRequest {
  return new NextRequest('http://localhost:3000/api/accords', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  });
}

function createGetRequest(queryParams: Record<string, string> = {}): NextRequest {
  const url = new URL('http://localhost:3000/api/accords');
  Object.entries(queryParams).forEach(([key, value]) => {
    url.searchParams.set(key, value);
  });
  return new NextRequest(url.toString(), { method: 'GET' });
}

function createPatchRequest(body: object): NextRequest {
  return new NextRequest('http://localhost:3000/api/accords/accord-123/status', {
    method: 'PATCH',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  });
}

function createDeleteRequest(): NextRequest {
  return new NextRequest('http://localhost:3000/api/accords/accord-123', {
    method: 'DELETE',
  });
}

const mockCreatedAccord = {
  id: 'accord-123',
  name: 'Test Accord',
  status: 'lead',
  client_id: null,
  owner_id: 'user-123',
  lead_name: null,
  lead_business_name: null,
  lead_email: null,
  lead_phone: null,
  lead_notes: null,
  is_deleted: false,
  created_at: new Date(),
  updated_at: new Date(),
  client: null,
  owner: { id: 'user-123', name: 'Test User', email: 'pm@example.com', avatar_url: null },
  _count: { charter_items: 0, commission_items: 0, keep_items: 0 },
};

describe('POST /api/accords', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireAuth.mockResolvedValue({
      userId: 'user-123',
      role: 'pm',
      email: 'pm@example.com',
    });
    mockAccordCreate.mockResolvedValue(mockCreatedAccord);
  });

  it('creates accord with required fields (name only, owner_id defaults to auth.userId)', async () => {
    const request = createPostRequest({ name: 'New Deal' });
    const response = await POST(request);

    expect(response.status).toBe(201);
    expect(mockAccordCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          name: 'New Deal',
          owner_id: 'user-123',
          status: 'lead',
        }),
      })
    );
  });

  it('creates with client_id and validates client exists', async () => {
    const clientId = '550e8400-e29b-41d4-a716-446655440000';
    mockClientFindUnique.mockResolvedValue({ id: clientId, name: 'Existing Client' });

    const request = createPostRequest({ name: 'Client Deal', client_id: clientId });
    const response = await POST(request);

    expect(response.status).toBe(201);
    expect(mockClientFindUnique).toHaveBeenCalledWith({ where: { id: clientId } });
    expect(mockAccordCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          name: 'Client Deal',
          client_id: clientId,
        }),
      })
    );
  });

  it('returns 404 when client_id references non-existent client', async () => {
    const clientId = '550e8400-e29b-41d4-a716-446655440001';
    mockClientFindUnique.mockResolvedValue(null);

    const request = createPostRequest({ name: 'Bad Client Deal', client_id: clientId });
    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body.error).toBe('Client not found');
  });

  it('creates with lead info fields', async () => {
    const request = createPostRequest({
      name: 'Lead Deal',
      lead_name: 'Jane Smith',
      lead_business_name: 'Smith Corp',
      lead_email: 'jane@smith.com',
      lead_phone: '555-1234',
      lead_notes: 'Interested in web redesign',
    });
    const response = await POST(request);

    expect(response.status).toBe(201);
    expect(mockAccordCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          lead_name: 'Jane Smith',
          lead_business_name: 'Smith Corp',
          lead_email: 'jane@smith.com',
          lead_phone: '555-1234',
          lead_notes: 'Interested in web redesign',
        }),
      })
    );
  });

  it('rejects missing name', async () => {
    const request = createPostRequest({});
    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBe('Validation failed');
  });

  it('rejects empty name', async () => {
    const request = createPostRequest({ name: '' });
    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBe('Validation failed');
  });

  it('rejects invalid status value', async () => {
    const request = createPostRequest({ name: 'Deal', status: 'signed' });
    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBe('Validation failed');
  });
});

describe('GET /api/accords', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireAuth.mockResolvedValue({
      userId: 'user-123',
      role: 'pm',
      email: 'pm@example.com',
    });
  });

  it('returns paginated list', async () => {
    const mockAccords = [mockCreatedAccord];
    mockAccordFindMany.mockResolvedValue(mockAccords);
    mockAccordCount.mockResolvedValue(1);

    const request = createGetRequest();
    const response = await GET(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.accords).toHaveLength(1);
    expect(body.total).toBe(1);
    expect(body.page).toBe(1);
    expect(body.limit).toBe(20);
    expect(body.totalPages).toBe(1);
  });

  it('applies status filter', async () => {
    mockAccordFindMany.mockResolvedValue([]);
    mockAccordCount.mockResolvedValue(0);

    const request = createGetRequest({ status: 'meeting' });
    await GET(request);

    expect(mockAccordFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: 'meeting',
          is_deleted: false,
        }),
      })
    );
  });

  it('applies search filter', async () => {
    mockAccordFindMany.mockResolvedValue([]);
    mockAccordCount.mockResolvedValue(0);

    const request = createGetRequest({ search: 'test' });
    await GET(request);

    expect(mockAccordFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          is_deleted: false,
          OR: expect.arrayContaining([
            expect.objectContaining({ name: { contains: 'test', mode: 'insensitive' } }),
          ]),
        }),
      })
    );
  });
});

describe('GET /api/accords/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireAuth.mockResolvedValue({
      userId: 'user-123',
      role: 'pm',
      email: 'pm@example.com',
    });
  });

  it('returns accord with full includes', async () => {
    const fullAccord = {
      ...mockCreatedAccord,
      charter_items: [],
      commission_items: [],
      keep_items: [],
    };
    mockAccordFindUnique.mockResolvedValue(fullAccord);

    const request = new NextRequest('http://localhost:3000/api/accords/accord-123', {
      method: 'GET',
    });
    const response = await GET_BY_ID(request, {
      params: Promise.resolve({ id: 'accord-123' }),
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.id).toBe('accord-123');
    expect(mockAccordFindUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'accord-123', is_deleted: false },
      })
    );
  });

  it('returns 404 for non-existent accord', async () => {
    mockAccordFindUnique.mockResolvedValue(null);

    const request = new NextRequest('http://localhost:3000/api/accords/accord-123', {
      method: 'GET',
    });
    const response = await GET_BY_ID(request, {
      params: Promise.resolve({ id: 'accord-123' }),
    });
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body.error).toBe('Accord not found');
  });
});

describe('PATCH /api/accords/[id]/status', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireAuth.mockResolvedValue({
      userId: 'user-123',
      role: 'pm',
      email: 'pm@example.com',
    });
    mockAccordUpdate.mockResolvedValue({
      ...mockCreatedAccord,
      charter_items: [],
      commission_items: [],
      keep_items: [],
    });
  });

  it('allows valid transition: lead -> meeting', async () => {
    mockAccordFindUnique.mockResolvedValue({ ...mockCreatedAccord, status: 'lead' });

    const request = createPatchRequest({ status: 'meeting' });
    const response = await PATCH_STATUS(request, {
      params: Promise.resolve({ id: 'accord-123' }),
    });

    expect(response.status).toBe(200);
    expect(mockAccordUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'accord-123' },
        data: expect.objectContaining({
          status: 'meeting',
        }),
      })
    );
  });

  it('allows valid transition: meeting -> proposal', async () => {
    mockAccordFindUnique.mockResolvedValue({ ...mockCreatedAccord, status: 'meeting' });

    const request = createPatchRequest({ status: 'proposal' });
    const response = await PATCH_STATUS(request, {
      params: Promise.resolve({ id: 'accord-123' }),
    });

    expect(response.status).toBe(200);
    expect(mockAccordUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'proposal',
        }),
      })
    );
  });

  it('rejects invalid transition: lead -> signed', async () => {
    mockAccordFindUnique.mockResolvedValue({ ...mockCreatedAccord, status: 'lead' });

    const request = createPatchRequest({ status: 'signed' });
    const response = await PATCH_STATUS(request, {
      params: Promise.resolve({ id: 'accord-123' }),
    });
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toContain('Invalid status transition');
  });

  it('sets lost_at when moving to lost', async () => {
    mockAccordFindUnique.mockResolvedValue({ ...mockCreatedAccord, status: 'lead' });

    const request = createPatchRequest({ status: 'lost', rejection_reason: 'Too expensive' });
    const response = await PATCH_STATUS(request, {
      params: Promise.resolve({ id: 'accord-123' }),
    });

    expect(response.status).toBe(200);
    expect(mockAccordUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'lost',
          lost_at: expect.any(Date),
          rejection_reason: 'Too expensive',
        }),
      })
    );
  });

  it('clears lost_at when reopening from lost to lead', async () => {
    mockAccordFindUnique.mockResolvedValue({
      ...mockCreatedAccord,
      status: 'lost',
      lost_at: new Date(),
      rejection_reason: 'Budget issues',
    });

    const request = createPatchRequest({ status: 'lead' });
    const response = await PATCH_STATUS(request, {
      params: Promise.resolve({ id: 'accord-123' }),
    });

    expect(response.status).toBe(200);
    expect(mockAccordUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'lead',
          lost_at: null,
          rejection_reason: null,
        }),
      })
    );
  });
});

describe('DELETE /api/accords/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireAuth.mockResolvedValue({
      userId: 'user-123',
      role: 'admin',
      email: 'admin@example.com',
    });
  });

  it('soft deletes accord', async () => {
    mockAccordUpdate.mockResolvedValue({ ...mockCreatedAccord, is_deleted: true });

    const request = createDeleteRequest();
    const response = await DELETE(request, {
      params: Promise.resolve({ id: 'accord-123' }),
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(mockAccordUpdate).toHaveBeenCalledWith({
      where: { id: 'accord-123' },
      data: { is_deleted: true },
    });
  });
});

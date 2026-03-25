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
      findUnique: vi.fn(),
    },
    addendum: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
  },
}));

// Mock formatters
vi.mock('@/lib/api/formatters', () => ({
  formatAddendumResponse: vi.fn((addendum) => addendum),
}));

import { GET, POST } from '../route';
import { GET as GET_BY_ID, PATCH, DELETE } from '../[addendumId]/route';
import { requireAuth, requireRole } from '@/lib/auth/middleware';
import { prisma } from '@/lib/db/prisma';
import { AuthError } from '@/lib/api/errors';
import type { Mock } from 'vitest';

const mockRequireAuth = vi.mocked(requireAuth);
const mockRequireRole = vi.mocked(requireRole);

const mockAccordFindUnique = prisma.accord.findUnique as Mock;
const mockAddendumFindMany = prisma.addendum.findMany as Mock;
const mockAddendumFindFirst = prisma.addendum.findFirst as Mock;
const mockAddendumCreate = prisma.addendum.create as Mock;
const mockAddendumUpdate = prisma.addendum.update as Mock;

const mockAccord = {
  id: 'accord-123',
  name: 'Test Accord',
  status: 'proposal',
  is_deleted: false,
};

const mockAddendum = {
  id: 'addendum-123',
  accord_id: 'accord-123',
  version: 1,
  title: 'Scope Change v1',
  description: 'Adding new feature',
  contract_content: '<p>Updated terms</p>',
  changes: { added: ['Feature X'] },
  pricing_snapshot: { total: 5000 },
  status: 'draft',
  is_override: false,
  override_reason: null,
  is_deleted: false,
  created_by_id: 'user-123',
  created_by: { id: 'user-123', name: 'Test User', email: 'pm@example.com' },
  created_at: new Date(),
  updated_at: new Date(),
};

function createGetRequest(): NextRequest {
  return new NextRequest('http://localhost:3000/api/accords/accord-123/addendums', {
    method: 'GET',
  });
}

function createPostRequest(body: object): NextRequest {
  return new NextRequest('http://localhost:3000/api/accords/accord-123/addendums', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  });
}

function createPatchRequest(body: object): NextRequest {
  return new NextRequest('http://localhost:3000/api/accords/accord-123/addendums/addendum-123', {
    method: 'PATCH',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  });
}

function createDeleteRequest(): NextRequest {
  return new NextRequest('http://localhost:3000/api/accords/accord-123/addendums/addendum-123', {
    method: 'DELETE',
  });
}

const validCreateBody = {
  title: 'Scope Change v1',
  description: 'Adding new feature',
  contract_content: '<p>Updated terms</p>',
  changes: { added: ['Feature X'] },
  pricing_snapshot: { total: 5000 },
};

describe('GET /api/accords/[id]/addendums', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireAuth.mockResolvedValue({
      userId: 'user-123',
      role: 'pm',
      email: 'pm@example.com',
    });
  });

  it('lists addendums for an accord filtered by is_deleted', async () => {
    mockAccordFindUnique.mockResolvedValue(mockAccord);
    mockAddendumFindMany.mockResolvedValue([mockAddendum]);

    const request = createGetRequest();
    const response = await GET(request, {
      params: Promise.resolve({ id: 'accord-123' }),
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.addendums).toHaveLength(1);
    expect(mockAddendumFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          accord_id: 'accord-123',
          is_deleted: false,
        },
        orderBy: { version: 'desc' },
      })
    );
  });

  it('returns 404 when accord does not exist', async () => {
    mockAccordFindUnique.mockResolvedValue(null);

    const request = createGetRequest();
    const response = await GET(request, {
      params: Promise.resolve({ id: 'accord-999' }),
    });
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body.error).toBe('Accord not found');
  });
});

describe('POST /api/accords/[id]/addendums', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireAuth.mockResolvedValue({
      userId: 'user-123',
      role: 'pm',
      email: 'pm@example.com',
    });
    mockAccordFindUnique.mockResolvedValue(mockAccord);
    mockAddendumCreate.mockResolvedValue(mockAddendum);
  });

  it('creates addendum with auto-version increment from 0', async () => {
    mockAddendumFindFirst.mockResolvedValue(null);

    const request = createPostRequest(validCreateBody);
    const response = await POST(request, {
      params: Promise.resolve({ id: 'accord-123' }),
    });

    expect(response.status).toBe(201);
    expect(mockAddendumCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          accord_id: 'accord-123',
          version: 1,
          title: 'Scope Change v1',
          created_by_id: 'user-123',
        }),
      })
    );
  });

  it('auto-increments version from latest', async () => {
    mockAddendumFindFirst.mockResolvedValue({ version: 3 });

    const request = createPostRequest(validCreateBody);
    const response = await POST(request, {
      params: Promise.resolve({ id: 'accord-123' }),
    });

    expect(response.status).toBe(201);
    expect(mockAddendumCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          version: 4,
        }),
      })
    );
  });

  it('returns 404 when accord does not exist', async () => {
    mockAccordFindUnique.mockResolvedValue(null);

    const request = createPostRequest(validCreateBody);
    const response = await POST(request, {
      params: Promise.resolve({ id: 'accord-999' }),
    });
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body.error).toBe('Accord not found');
  });

  it('validates required fields — rejects missing title', async () => {
    const request = createPostRequest({
      description: 'No title',
      contract_content: '<p>content</p>',
      changes: {},
      pricing_snapshot: {},
    });
    const response = await POST(request, {
      params: Promise.resolve({ id: 'accord-123' }),
    });
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBe('Validation failed');
  });
});

describe('GET /api/accords/[id]/addendums/[addendumId]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireAuth.mockResolvedValue({
      userId: 'user-123',
      role: 'pm',
      email: 'pm@example.com',
    });
  });

  it('returns single addendum with relations', async () => {
    const fullAddendum = {
      ...mockAddendum,
      overridden_by: null,
      charter_items: [],
      commission_items: [],
      keep_items: [],
    };
    mockAddendumFindFirst.mockResolvedValue(fullAddendum);

    const request = new NextRequest(
      'http://localhost:3000/api/accords/accord-123/addendums/addendum-123',
      { method: 'GET' }
    );
    const response = await GET_BY_ID(request, {
      params: Promise.resolve({ id: 'accord-123', addendumId: 'addendum-123' }),
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.id).toBe('addendum-123');
    expect(mockAddendumFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: 'addendum-123',
          accord_id: 'accord-123',
          is_deleted: false,
        },
        include: expect.objectContaining({
          created_by: expect.any(Object),
          overridden_by: expect.any(Object),
          charter_items: expect.any(Object),
          commission_items: expect.any(Object),
          keep_items: expect.any(Object),
        }),
      })
    );
  });

  it('returns 404 for non-existent addendum', async () => {
    mockAddendumFindFirst.mockResolvedValue(null);

    const request = new NextRequest(
      'http://localhost:3000/api/accords/accord-123/addendums/addendum-999',
      { method: 'GET' }
    );
    const response = await GET_BY_ID(request, {
      params: Promise.resolve({ id: 'accord-123', addendumId: 'addendum-999' }),
    });
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body.error).toBe('Addendum not found');
  });
});

describe('PATCH /api/accords/[id]/addendums/[addendumId]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireAuth.mockResolvedValue({
      userId: 'user-123',
      role: 'pm',
      email: 'pm@example.com',
    });
  });

  it('updates draft addendum', async () => {
    mockAddendumFindFirst.mockResolvedValue({ ...mockAddendum, status: 'draft' });
    mockAddendumUpdate.mockResolvedValue({
      ...mockAddendum,
      title: 'Updated Title',
      overridden_by: null,
      charter_items: [],
      commission_items: [],
      keep_items: [],
    });

    const request = createPatchRequest({ title: 'Updated Title' });
    const response = await PATCH(request, {
      params: Promise.resolve({ id: 'accord-123', addendumId: 'addendum-123' }),
    });

    expect(response.status).toBe(200);
    expect(mockAddendumUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'addendum-123' },
        data: expect.objectContaining({ title: 'Updated Title' }),
      })
    );
  });

  it('rejects update of non-draft addendum', async () => {
    mockAddendumFindFirst.mockResolvedValue({ ...mockAddendum, status: 'sent' });

    const request = createPatchRequest({ title: 'Updated Title' });
    const response = await PATCH(request, {
      params: Promise.resolve({ id: 'accord-123', addendumId: 'addendum-123' }),
    });
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBe('Only draft addendums can be updated');
  });

  it('returns 404 for non-existent addendum', async () => {
    mockAddendumFindFirst.mockResolvedValue(null);

    const request = createPatchRequest({ title: 'Updated Title' });
    const response = await PATCH(request, {
      params: Promise.resolve({ id: 'accord-123', addendumId: 'addendum-999' }),
    });
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body.error).toBe('Addendum not found');
  });
});

describe('DELETE /api/accords/[id]/addendums/[addendumId]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireAuth.mockResolvedValue({
      userId: 'user-123',
      role: 'admin',
      email: 'admin@example.com',
    });
  });

  it('soft deletes draft addendum', async () => {
    mockAddendumFindFirst.mockResolvedValue({ ...mockAddendum, status: 'draft' });
    mockAddendumUpdate.mockResolvedValue({ ...mockAddendum, is_deleted: true });

    const request = createDeleteRequest();
    const response = await DELETE(request, {
      params: Promise.resolve({ id: 'accord-123', addendumId: 'addendum-123' }),
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(mockAddendumUpdate).toHaveBeenCalledWith({
      where: { id: 'addendum-123' },
      data: { is_deleted: true },
    });
  });

  it('rejects delete of non-draft addendum', async () => {
    mockAddendumFindFirst.mockResolvedValue({ ...mockAddendum, status: 'sent' });

    const request = createDeleteRequest();
    const response = await DELETE(request, {
      params: Promise.resolve({ id: 'accord-123', addendumId: 'addendum-123' }),
    });
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBe('Only draft addendums can be deleted');
  });

  it('returns 404 for non-existent addendum', async () => {
    mockAddendumFindFirst.mockResolvedValue(null);

    const request = createDeleteRequest();
    const response = await DELETE(request, {
      params: Promise.resolve({ id: 'accord-123', addendumId: 'addendum-999' }),
    });
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body.error).toBe('Addendum not found');
  });

  it('requires admin role', async () => {
    mockRequireAuth.mockResolvedValue({
      userId: 'user-123',
      role: 'pm',
      email: 'pm@example.com',
    });
    mockRequireRole.mockImplementation(() => {
      throw new AuthError('Insufficient permissions', 403);
    });

    const request = createDeleteRequest();
    const response = await DELETE(request, {
      params: Promise.resolve({ id: 'accord-123', addendumId: 'addendum-123' }),
    });

    expect(response.status).toBe(403);
    expect(mockRequireRole).toHaveBeenCalledWith(
      expect.objectContaining({ role: 'pm' }),
      ['admin']
    );
  });
});

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
    msaVersion: {
      create: vi.fn(),
      findMany: vi.fn(),
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      delete: vi.fn(),
    },
  },
}));

// Mock formatters
vi.mock('@/lib/api/formatters', () => ({
  formatMsaVersionResponse: vi.fn((m) => m),
}));

import { GET, POST } from '../route';
import { GET as GET_BY_ID, PATCH, DELETE } from '../[id]/route';
import { GET as GET_CURRENT } from '../current/route';
import { requireAuth, requireRole } from '@/lib/auth/middleware';
import { prisma } from '@/lib/db/prisma';
import type { Mock } from 'vitest';

const mockRequireAuth = vi.mocked(requireAuth);
const mockRequireRole = vi.mocked(requireRole);
const mockMsaCreate = prisma.msaVersion.create as Mock;
const mockMsaFindMany = prisma.msaVersion.findMany as Mock;
const mockMsaFindFirst = prisma.msaVersion.findFirst as Mock;
const mockMsaFindUnique = prisma.msaVersion.findUnique as Mock;
const mockMsaUpdate = prisma.msaVersion.update as Mock;
const mockMsaUpdateMany = prisma.msaVersion.updateMany as Mock;
const mockMsaDelete = prisma.msaVersion.delete as Mock;

// -- Helpers --

function createGetRequest(url = 'http://localhost:3000/api/msa'): NextRequest {
  return new NextRequest(url, { method: 'GET' });
}

function createPostRequest(body: object): NextRequest {
  return new NextRequest('http://localhost:3000/api/msa', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  });
}

function createPatchRequest(body: object): NextRequest {
  return new NextRequest('http://localhost:3000/api/msa/msa-123', {
    method: 'PATCH',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  });
}

function createDeleteRequest(): NextRequest {
  return new NextRequest('http://localhost:3000/api/msa/msa-123', {
    method: 'DELETE',
  });
}

// -- Mock Data --

const mockMsaVersion = {
  id: 'msa-123',
  version: '1.0',
  content: '<p>Terms and conditions</p>',
  effective_date: new Date('2026-01-01'),
  is_current: true,
  change_summary: 'Initial version',
  created_by_id: 'user-123',
  created_by: { id: 'user-123', name: 'Admin User', email: 'admin@example.com' },
  _count: { client_msa_signatures: 0 },
  created_at: new Date(),
  updated_at: new Date(),
};

const idParams = Promise.resolve({ id: 'msa-123' });
const missingIdParams = Promise.resolve({ id: 'nonexistent' });

// -- Tests --

beforeEach(() => {
  vi.clearAllMocks();
  mockRequireAuth.mockResolvedValue({
    userId: 'user-123',
    role: 'admin',
    email: 'admin@example.com',
  });
});

describe('GET /api/msa', () => {
  it('returns list of all MSA versions', async () => {
    const versions = [mockMsaVersion, { ...mockMsaVersion, id: 'msa-456', version: '2.0', is_current: false }];
    mockMsaFindMany.mockResolvedValue(versions);

    const response = await GET(createGetRequest());
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.msa_versions).toHaveLength(2);
    expect(data.total).toBe(2);
    expect(mockMsaFindMany).toHaveBeenCalledWith({
      include: {
        created_by: { select: { id: true, name: true, email: true } },
        _count: { select: { client_msa_signatures: true } },
      },
      orderBy: { created_at: 'desc' },
    });
  });

  it('returns empty list', async () => {
    mockMsaFindMany.mockResolvedValue([]);

    const response = await GET(createGetRequest());
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.msa_versions).toHaveLength(0);
    expect(data.total).toBe(0);
  });
});

describe('POST /api/msa', () => {
  it('creates new MSA version', async () => {
    mockMsaCreate.mockResolvedValue(mockMsaVersion);

    const response = await POST(
      createPostRequest({
        version: '1.0',
        content: '<p>Terms and conditions</p>',
        effective_date: '2026-01-01',
        change_summary: 'Initial version',
      })
    );
    const data = await response.json();

    expect(response.status).toBe(201);
    expect(data.id).toBe('msa-123');
    expect(mockMsaUpdateMany).not.toHaveBeenCalled();
    expect(mockMsaCreate).toHaveBeenCalledWith({
      data: {
        version: '1.0',
        content: '<p>Terms and conditions</p>',
        effective_date: new Date('2026-01-01'),
        is_current: false,
        change_summary: 'Initial version',
        created_by_id: 'user-123',
      },
      include: {
        created_by: { select: { id: true, name: true, email: true } },
        _count: { select: { client_msa_signatures: true } },
      },
    });
  });

  it('creates as current and unsets others when is_current is true', async () => {
    mockMsaUpdateMany.mockResolvedValue({ count: 1 });
    mockMsaCreate.mockResolvedValue({ ...mockMsaVersion, is_current: true });

    const response = await POST(
      createPostRequest({
        version: '2.0',
        content: '<p>Updated terms</p>',
        effective_date: '2026-06-01',
        is_current: true,
      })
    );

    expect(response.status).toBe(201);
    expect(mockMsaUpdateMany).toHaveBeenCalledWith({
      where: { is_current: true },
      data: { is_current: false },
    });
    expect(mockMsaCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ is_current: true }),
      })
    );
  });

  it('rejects missing required fields', async () => {
    const response = await POST(createPostRequest({ version: '1.0' }));

    expect(response.status).toBe(400);
    expect(mockMsaCreate).not.toHaveBeenCalled();
  });

  it('requires admin role', async () => {
    mockMsaCreate.mockResolvedValue(mockMsaVersion);

    await POST(
      createPostRequest({
        version: '1.0',
        content: '<p>Terms</p>',
        effective_date: '2026-01-01',
      })
    );

    expect(mockRequireRole).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'user-123' }),
      ['admin']
    );
  });
});

describe('GET /api/msa/:id', () => {
  it('returns MSA version detail', async () => {
    mockMsaFindUnique.mockResolvedValue(mockMsaVersion);

    const response = await GET_BY_ID(createGetRequest('http://localhost:3000/api/msa/msa-123'), {
      params: idParams,
    });
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.id).toBe('msa-123');
    expect(data.version).toBe('1.0');
    expect(mockMsaFindUnique).toHaveBeenCalledWith({
      where: { id: 'msa-123' },
      include: {
        created_by: { select: { id: true, name: true, email: true } },
        _count: { select: { client_msa_signatures: true } },
      },
    });
  });

  it('returns 404 when not found', async () => {
    mockMsaFindUnique.mockResolvedValue(null);

    const response = await GET_BY_ID(createGetRequest('http://localhost:3000/api/msa/nonexistent'), {
      params: missingIdParams,
    });
    const data = await response.json();

    expect(response.status).toBe(404);
    expect(data.error).toBe('MSA version not found');
  });
});

describe('PATCH /api/msa/:id', () => {
  it('updates MSA version fields', async () => {
    mockMsaFindUnique.mockResolvedValue(mockMsaVersion);
    const updated = { ...mockMsaVersion, version: '1.1', change_summary: 'Minor update' };
    mockMsaUpdate.mockResolvedValue(updated);

    const response = await PATCH(
      createPatchRequest({ version: '1.1', change_summary: 'Minor update' }),
      { params: idParams }
    );
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.version).toBe('1.1');
    expect(mockMsaUpdateMany).not.toHaveBeenCalled();
    expect(mockMsaUpdate).toHaveBeenCalledWith({
      where: { id: 'msa-123' },
      data: { version: '1.1', change_summary: 'Minor update' },
      include: {
        created_by: { select: { id: true, name: true, email: true } },
        _count: { select: { client_msa_signatures: true } },
      },
    });
  });

  it('sets as current and unsets others', async () => {
    mockMsaFindUnique.mockResolvedValue({ ...mockMsaVersion, is_current: false });
    mockMsaUpdateMany.mockResolvedValue({ count: 1 });
    mockMsaUpdate.mockResolvedValue({ ...mockMsaVersion, is_current: true });

    const response = await PATCH(createPatchRequest({ is_current: true }), {
      params: idParams,
    });

    expect(response.status).toBe(200);
    expect(mockMsaUpdateMany).toHaveBeenCalledWith({
      where: { is_current: true, id: { not: 'msa-123' } },
      data: { is_current: false },
    });
  });

  it('returns 404 when not found', async () => {
    mockMsaFindUnique.mockResolvedValue(null);

    const response = await PATCH(createPatchRequest({ version: '2.0' }), {
      params: missingIdParams,
    });
    const data = await response.json();

    expect(response.status).toBe(404);
    expect(data.error).toBe('MSA version not found');
  });
});

describe('DELETE /api/msa/:id', () => {
  it('deletes MSA version with no signatures or contracts', async () => {
    mockMsaFindUnique.mockResolvedValue({
      ...mockMsaVersion,
      _count: { client_msa_signatures: 0, contracts: 0 },
    });
    mockMsaDelete.mockResolvedValue(mockMsaVersion);

    const response = await DELETE(createDeleteRequest(), { params: idParams });
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.message).toBe('MSA version deleted');
    expect(mockMsaDelete).toHaveBeenCalledWith({ where: { id: 'msa-123' } });
  });

  it('rejects deletion when signatures exist', async () => {
    mockMsaFindUnique.mockResolvedValue({
      ...mockMsaVersion,
      _count: { client_msa_signatures: 2, contracts: 0 },
    });

    const response = await DELETE(createDeleteRequest(), { params: idParams });
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toBe('Cannot delete MSA version with existing signatures or contracts');
    expect(mockMsaDelete).not.toHaveBeenCalled();
  });

  it('returns 404 when not found', async () => {
    mockMsaFindUnique.mockResolvedValue(null);

    const response = await DELETE(createDeleteRequest(), { params: missingIdParams });
    const data = await response.json();

    expect(response.status).toBe(404);
    expect(data.error).toBe('MSA version not found');
    expect(mockMsaDelete).not.toHaveBeenCalled();
  });
});

describe('GET /api/msa/current', () => {
  it('returns current active MSA version', async () => {
    mockMsaFindFirst.mockResolvedValue(mockMsaVersion);

    const response = await GET_CURRENT(createGetRequest('http://localhost:3000/api/msa/current'));
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.id).toBe('msa-123');
    expect(data.is_current).toBe(true);
    expect(mockMsaFindFirst).toHaveBeenCalledWith({
      where: { is_current: true },
      include: {
        created_by: { select: { id: true, name: true, email: true } },
        _count: { select: { client_msa_signatures: true } },
      },
    });
  });

  it('returns 404 when no current version set', async () => {
    mockMsaFindFirst.mockResolvedValue(null);

    const response = await GET_CURRENT(createGetRequest('http://localhost:3000/api/msa/current'));
    const data = await response.json();

    expect(response.status).toBe(404);
    expect(data.error).toBe('No current MSA version set');
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { GET, PUT } from '../route';

vi.mock('@/lib/auth/middleware', () => ({
  requireAuth: vi.fn(),
  requireRole: vi.fn(),
}));

vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    client: { findUnique: vi.fn() },
    brandProfile: {
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
  },
}));

vi.mock('@/lib/services/activity', () => ({
  logCreate: vi.fn(),
  logUpdate: vi.fn(),
}));

import { requireAuth } from '@/lib/auth/middleware';
import { prisma } from '@/lib/db/prisma';
import type { Mock } from 'vitest';

const mockRequireAuth = vi.mocked(requireAuth);
const mockClientFindUnique = prisma.client.findUnique as Mock;
const mockProfileFindFirst = prisma.brandProfile.findFirst as Mock;
const mockProfileCreate = prisma.brandProfile.create as Mock;
const mockProfileUpdate = prisma.brandProfile.update as Mock;

const CLIENT_ID = 'client-1';
const params = Promise.resolve({ id: CLIENT_ID });

function putReq(body: object): NextRequest {
  return new NextRequest(`http://localhost:3000/api/clients/${CLIENT_ID}/brand-profile`, {
    method: 'PUT',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockRequireAuth.mockResolvedValue({ userId: 'u1', role: 'pm', email: 'pm@x.com' });
});

describe('GET /api/clients/[id]/brand-profile', () => {
  it('404s when the client does not exist', async () => {
    mockClientFindUnique.mockResolvedValue(null);
    const res = await GET(new NextRequest('http://localhost/x'), { params });
    expect(res.status).toBe(404);
  });

  it('returns null profile when none is set', async () => {
    mockClientFindUnique.mockResolvedValue({ id: CLIENT_ID });
    mockProfileFindFirst.mockResolvedValue(null);
    const res = await GET(new NextRequest('http://localhost/x'), { params });
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.profile).toBeNull();
  });

  it('returns the existing profile', async () => {
    mockClientFindUnique.mockResolvedValue({ id: CLIENT_ID });
    mockProfileFindFirst.mockResolvedValue({ id: 'bp1', client_id: CLIENT_ID, figma_url: 'x' });
    const res = await GET(new NextRequest('http://localhost/x'), { params });
    const body = await res.json();
    expect(body.profile.id).toBe('bp1');
    expect(body.profile.figma_url).toBe('x');
  });
});

describe('PUT /api/clients/[id]/brand-profile', () => {
  beforeEach(() => {
    mockClientFindUnique.mockResolvedValue({ id: CLIENT_ID, name: 'Acme' });
  });

  it('creates a profile (with client_id) when none exists', async () => {
    mockProfileFindFirst.mockResolvedValue(null);
    mockProfileCreate.mockResolvedValue({ id: 'bp-new', client_id: CLIENT_ID, figma_url: 'https://f' });
    const res = await PUT(putReq({ figma_url: 'https://f' }), { params });
    expect(res.status).toBe(200);
    expect(mockProfileCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ client_id: CLIENT_ID, figma_url: 'https://f' }) })
    );
  });

  it('updates the existing profile instead of creating a duplicate', async () => {
    mockProfileFindFirst.mockResolvedValue({ id: 'bp-existing' });
    mockProfileUpdate.mockResolvedValue({ id: 'bp-existing', client_id: CLIENT_ID, notes: 'hi' });
    const res = await PUT(putReq({ notes: 'hi' }), { params });
    expect(res.status).toBe(200);
    expect(mockProfileUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'bp-existing' }, data: expect.objectContaining({ notes: 'hi' }) })
    );
    expect(mockProfileCreate).not.toHaveBeenCalled();
  });

  it('404s when the client does not exist', async () => {
    mockClientFindUnique.mockResolvedValue(null);
    const res = await PUT(putReq({ notes: 'x' }), { params });
    expect(res.status).toBe(404);
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { GET, POST } from '../route';

vi.mock('@/lib/auth/middleware', () => ({
  requireAuth: vi.fn(),
  requireRole: vi.fn(),
}));

vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    client: { findUnique: vi.fn() },
    clientContact: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    projectContact: { deleteMany: vi.fn() },
  },
}));

vi.mock('@/lib/api/formatters', () => ({
  formatClientContactResponse: vi.fn((c) => c),
}));

vi.mock('@/lib/services/activity', () => ({
  logCreate: vi.fn(),
}));

import { requireAuth, requireRole } from '@/lib/auth/middleware';
import { prisma } from '@/lib/db/prisma';
import type { Mock } from 'vitest';

const mockRequireAuth = vi.mocked(requireAuth);
const mockRequireRole = vi.mocked(requireRole);
const mockClientFindUnique = prisma.client.findUnique as Mock;
const mockContactFindMany = prisma.clientContact.findMany as Mock;
const mockContactFindUnique = prisma.clientContact.findUnique as Mock;
const mockContactCreate = prisma.clientContact.create as Mock;
const mockContactUpdate = prisma.clientContact.update as Mock;

const CLIENT_ID = 'client-1';
const params = Promise.resolve({ id: CLIENT_ID });

function postReq(body: object): NextRequest {
  return new NextRequest(`http://localhost:3000/api/clients/${CLIENT_ID}/contacts`, {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('GET /api/clients/[id]/contacts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireAuth.mockResolvedValue({ userId: 'u1', role: 'pm', email: 'pm@x.com' });
  });

  it('404s when the client does not exist', async () => {
    mockClientFindUnique.mockResolvedValue(null);
    const response = await GET(new NextRequest('http://localhost/x'), { params });
    expect(response.status).toBe(404);
  });

  it('lists the client contacts', async () => {
    mockClientFindUnique.mockResolvedValue({ id: CLIENT_ID });
    mockContactFindMany.mockResolvedValue([{ id: 'c1', email: 'a@b.com' }]);
    const response = await GET(new NextRequest('http://localhost/x'), { params });
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.contacts).toHaveLength(1);
  });
});

describe('POST /api/clients/[id]/contacts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireAuth.mockResolvedValue({ userId: 'u1', role: 'pm', email: 'pm@x.com' });
    mockClientFindUnique.mockResolvedValue({ id: CLIENT_ID });
    mockContactFindUnique.mockResolvedValue(null);
    mockContactCreate.mockResolvedValue({ id: 'new-1', email: 'jane@example.com' });
  });

  it('creates a contact and trims the email', async () => {
    const response = await POST(postReq({ email: '  jane@example.com  ', can_initiate_work: true }), { params });
    expect(response.status).toBe(201);
    expect(mockContactCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          client_id: CLIENT_ID,
          email: 'jane@example.com',
          can_initiate_work: true,
        }),
      })
    );
  });

  it('derives can_initiate_work from the portal role on create (default viewer = false)', async () => {
    await POST(postReq({ email: 'a@example.com', portal_role: 'owner' }), { params });
    expect(mockContactCreate.mock.calls[0][0].data).toEqual(
      expect.objectContaining({ portal_role: 'owner', can_initiate_work: true })
    );
    mockContactCreate.mockClear();
    await POST(postReq({ email: 'b@example.com' }), { params });
    expect(mockContactCreate.mock.calls[0][0].data).toEqual(
      expect.objectContaining({ portal_role: 'viewer', can_initiate_work: false })
    );
    mockContactCreate.mockClear();
    // Legacy callers sending only can_initiate_work: true become members.
    await POST(postReq({ email: 'c@example.com', can_initiate_work: true }), { params });
    expect(mockContactCreate.mock.calls[0][0].data).toEqual(
      expect.objectContaining({ portal_role: 'member', can_initiate_work: true })
    );
  });

  it('rejects an invalid email', async () => {
    const response = await POST(postReq({ email: 'not-an-email' }), { params });
    const body = await response.json();
    expect(response.status).toBe(400);
    expect(body.error).toBe('Validation failed');
  });

  it('409s on a duplicate (client, email)', async () => {
    mockContactFindUnique.mockResolvedValue({ id: 'existing', is_deleted: false });
    const response = await POST(postReq({ email: 'dupe@example.com' }), { params });
    expect(response.status).toBe(409);
  });

  it('revives a soft-deleted contact instead of erroring', async () => {
    mockContactFindUnique.mockResolvedValue({ id: 'old-1', is_deleted: true });
    mockContactUpdate.mockResolvedValue({ id: 'old-1', email: 'back@example.com' });
    const response = await POST(postReq({ email: 'back@example.com', can_initiate_work: true }), { params });
    expect(response.status).toBe(201);
    expect(mockContactUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'old-1' },
        data: expect.objectContaining({ is_deleted: false, can_initiate_work: true }),
      })
    );
  });

  it('re-adding a deleted contact clears its old project grants', async () => {
    mockContactFindUnique.mockResolvedValue({ id: 'old-1', is_deleted: true });
    mockContactUpdate.mockResolvedValue({ id: 'old-1', email: 'back@example.com' });
    await POST(postReq({ email: 'back@example.com' }), { params });
    expect(prisma.projectContact.deleteMany).toHaveBeenCalledWith({ where: { contact_id: 'old-1' } });
  });

  it('404s when the client does not exist', async () => {
    mockClientFindUnique.mockResolvedValue(null);
    const response = await POST(postReq({ email: 'jane@example.com' }), { params });
    expect(response.status).toBe(404);
  });
});

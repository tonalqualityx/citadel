import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { PATCH, DELETE } from '../route';

vi.mock('@/lib/auth/middleware', () => ({
  requireAuth: vi.fn(),
  requireRole: vi.fn(),
}));

vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    clientContact: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
  },
}));

vi.mock('@/lib/api/formatters', () => ({
  formatClientContactResponse: vi.fn((c) => c),
}));

vi.mock('@/lib/services/activity', () => ({
  logUpdate: vi.fn(),
  logDelete: vi.fn(),
  detectChanges: vi.fn(() => ({})),
}));

import { requireAuth } from '@/lib/auth/middleware';
import { prisma } from '@/lib/db/prisma';
import type { Mock } from 'vitest';

const mockRequireAuth = vi.mocked(requireAuth);
const mockFindUnique = prisma.clientContact.findUnique as Mock;
const mockUpdate = prisma.clientContact.update as Mock;

const ID = 'contact-1';
const params = Promise.resolve({ id: ID });

function patchReq(body: object): NextRequest {
  return new NextRequest(`http://localhost:3000/api/contacts/${ID}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  });
}

const existing = {
  id: ID,
  client_id: 'client-1',
  name: 'Jane',
  email: 'jane@example.com',
  role: null,
  can_initiate_work: false,
  is_primary: false,
  is_deleted: false,
};

describe('PATCH /api/contacts/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireAuth.mockResolvedValue({ userId: 'u1', role: 'pm', email: 'pm@x.com' });
  });

  it('updates the authorization flag', async () => {
    mockFindUnique.mockResolvedValue(existing);
    mockUpdate.mockResolvedValue({ ...existing, can_initiate_work: true });
    const response = await PATCH(patchReq({ can_initiate_work: true }), { params });
    expect(response.status).toBe(200);
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: ID },
        data: expect.objectContaining({ can_initiate_work: true }),
      })
    );
  });

  it('404s when the contact is missing or deleted', async () => {
    mockFindUnique.mockResolvedValue(null);
    const response = await PATCH(patchReq({ role: 'Owner' }), { params });
    expect(response.status).toBe(404);
  });

  it('409s when changing email to one already used on the client', async () => {
    mockFindUnique
      .mockResolvedValueOnce(existing) // the target contact
      .mockResolvedValueOnce({ id: 'other', is_deleted: false }); // the clash
    const response = await PATCH(patchReq({ email: 'taken@example.com' }), { params });
    expect(response.status).toBe(409);
  });
});

describe('DELETE /api/contacts/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireAuth.mockResolvedValue({ userId: 'u1', role: 'pm', email: 'pm@x.com' });
  });

  it('soft-deletes the contact', async () => {
    mockFindUnique.mockResolvedValue(existing);
    mockUpdate.mockResolvedValue({ ...existing, is_deleted: true });
    const response = await DELETE(new NextRequest('http://localhost/x'), { params });
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(mockUpdate).toHaveBeenCalledWith({ where: { id: ID }, data: { is_deleted: true } });
  });

  it('404s when the contact is missing', async () => {
    mockFindUnique.mockResolvedValue(null);
    const response = await DELETE(new NextRequest('http://localhost/x'), { params });
    expect(response.status).toBe(404);
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { PATCH, DELETE } from '../route';
import type { Mock } from 'vitest';

vi.mock('@/lib/auth/middleware', () => ({
  requireAuth: vi.fn(),
}));

vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    timeEntry: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
  },
}));

import { requireAuth } from '@/lib/auth/middleware';
import { prisma } from '@/lib/db/prisma';

const mockRequireAuth = vi.mocked(requireAuth);
const mockFindUnique = prisma.timeEntry.findUnique as Mock;
const mockUpdate = prisma.timeEntry.update as Mock;

const ENTRY_ID = 'entry-123';
const OWNER_ID = 'user-owner';
const ADMIN_ID = 'user-admin';
const TECH_ID = 'user-tech';

const existingEntry = {
  id: ENTRY_ID,
  user_id: OWNER_ID,
  is_deleted: false,
  is_running: false,
};

const updatedEntry = {
  ...existingEntry,
  duration: 60,
  user: { id: OWNER_ID, name: 'Owner' },
  task: null,
  project: null,
};

function createPatchRequest(body: object): NextRequest {
  return new NextRequest(`http://localhost:3000/api/time-entries/${ENTRY_ID}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  });
}

function createDeleteRequest(): NextRequest {
  return new NextRequest(`http://localhost:3000/api/time-entries/${ENTRY_ID}`, {
    method: 'DELETE',
  });
}

const params = Promise.resolve({ id: ENTRY_ID });

describe('PATCH /api/time-entries/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFindUnique.mockResolvedValue(existingEntry);
    mockUpdate.mockResolvedValue(updatedEntry);
  });

  it('allows owner to edit their entry', async () => {
    mockRequireAuth.mockResolvedValue({ userId: OWNER_ID, role: 'tech', email: 'o@x.com' });

    const request = createPatchRequest({ duration: 60 });
    const response = await PATCH(request, { params });

    expect(response.status).toBe(200);
    expect(mockUpdate).toHaveBeenCalled();
  });

  it('allows admin to edit another user\'s entry', async () => {
    mockRequireAuth.mockResolvedValue({ userId: ADMIN_ID, role: 'admin', email: 'a@x.com' });

    const request = createPatchRequest({ duration: 60 });
    const response = await PATCH(request, { params });

    expect(response.status).toBe(200);
    expect(mockUpdate).toHaveBeenCalled();
  });

  it('allows pm to edit another user\'s entry', async () => {
    mockRequireAuth.mockResolvedValue({ userId: 'user-pm', role: 'pm', email: 'p@x.com' });

    const request = createPatchRequest({ duration: 60 });
    const response = await PATCH(request, { params });

    expect(response.status).toBe(200);
    expect(mockUpdate).toHaveBeenCalled();
  });

  it('rejects tech user editing another user\'s entry', async () => {
    mockRequireAuth.mockResolvedValue({ userId: TECH_ID, role: 'tech', email: 't@x.com' });

    const request = createPatchRequest({ duration: 60 });
    const response = await PATCH(request, { params });

    expect(response.status).toBe(403);
    expect(mockUpdate).not.toHaveBeenCalled();
  });
});

describe('DELETE /api/time-entries/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFindUnique.mockResolvedValue(existingEntry);
    mockUpdate.mockResolvedValue({ ...existingEntry, is_deleted: true });
  });

  it('allows owner to delete their entry', async () => {
    mockRequireAuth.mockResolvedValue({ userId: OWNER_ID, role: 'tech', email: 'o@x.com' });

    const request = createDeleteRequest();
    const response = await DELETE(request, { params });

    expect(response.status).toBe(200);
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: { is_deleted: true } })
    );
  });

  it('allows admin to delete another user\'s entry', async () => {
    mockRequireAuth.mockResolvedValue({ userId: ADMIN_ID, role: 'admin', email: 'a@x.com' });

    const request = createDeleteRequest();
    const response = await DELETE(request, { params });

    expect(response.status).toBe(200);
    expect(mockUpdate).toHaveBeenCalled();
  });

  it('rejects tech user deleting another user\'s entry', async () => {
    mockRequireAuth.mockResolvedValue({ userId: TECH_ID, role: 'tech', email: 't@x.com' });

    const request = createDeleteRequest();
    const response = await DELETE(request, { params });

    expect(response.status).toBe(403);
    expect(mockUpdate).not.toHaveBeenCalled();
  });
});

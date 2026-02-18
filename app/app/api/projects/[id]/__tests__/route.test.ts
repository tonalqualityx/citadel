import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { PATCH, GET } from '../route';

// Mock the auth middleware
vi.mock('@/lib/auth/middleware', () => ({
  requireAuth: vi.fn(),
  requireRole: vi.fn(),
}));

// Mock Prisma
vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    project: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    client: {
      findUnique: vi.fn(),
    },
    site: {
      findUnique: vi.fn(),
    },
  },
}));

// Mock formatters
vi.mock('@/lib/api/formatters', () => ({
  formatProjectResponse: vi.fn((project) => ({
    ...project,
  })),
}));

// Mock status calculations
vi.mock('@/lib/calculations/status', () => ({
  canTransitionProjectStatus: vi.fn(() => true),
}));

import { requireAuth, requireRole } from '@/lib/auth/middleware';
import { prisma } from '@/lib/db/prisma';
import type { Mock } from 'vitest';

const mockRequireAuth = vi.mocked(requireAuth);
const mockRequireRole = vi.mocked(requireRole);
const mockProjectFindUnique = prisma.project.findUnique as Mock;
const mockProjectUpdate = prisma.project.update as Mock;
const mockClientFindUnique = prisma.client.findUnique as Mock;

function createPatchRequest(body: object): NextRequest {
  return new NextRequest('http://localhost:3000/api/projects/proj-123', {
    method: 'PATCH',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  });
}

const mockParams = Promise.resolve({ id: 'proj-123' });

const mockProject = {
  id: 'proj-123',
  name: 'Test Project',
  description: null,
  status: 'in_progress',
  type: 'project',
  client_id: null,
  client: null,
  site_id: null,
  site: null,
  start_date: null,
  target_date: null,
  completed_date: null,
  billing_type: null,
  budget_hours: null,
  hourly_rate: null,
  budget_amount: null,
  budget_locked: false,
  budget_locked_at: null,
  is_retainer: false,
  notes: null,
  created_by_id: 'user-123',
  created_by: null,
  tasks: [],
  is_deleted: false,
  created_at: new Date(),
  updated_at: new Date(),
};

describe('PATCH /api/projects/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireAuth.mockResolvedValue({
      userId: 'user-123',
      role: 'pm',
      email: 'pm@example.com',
    });
    mockProjectUpdate.mockResolvedValue(mockProject);
  });

  describe('Description field serialization', () => {
    it('stringifies BlockNote content (array) when saving description', async () => {
      const blockNoteContent = [
        { type: 'paragraph', content: [{ type: 'text', text: 'Hello world' }] },
      ];

      const request = createPatchRequest({ description: blockNoteContent });
      const response = await PATCH(request, { params: mockParams });

      expect(response.status).toBe(200);
      expect(mockProjectUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            description: JSON.stringify(blockNoteContent),
          }),
        })
      );
    });

    it('sets description to null when null is provided', async () => {
      const request = createPatchRequest({ description: null });
      const response = await PATCH(request, { params: mockParams });

      expect(response.status).toBe(200);
      expect(mockProjectUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            description: null,
          }),
        })
      );
    });

    it('does not include description in updateData when not provided', async () => {
      const request = createPatchRequest({ name: 'Updated Name' });
      const response = await PATCH(request, { params: mockParams });

      expect(response.status).toBe(200);
      const updateCall = mockProjectUpdate.mock.calls[0][0];
      expect(updateCall.data).not.toHaveProperty('description');
      expect(updateCall.data.name).toBe('Updated Name');
    });
  });

  describe('Other field updates', () => {
    it('updates name field', async () => {
      const request = createPatchRequest({ name: 'New Name' });
      const response = await PATCH(request, { params: mockParams });

      expect(response.status).toBe(200);
      expect(mockProjectUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ name: 'New Name' }),
        })
      );
    });

    it('converts date strings to Date objects', async () => {
      const dateStr = '2025-06-15T00:00:00.000Z';
      const request = createPatchRequest({ start_date: dateStr });
      const response = await PATCH(request, { params: mockParams });

      expect(response.status).toBe(200);
      const updateCall = mockProjectUpdate.mock.calls[0][0];
      expect(updateCall.data.start_date).toEqual(new Date(dateStr));
    });

    it('clears date fields when null is provided', async () => {
      const request = createPatchRequest({ target_date: null });
      const response = await PATCH(request, { params: mockParams });

      expect(response.status).toBe(200);
      const updateCall = mockProjectUpdate.mock.calls[0][0];
      expect(updateCall.data.target_date).toBeNull();
    });

    it('updates budget fields', async () => {
      const request = createPatchRequest({ budget_hours: 100, hourly_rate: 150 });
      const response = await PATCH(request, { params: mockParams });

      expect(response.status).toBe(200);
      const updateCall = mockProjectUpdate.mock.calls[0][0];
      expect(updateCall.data.budget_hours).toBe(100);
      expect(updateCall.data.hourly_rate).toBe(150);
    });
  });

  describe('Authorization', () => {
    it('requires PM or Admin role', async () => {
      const request = createPatchRequest({ name: 'Updated' });
      await PATCH(request, { params: mockParams });

      expect(mockRequireRole).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 'user-123' }),
        ['pm', 'admin']
      );
    });

    it('returns error when not authenticated', async () => {
      const { ApiError } = await import('@/lib/api/errors');
      mockRequireAuth.mockRejectedValue(new ApiError('Unauthorized', 401));

      const request = createPatchRequest({ name: 'Updated' });
      const response = await PATCH(request, { params: mockParams });

      expect(response.status).toBe(401);
    });
  });

  describe('Client validation', () => {
    it('returns 404 when client_id references non-existent client', async () => {
      mockClientFindUnique.mockResolvedValue(null);

      const request = createPatchRequest({ client_id: '550e8400-e29b-41d4-a716-446655440001' });
      const response = await PATCH(request, { params: mockParams });

      expect(response.status).toBe(404);
    });
  });
});

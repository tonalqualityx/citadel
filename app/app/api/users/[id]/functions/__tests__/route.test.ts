import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { GET, POST, DELETE, PATCH } from '../route';

// Mock the auth middleware
vi.mock('@/lib/auth/middleware', () => ({
  requireAuth: vi.fn(),
  requireRole: vi.fn(),
}));

// Mock Prisma
vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    user: {
      findUnique: vi.fn(),
    },
    function: {
      findUnique: vi.fn(),
    },
    userFunction: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      delete: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
  },
}));

// Mock formatters
vi.mock('@/lib/api/formatters', () => ({
  formatUserFunctionResponse: vi.fn((uf) => ({
    id: uf.id,
    user_id: uf.user_id,
    function_id: uf.function_id,
    is_primary: uf.is_primary,
    function: uf.function,
  })),
}));

import { requireAuth, requireRole } from '@/lib/auth/middleware';
import { AuthError } from '@/lib/api/errors';
import { prisma } from '@/lib/db/prisma';
import type { Mock } from 'vitest';

const mockRequireAuth = vi.mocked(requireAuth);
const mockRequireRole = vi.mocked(requireRole);

// Type-safe mock accessors for Prisma methods
const mockUserFindUnique = prisma.user.findUnique as Mock;
const mockFunctionFindUnique = prisma.function.findUnique as Mock;
const mockUserFunctionFindMany = prisma.userFunction.findMany as Mock;
const mockUserFunctionFindUnique = prisma.userFunction.findUnique as Mock;
const mockUserFunctionCreate = prisma.userFunction.create as Mock;
const mockUserFunctionDelete = prisma.userFunction.delete as Mock;
const mockUserFunctionUpdate = prisma.userFunction.update as Mock;
const mockUserFunctionUpdateMany = prisma.userFunction.updateMany as Mock;

// Valid UUIDs for test data (must follow UUID v4 format)
const USER_ID = 'a1111111-1111-4111-a111-111111111111';
const FUNC_ID = 'b2222222-2222-4222-a222-222222222222';
const UF_ID = 'c3333333-3333-4333-a333-333333333333';

const mockUserFunction = {
  id: UF_ID,
  user_id: USER_ID,
  function_id: FUNC_ID,
  is_primary: false,
  function: { id: FUNC_ID, name: 'Development' },
  created_at: new Date(),
};

describe('User Functions API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUserFindUnique.mockResolvedValue({ id: USER_ID, name: 'Test' } as any);
    mockFunctionFindUnique.mockResolvedValue({ id: FUNC_ID, name: 'Development', is_active: true } as any);
    mockUserFunctionFindUnique.mockResolvedValue(null);
    mockUserFunctionCreate.mockResolvedValue(mockUserFunction as any);
    mockUserFunctionFindMany.mockResolvedValue([mockUserFunction] as any);
  });

  describe('GET /api/users/[id]/functions', () => {
    it('allows any authenticated user to read', async () => {
      mockRequireAuth.mockResolvedValue({
        userId: 'tech-user',
        role: 'tech',
        email: 'tech@example.com',
      });

      const request = new NextRequest(`http://localhost:3000/api/users/${USER_ID}/functions`);
      const response = await GET(request, { params: Promise.resolve({ id: USER_ID }) });

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.user_functions).toBeDefined();
    });
  });

  describe('POST /api/users/[id]/functions', () => {
    it('allows PM to add functions', async () => {
      mockRequireAuth.mockResolvedValue({
        userId: 'pm-user',
        role: 'pm',
        email: 'pm@example.com',
      });

      const request = new NextRequest(`http://localhost:3000/api/users/${USER_ID}/functions`, {
        method: 'POST',
        body: JSON.stringify({ function_id: FUNC_ID }),
        headers: { 'Content-Type': 'application/json' },
      });
      const response = await POST(request, { params: Promise.resolve({ id: USER_ID }) });

      expect(response.status).toBe(201);
      expect(mockUserFunctionCreate).toHaveBeenCalled();
    });

    it('allows Admin to add functions', async () => {
      mockRequireAuth.mockResolvedValue({
        userId: 'admin-user',
        role: 'admin',
        email: 'admin@example.com',
      });

      const request = new NextRequest(`http://localhost:3000/api/users/${USER_ID}/functions`, {
        method: 'POST',
        body: JSON.stringify({ function_id: FUNC_ID }),
        headers: { 'Content-Type': 'application/json' },
      });
      const response = await POST(request, { params: Promise.resolve({ id: USER_ID }) });

      expect(response.status).toBe(201);
    });

    it('rejects Tech user attempting to add functions', async () => {
      mockRequireAuth.mockResolvedValue({
        userId: 'tech-user',
        role: 'tech',
        email: 'tech@example.com',
      });
      mockRequireRole.mockImplementation((auth, roles) => {
        if (!roles.includes(auth.role as any)) {
          throw new AuthError('Insufficient permissions', 403);
        }
      });

      const request = new NextRequest(`http://localhost:3000/api/users/${USER_ID}/functions`, {
        method: 'POST',
        body: JSON.stringify({ function_id: FUNC_ID }),
        headers: { 'Content-Type': 'application/json' },
      });
      const response = await POST(request, { params: Promise.resolve({ id: USER_ID }) });

      expect(response.status).toBe(403);
    });

    it('rejects duplicate function assignment', async () => {
      mockRequireAuth.mockResolvedValue({
        userId: 'pm-user',
        role: 'pm',
        email: 'pm@example.com',
      });
      mockUserFunctionFindUnique.mockResolvedValue(mockUserFunction as any);

      const request = new NextRequest(`http://localhost:3000/api/users/${USER_ID}/functions`, {
        method: 'POST',
        body: JSON.stringify({ function_id: FUNC_ID }),
        headers: { 'Content-Type': 'application/json' },
      });
      const response = await POST(request, { params: Promise.resolve({ id: USER_ID }) });
      const body = await response.json();

      expect(response.status).toBe(400);
      expect(body.error).toBe('User already has this function');
    });
  });

  describe('DELETE /api/users/[id]/functions', () => {
    it('allows PM to remove functions', async () => {
      mockRequireAuth.mockResolvedValue({
        userId: 'pm-user',
        role: 'pm',
        email: 'pm@example.com',
      });
      mockUserFunctionDelete.mockResolvedValue(mockUserFunction as any);

      const request = new NextRequest(`http://localhost:3000/api/users/${USER_ID}/functions?function_id=${FUNC_ID}`, {
        method: 'DELETE',
      });
      const response = await DELETE(request, { params: Promise.resolve({ id: USER_ID }) });

      expect(response.status).toBe(200);
      expect(mockUserFunctionDelete).toHaveBeenCalled();
    });

    it('rejects Tech user attempting to remove functions', async () => {
      mockRequireAuth.mockResolvedValue({
        userId: 'tech-user',
        role: 'tech',
        email: 'tech@example.com',
      });
      mockRequireRole.mockImplementation((auth, roles) => {
        if (!roles.includes(auth.role as any)) {
          throw new AuthError('Insufficient permissions', 403);
        }
      });

      const request = new NextRequest(`http://localhost:3000/api/users/${USER_ID}/functions?function_id=${FUNC_ID}`, {
        method: 'DELETE',
      });
      const response = await DELETE(request, { params: Promise.resolve({ id: USER_ID }) });

      expect(response.status).toBe(403);
    });

    it('requires function_id parameter', async () => {
      mockRequireAuth.mockResolvedValue({
        userId: 'pm-user',
        role: 'pm',
        email: 'pm@example.com',
      });

      const request = new NextRequest(`http://localhost:3000/api/users/${USER_ID}/functions`, {
        method: 'DELETE',
      });
      const response = await DELETE(request, { params: Promise.resolve({ id: USER_ID }) });
      const body = await response.json();

      expect(response.status).toBe(400);
      expect(body.error).toBe('function_id is required');
    });
  });

  describe('PATCH /api/users/[id]/functions', () => {
    it('allows PM to set primary function', async () => {
      mockRequireAuth.mockResolvedValue({
        userId: 'pm-user',
        role: 'pm',
        email: 'pm@example.com',
      });
      mockUserFunctionUpdateMany.mockResolvedValue({ count: 1 });
      mockUserFunctionUpdate.mockResolvedValue({ ...mockUserFunction, is_primary: true } as any);

      const request = new NextRequest(`http://localhost:3000/api/users/${USER_ID}/functions?function_id=${FUNC_ID}`, {
        method: 'PATCH',
        body: JSON.stringify({ is_primary: true }),
        headers: { 'Content-Type': 'application/json' },
      });
      const response = await PATCH(request, { params: Promise.resolve({ id: USER_ID }) });

      expect(response.status).toBe(200);
      // Should unset existing primary first
      expect(mockUserFunctionUpdateMany).toHaveBeenCalledWith({
        where: { user_id: USER_ID, is_primary: true },
        data: { is_primary: false },
      });
    });

    it('rejects Tech user attempting to update functions', async () => {
      mockRequireAuth.mockResolvedValue({
        userId: 'tech-user',
        role: 'tech',
        email: 'tech@example.com',
      });
      mockRequireRole.mockImplementation((auth, roles) => {
        if (!roles.includes(auth.role as any)) {
          throw new AuthError('Insufficient permissions', 403);
        }
      });

      const request = new NextRequest(`http://localhost:3000/api/users/${USER_ID}/functions?function_id=${FUNC_ID}`, {
        method: 'PATCH',
        body: JSON.stringify({ is_primary: true }),
        headers: { 'Content-Type': 'application/json' },
      });
      const response = await PATCH(request, { params: Promise.resolve({ id: USER_ID }) });

      expect(response.status).toBe(403);
    });
  });
});

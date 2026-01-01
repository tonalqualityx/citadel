import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { PATCH } from '../route';

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
      findFirst: vi.fn(),
      update: vi.fn(),
    },
    session: {
      deleteMany: vi.fn(),
    },
  },
}));

// Mock bcrypt
vi.mock('bcryptjs', () => ({
  default: {
    hash: vi.fn().mockResolvedValue('hashed_password'),
  },
}));

import { requireAuth, requireRole } from '@/lib/auth/middleware';
import { AuthError } from '@/lib/api/errors';
import { prisma } from '@/lib/db/prisma';

const mockRequireAuth = vi.mocked(requireAuth);
const mockRequireRole = vi.mocked(requireRole);
const mockPrisma = vi.mocked(prisma);

function createRequest(body: object): NextRequest {
  return new NextRequest('http://localhost:3000/api/users/user-123', {
    method: 'PATCH',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  });
}

const mockUser = {
  id: 'user-123',
  name: 'Test User',
  email: 'test@example.com',
  role: 'tech',
  is_active: true,
  avatar_url: null,
  last_login_at: null,
  target_hours_per_week: 40,
  created_at: new Date(),
  updated_at: new Date(),
};

describe('PATCH /api/users/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.user.findFirst.mockResolvedValue(null); // No duplicate email by default
    mockPrisma.user.update.mockResolvedValue(mockUser);
  });

  describe('Role-based permissions', () => {
    it('allows admin to update role', async () => {
      mockRequireAuth.mockResolvedValue({
        userId: 'admin-user',
        role: 'admin',
        email: 'admin@example.com',
      });

      const request = createRequest({ role: 'pm' });
      const response = await PATCH(request, { params: Promise.resolve({ id: 'user-123' }) });

      expect(response.status).toBe(200);
      expect(mockPrisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ role: 'pm' }),
        })
      );
    });

    it('allows admin to update is_active', async () => {
      mockRequireAuth.mockResolvedValue({
        userId: 'admin-user',
        role: 'admin',
        email: 'admin@example.com',
      });

      const request = createRequest({ is_active: false });
      const response = await PATCH(request, { params: Promise.resolve({ id: 'user-123' }) });

      expect(response.status).toBe(200);
      expect(mockPrisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ is_active: false }),
        })
      );
    });

    it('allows PM to update name and email', async () => {
      mockRequireAuth.mockResolvedValue({
        userId: 'pm-user',
        role: 'pm',
        email: 'pm@example.com',
      });

      const request = createRequest({ name: 'New Name', email: 'newemail@example.com' });
      const response = await PATCH(request, { params: Promise.resolve({ id: 'user-123' }) });

      expect(response.status).toBe(200);
      expect(mockPrisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ name: 'New Name', email: 'newemail@example.com' }),
        })
      );
    });

    it('allows PM to update target_hours_per_week', async () => {
      mockRequireAuth.mockResolvedValue({
        userId: 'pm-user',
        role: 'pm',
        email: 'pm@example.com',
      });

      const request = createRequest({ target_hours_per_week: 32 });
      const response = await PATCH(request, { params: Promise.resolve({ id: 'user-123' }) });

      expect(response.status).toBe(200);
      expect(mockPrisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ target_hours_per_week: 32 }),
        })
      );
    });

    it('rejects PM attempting to change role', async () => {
      mockRequireAuth.mockResolvedValue({
        userId: 'pm-user',
        role: 'pm',
        email: 'pm@example.com',
      });

      const request = createRequest({ role: 'admin' });
      const response = await PATCH(request, { params: Promise.resolve({ id: 'user-123' }) });
      const body = await response.json();

      expect(response.status).toBe(403);
      expect(body.error).toBe('Only admins can change user roles');
    });

    it('rejects PM attempting to change is_active', async () => {
      mockRequireAuth.mockResolvedValue({
        userId: 'pm-user',
        role: 'pm',
        email: 'pm@example.com',
      });

      const request = createRequest({ is_active: false });
      const response = await PATCH(request, { params: Promise.resolve({ id: 'user-123' }) });
      const body = await response.json();

      expect(response.status).toBe(403);
      expect(body.error).toBe('Only admins can activate/deactivate users');
    });
  });

  describe('Self-modification restrictions', () => {
    it('prevents user from deactivating themselves', async () => {
      mockRequireAuth.mockResolvedValue({
        userId: 'user-123', // Same as target user
        role: 'admin',
        email: 'admin@example.com',
      });

      const request = createRequest({ is_active: false });
      const response = await PATCH(request, { params: Promise.resolve({ id: 'user-123' }) });
      const body = await response.json();

      expect(response.status).toBe(400);
      expect(body.error).toBe('You cannot deactivate your own account');
    });

    it('prevents user from changing their own role', async () => {
      mockRequireAuth.mockResolvedValue({
        userId: 'user-123', // Same as target user
        role: 'admin',
        email: 'admin@example.com',
      });

      const request = createRequest({ role: 'tech' });
      const response = await PATCH(request, { params: Promise.resolve({ id: 'user-123' }) });
      const body = await response.json();

      expect(response.status).toBe(400);
      expect(body.error).toBe('You cannot change your own role');
    });

    it('allows user to update their own name', async () => {
      mockRequireAuth.mockResolvedValue({
        userId: 'user-123', // Same as target user
        role: 'admin',
        email: 'admin@example.com',
      });

      const request = createRequest({ name: 'My New Name' });
      const response = await PATCH(request, { params: Promise.resolve({ id: 'user-123' }) });

      expect(response.status).toBe(200);
      expect(mockPrisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ name: 'My New Name' }),
        })
      );
    });
  });

  describe('Email uniqueness', () => {
    it('rejects update if email is already taken', async () => {
      mockRequireAuth.mockResolvedValue({
        userId: 'admin-user',
        role: 'admin',
        email: 'admin@example.com',
      });

      // Another user has this email
      mockPrisma.user.findFirst.mockResolvedValue({
        id: 'other-user',
        email: 'taken@example.com',
      } as any);

      const request = createRequest({ email: 'taken@example.com' });
      const response = await PATCH(request, { params: Promise.resolve({ id: 'user-123' }) });
      const body = await response.json();

      expect(response.status).toBe(400);
      expect(body.error).toBe('A user with this email already exists');
    });
  });

  describe('Password reset (admin only)', () => {
    it('allows admin to reset password', async () => {
      mockRequireAuth.mockResolvedValue({
        userId: 'admin-user',
        role: 'admin',
        email: 'admin@example.com',
      });

      const request = createRequest({ password: 'newpassword123' });
      const response = await PATCH(request, { params: Promise.resolve({ id: 'user-123' }) });

      expect(response.status).toBe(200);
      expect(mockPrisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { password_hash: 'hashed_password' },
        })
      );
      // Should invalidate sessions
      expect(mockPrisma.session.deleteMany).toHaveBeenCalledWith({
        where: { user_id: 'user-123' },
      });
    });

    it('rejects PM attempting to reset password', async () => {
      mockRequireAuth.mockResolvedValue({
        userId: 'pm-user',
        role: 'pm',
        email: 'pm@example.com',
      });
      // Mock requireRole to throw AuthError for admin-only action
      mockRequireRole.mockImplementation((auth, roles) => {
        if (roles.includes('admin') && auth.role !== 'admin') {
          throw new AuthError('Insufficient permissions', 403);
        }
      });

      const request = createRequest({ password: 'newpassword123' });
      const response = await PATCH(request, { params: Promise.resolve({ id: 'user-123' }) });

      expect(response.status).toBe(403);
    });
  });
});

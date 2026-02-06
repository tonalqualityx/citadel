import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AuthError } from '@/lib/api/errors';

// Mock next/headers
vi.mock('next/headers', () => ({
  cookies: vi.fn(),
  headers: vi.fn(),
}));

// Mock JWT verification
vi.mock('@/lib/auth/jwt', () => ({
  verifyAccessToken: vi.fn(),
}));

// Mock api-keys
vi.mock('@/lib/auth/api-keys', () => ({
  hashApiKey: vi.fn(),
}));

// Mock Prisma
vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    user: { findUnique: vi.fn() },
    apiKey: { findFirst: vi.fn(), update: vi.fn() },
  },
}));

import { cookies, headers } from 'next/headers';
import { verifyAccessToken } from '@/lib/auth/jwt';
import { hashApiKey } from '@/lib/auth/api-keys';
import { prisma } from '@/lib/db/prisma';
import { requireAuth, getOptionalAuth } from '../middleware';
import type { Mock } from 'vitest';

const mockCookies = cookies as Mock;
const mockHeaders = headers as Mock;
const mockVerifyAccessToken = verifyAccessToken as Mock;
const mockHashApiKey = hashApiKey as Mock;
const mockUserFindUnique = prisma.user.findUnique as Mock;
const mockApiKeyFindFirst = prisma.apiKey.findFirst as Mock;
const mockApiKeyUpdate = prisma.apiKey.update as Mock;

const validTokenPayload = {
  userId: 'user-123',
  email: 'test@example.com',
  role: 'pm',
};

function setupCookieAuth(token: string | undefined) {
  mockCookies.mockResolvedValue({
    get: vi.fn((name: string) =>
      name === 'access_token' && token ? { value: token } : undefined
    ),
  });
}

function setupBearerAuth(bearerToken: string | undefined) {
  mockHeaders.mockResolvedValue({
    get: vi.fn((name: string) =>
      name === 'authorization' && bearerToken
        ? `Bearer ${bearerToken}`
        : null
    ),
  });
}

function setupNoCookieNoBearerHeaders() {
  mockCookies.mockResolvedValue({
    get: vi.fn(() => undefined),
  });
  mockHeaders.mockResolvedValue({
    get: vi.fn(() => null),
  });
}

describe('requireAuth', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockApiKeyUpdate.mockResolvedValue({});
  });

  describe('Cookie JWT path', () => {
    beforeEach(() => {
      setupCookieAuth('valid-jwt-token');
      // headers shouldn't be reached but set up as fallback
      setupBearerAuth(undefined);
    });

    it('returns TokenPayload when valid cookie JWT present', async () => {
      mockVerifyAccessToken.mockResolvedValue(validTokenPayload);
      mockUserFindUnique.mockResolvedValue({ id: 'user-123', is_active: true });

      const result = await requireAuth();

      expect(result).toEqual(validTokenPayload);
      expect(mockVerifyAccessToken).toHaveBeenCalledWith('valid-jwt-token');
    });

    it('throws AuthError when user not found', async () => {
      mockVerifyAccessToken.mockResolvedValue(validTokenPayload);
      mockUserFindUnique.mockResolvedValue(null);

      await expect(requireAuth()).rejects.toThrow(AuthError);
      await expect(requireAuth()).rejects.toThrow('User not found or inactive');
    });

    it('throws AuthError when user is inactive', async () => {
      mockVerifyAccessToken.mockResolvedValue(validTokenPayload);
      mockUserFindUnique.mockResolvedValue({ id: 'user-123', is_active: false });

      await expect(requireAuth()).rejects.toThrow(AuthError);
    });

    it('throws AuthError when JWT verification fails', async () => {
      mockVerifyAccessToken.mockRejectedValue(new Error('Invalid JWT'));

      await expect(requireAuth()).rejects.toThrow(AuthError);
      await expect(requireAuth()).rejects.toThrow('Invalid token');
    });
  });

  describe('Bearer token path', () => {
    beforeEach(() => {
      setupCookieAuth(undefined);
      setupBearerAuth('citadel_testapikey123');
      mockHashApiKey.mockReturnValue('hashed-key');
    });

    it('returns TokenPayload when valid bearer token present', async () => {
      mockApiKeyFindFirst.mockResolvedValue({
        id: 'key-1',
        expires_at: null,
        user: { id: 'user-123', email: 'test@example.com', role: 'pm', is_active: true },
      });

      const result = await requireAuth();

      expect(result).toEqual({
        userId: 'user-123',
        email: 'test@example.com',
        role: 'pm',
      });
      expect(mockHashApiKey).toHaveBeenCalledWith('citadel_testapikey123');
    });

    it('throws AuthError for invalid/unknown key (no DB match)', async () => {
      mockApiKeyFindFirst.mockResolvedValue(null);

      await expect(requireAuth()).rejects.toThrow(AuthError);
      await expect(requireAuth()).rejects.toThrow('Invalid API key');
    });

    it('throws AuthError for expired key', async () => {
      mockApiKeyFindFirst.mockResolvedValue({
        id: 'key-1',
        expires_at: new Date('2020-01-01'),
        user: { id: 'user-123', email: 'test@example.com', role: 'pm', is_active: true },
      });

      await expect(requireAuth()).rejects.toThrow(AuthError);
      await expect(requireAuth()).rejects.toThrow('API key has expired');
    });

    it('throws AuthError for inactive user behind key', async () => {
      mockApiKeyFindFirst.mockResolvedValue({
        id: 'key-1',
        expires_at: null,
        user: { id: 'user-123', email: 'test@example.com', role: 'pm', is_active: false },
      });

      await expect(requireAuth()).rejects.toThrow(AuthError);
      await expect(requireAuth()).rejects.toThrow('User account is inactive');
    });

    it('updates last_used_at (fire-and-forget)', async () => {
      mockApiKeyFindFirst.mockResolvedValue({
        id: 'key-1',
        expires_at: null,
        user: { id: 'user-123', email: 'test@example.com', role: 'pm', is_active: true },
      });

      await requireAuth();

      expect(mockApiKeyUpdate).toHaveBeenCalledWith({
        where: { id: 'key-1' },
        data: { last_used_at: expect.any(Date) },
      });
    });
  });

  describe('Fallback order', () => {
    it('uses cookie JWT when both cookie and bearer header present', async () => {
      setupCookieAuth('valid-jwt-token');
      setupBearerAuth('citadel_testapikey123');
      mockVerifyAccessToken.mockResolvedValue(validTokenPayload);
      mockUserFindUnique.mockResolvedValue({ id: 'user-123', is_active: true });

      const result = await requireAuth();

      expect(result).toEqual(validTokenPayload);
      expect(mockVerifyAccessToken).toHaveBeenCalledWith('valid-jwt-token');
      // API key path should not be reached
      expect(mockHashApiKey).not.toHaveBeenCalled();
    });

    it('falls back to bearer when no cookie', async () => {
      setupCookieAuth(undefined);
      setupBearerAuth('citadel_testapikey123');
      mockHashApiKey.mockReturnValue('hashed-key');
      mockApiKeyFindFirst.mockResolvedValue({
        id: 'key-1',
        expires_at: null,
        user: { id: 'user-123', email: 'test@example.com', role: 'pm', is_active: true },
      });

      const result = await requireAuth();

      expect(result).toEqual({
        userId: 'user-123',
        email: 'test@example.com',
        role: 'pm',
      });
    });

    it('throws AuthError when neither cookie nor bearer present', async () => {
      setupNoCookieNoBearerHeaders();

      await expect(requireAuth()).rejects.toThrow(AuthError);
      await expect(requireAuth()).rejects.toThrow('Authentication required');
    });
  });
});

describe('getOptionalAuth', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns null when no auth (does not throw)', async () => {
    setupNoCookieNoBearerHeaders();

    const result = await getOptionalAuth();

    expect(result).toBeNull();
  });

  it('returns TokenPayload when auth is present', async () => {
    setupCookieAuth('valid-jwt-token');
    setupBearerAuth(undefined);
    mockVerifyAccessToken.mockResolvedValue(validTokenPayload);
    mockUserFindUnique.mockResolvedValue({ id: 'user-123', is_active: true });

    const result = await getOptionalAuth();

    expect(result).toEqual(validTokenPayload);
  });
});

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

      expect(result).toEqual({ ...validTokenPayload, via: 'session' });
      expect(mockVerifyAccessToken).toHaveBeenCalledWith('valid-jwt-token');
    });

    it('marks a cookie login as via session, whatever the token claims', async () => {
      mockVerifyAccessToken.mockResolvedValue({ ...validTokenPayload, via: 'api_key' });
      mockUserFindUnique.mockResolvedValue({ id: 'user-123', is_active: true });
      expect((await requireAuth()).via).toBe('session');
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
        via: 'api_key',
        apiKeyId: 'key-1',
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

      expect(result).toEqual({ ...validTokenPayload, via: 'session' });
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
        via: 'api_key',
        apiKeyId: 'key-1',
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

    expect(result).toEqual({ ...validTokenPayload, via: 'session' });
  });
});

// Designer Portal (design D1): the designer allowlist in the session branch, and no API keys.
describe('requireAuth designer role', () => {
  const designerToken = { userId: 'designer-1', email: 'lisa@example.test', role: 'designer' };

  function setupSessionWithRoute(route: string | null) {
    setupCookieAuth('valid-jwt-token');
    mockHeaders.mockResolvedValue({
      get: vi.fn((name: string) => (name === 'x-citadel-route' ? route : null)),
    });
  }

  beforeEach(() => {
    vi.clearAllMocks();
    mockApiKeyUpdate.mockResolvedValue({});
  });

  it('a designer session on an allowlisted route passes, with the token role and via session', async () => {
    setupSessionWithRoute('GET /api/design/sessions/abc/feed');
    mockVerifyAccessToken.mockResolvedValue(designerToken);
    mockUserFindUnique.mockResolvedValue({ id: 'designer-1', is_active: true, role: 'designer' });

    expect(await requireAuth()).toEqual({ ...designerToken, via: 'session' });
    expect(mockUserFindUnique).toHaveBeenCalledWith({
      where: { id: 'designer-1' },
      select: { id: true, is_active: true, role: true },
    });
  });

  it('a designer session on a staff route is 403', async () => {
    for (const route of ['GET /api/clients', 'GET /api/time-entries/active', 'POST /api/api-keys', 'GET /api/admin/settings']) {
      setupSessionWithRoute(route);
      mockVerifyAccessToken.mockResolvedValue(designerToken);
      mockUserFindUnique.mockResolvedValue({ id: 'designer-1', is_active: true, role: 'designer' });
      const err = await requireAuth().catch((e) => e);
      expect(err).toBeInstanceOf(AuthError);
      expect(err.statusCode).toBe(403);
    }
  });

  it('a designer session with no route header is 403', async () => {
    setupSessionWithRoute(null);
    mockVerifyAccessToken.mockResolvedValue(designerToken);
    mockUserFindUnique.mockResolvedValue({ id: 'designer-1', is_active: true, role: 'designer' });
    const err = await requireAuth().catch((e) => e);
    expect(err).toBeInstanceOf(AuthError);
    expect(err.statusCode).toBe(403);
  });

  it('the DB role decides: a stale pm token for a user now a designer is held to the allowlist', async () => {
    setupSessionWithRoute('GET /api/clients');
    mockVerifyAccessToken.mockResolvedValue(validTokenPayload);
    mockUserFindUnique.mockResolvedValue({ id: 'user-123', is_active: true, role: 'designer' });
    const err = await requireAuth().catch((e) => e);
    expect(err).toBeInstanceOf(AuthError);
    expect(err.statusCode).toBe(403);
  });

  it('a pm session on a staff route still passes and never reads headers', async () => {
    setupSessionWithRoute('GET /api/clients');
    mockVerifyAccessToken.mockResolvedValue(validTokenPayload);
    mockUserFindUnique.mockResolvedValue({ id: 'user-123', is_active: true, role: 'pm' });

    expect(await requireAuth()).toEqual({ ...validTokenPayload, via: 'session' });
    expect(mockHeaders).not.toHaveBeenCalled();
  });

  it('a designer API key is 403, even on an allowlisted route, and is not marked used', async () => {
    setupCookieAuth(undefined);
    mockHeaders.mockResolvedValue({
      get: vi.fn((name: string) => {
        if (name === 'authorization') return 'Bearer citadel_designerkey';
        if (name === 'x-citadel-route') return 'GET /api/auth/me';
        return null;
      }),
    });
    mockHashApiKey.mockReturnValue('hashed-key');
    mockApiKeyFindFirst.mockResolvedValue({
      id: 'key-d',
      key_prefix: 'citadel_desi',
      scopes: [],
      expires_at: null,
      user: { id: 'designer-1', email: 'lisa@example.test', role: 'designer', is_active: true },
    });

    const err = await requireAuth().catch((e) => e);
    expect(err).toBeInstanceOf(AuthError);
    expect(err.statusCode).toBe(403);
    expect(mockApiKeyUpdate).not.toHaveBeenCalled();
  });
});

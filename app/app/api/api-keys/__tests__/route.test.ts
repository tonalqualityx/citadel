import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { GET, POST } from '../route';

// Mock auth middleware
vi.mock('@/lib/auth/middleware', () => ({
  requireAuth: vi.fn(),
}));

// Mock Prisma
vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    apiKey: {
      findMany: vi.fn(),
      create: vi.fn(),
    },
  },
}));

// Mock api-keys utility
vi.mock('@/lib/auth/api-keys', () => ({
  generateApiKey: vi.fn(),
}));

// Mock activity logging
vi.mock('@/lib/services/activity', () => ({
  logCreate: vi.fn(),
}));

import { requireAuth } from '@/lib/auth/middleware';
import { prisma } from '@/lib/db/prisma';
import { generateApiKey } from '@/lib/auth/api-keys';
import { logCreate } from '@/lib/services/activity';
import type { Mock } from 'vitest';

const mockRequireAuth = requireAuth as Mock;
const mockFindMany = prisma.apiKey.findMany as Mock;
const mockCreate = prisma.apiKey.create as Mock;
const mockGenerateApiKey = generateApiKey as Mock;
const mockLogCreate = logCreate as Mock;

const authPayload = { userId: 'user-123', email: 'test@example.com', role: 'pm' };

function createPostRequest(body: object): NextRequest {
  return new NextRequest('http://localhost:3000/api/api-keys', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('GET /api/api-keys', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireAuth.mockResolvedValue(authPayload);
  });

  it('returns user\'s non-revoked API keys', async () => {
    const mockKeys = [
      {
        id: 'key-1',
        name: 'My Key',
        key_prefix: 'citadel_abcd1234',
        last_used_at: null,
        expires_at: null,
        created_at: new Date('2024-01-01'),
      },
    ];
    mockFindMany.mockResolvedValue(mockKeys);

    const response = await GET();
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.api_keys).toHaveLength(1);
    expect(data.api_keys[0].name).toBe('My Key');
    expect(mockFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { user_id: 'user-123', is_revoked: false },
      })
    );
  });

  it('never returns key_hash in response', async () => {
    mockFindMany.mockResolvedValue([
      {
        id: 'key-1',
        name: 'My Key',
        key_prefix: 'citadel_abcd1234',
        last_used_at: null,
        expires_at: null,
        created_at: new Date(),
      },
    ]);

    const response = await GET();
    const data = await response.json();

    expect(data.api_keys[0]).not.toHaveProperty('key_hash');
  });

  it('returns 401 when not authenticated', async () => {
    const { AuthError } = await import('@/lib/api/errors');
    mockRequireAuth.mockRejectedValue(new AuthError('Authentication required', 401));

    const response = await GET();

    expect(response.status).toBe(401);
  });
});

describe('POST /api/api-keys', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireAuth.mockResolvedValue(authPayload);
    mockGenerateApiKey.mockReturnValue({
      rawKey: 'citadel_abc123def456',
      keyHash: 'hashed-value',
      keyPrefix: 'citadel_abc123de',
    });
    mockCreate.mockResolvedValue({
      id: 'key-new',
      name: 'Test Key',
      key_hash: 'hashed-value',
      key_prefix: 'citadel_abc123de',
      expires_at: null,
      created_at: new Date('2024-01-01'),
    });
    mockLogCreate.mockResolvedValue(undefined);
  });

  it('creates key with valid name and returns raw key once', async () => {
    const request = createPostRequest({ name: 'Test Key' });

    const response = await POST(request);
    const data = await response.json();

    expect(data.key).toBe('citadel_abc123def456');
    expect(data.name).toBe('Test Key');
    expect(data.key_prefix).toBe('citadel_abc123de');
    // Should not expose the hash
    expect(data).not.toHaveProperty('key_hash');
  });

  it('returns 201 status', async () => {
    const request = createPostRequest({ name: 'Test Key' });

    const response = await POST(request);

    expect(response.status).toBe(201);
  });

  it('stores hashed key in database', async () => {
    const request = createPostRequest({ name: 'Test Key' });

    await POST(request);

    expect(mockCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        user_id: 'user-123',
        name: 'Test Key',
        key_hash: 'hashed-value',
        key_prefix: 'citadel_abc123de',
        expires_at: null,
      }),
    });
  });

  it('handles optional expires_at', async () => {
    const request = createPostRequest({
      name: 'Expiring Key',
      expires_at: '2025-12-31T00:00:00.000Z',
    });

    await POST(request);

    expect(mockCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        expires_at: new Date('2025-12-31T00:00:00.000Z'),
      }),
    });
  });

  it('logs activity via logCreate', async () => {
    const request = createPostRequest({ name: 'Test Key' });

    await POST(request);

    expect(mockLogCreate).toHaveBeenCalledWith('user-123', 'api_key', 'key-new', 'Test Key');
  });

  it('returns 400 for missing name', async () => {
    const request = createPostRequest({});

    const response = await POST(request);

    expect(response.status).toBe(400);
  });

  it('returns 400 for empty name', async () => {
    const request = createPostRequest({ name: '' });

    const response = await POST(request);

    expect(response.status).toBe(400);
  });

  it('returns 401 when not authenticated', async () => {
    const { AuthError } = await import('@/lib/api/errors');
    mockRequireAuth.mockRejectedValue(new AuthError('Authentication required', 401));

    const request = createPostRequest({ name: 'Test Key' });
    const response = await POST(request);

    expect(response.status).toBe(401);
  });
});

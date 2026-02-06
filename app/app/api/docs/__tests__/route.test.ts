import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GET } from '../route';

// Mock auth middleware
vi.mock('@/lib/auth/middleware', () => ({
  requireAuth: vi.fn(),
}));

// Mock registry
vi.mock('@/lib/api/registry', () => ({
  apiRegistry: [
    { path: '/api/test', methods: [{ method: 'GET', summary: 'Test endpoint' }] },
  ],
  apiEnums: { status: ['active', 'inactive'] },
  apiInfo: { title: 'Citadel API', version: '1.0' },
}));

import { requireAuth } from '@/lib/auth/middleware';
import type { Mock } from 'vitest';

const mockRequireAuth = requireAuth as Mock;

const authPayload = { userId: 'user-123', email: 'test@example.com', role: 'pm' };

describe('GET /api/docs', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireAuth.mockResolvedValue(authPayload);
  });

  it('returns 200 with endpoints, enums, and info properties', async () => {
    const response = await GET();
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toHaveProperty('endpoints');
    expect(data).toHaveProperty('enums');
    expect(data).toHaveProperty('info');
  });

  it('endpoints is a non-empty array', async () => {
    const response = await GET();
    const data = await response.json();

    expect(Array.isArray(data.endpoints)).toBe(true);
    expect(data.endpoints.length).toBeGreaterThan(0);
  });

  it('returns 401 when not authenticated', async () => {
    const { AuthError } = await import('@/lib/api/errors');
    mockRequireAuth.mockRejectedValue(new AuthError('Authentication required', 401));

    const response = await GET();

    expect(response.status).toBe(401);
  });
});

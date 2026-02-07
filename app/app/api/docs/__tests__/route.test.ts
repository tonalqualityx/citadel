import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { GET } from '../route';

// Mock auth middleware
vi.mock('@/lib/auth/middleware', () => ({
  requireAuth: vi.fn(),
}));

// Mock registry
vi.mock('@/lib/api/registry', () => ({
  apiRegistry: [
    {
      path: '/api/test',
      group: 'test-group',
      methods: [
        {
          method: 'GET',
          summary: 'Test endpoint',
          auth: 'required',
          queryParams: [{ name: 'q', type: 'string', required: false, description: 'Search' }],
          responseExample: { id: 'uuid', name: 'string' },
        },
      ],
    },
    {
      path: '/api/other',
      group: 'other-group',
      methods: [{ method: 'POST', summary: 'Other endpoint', auth: 'required' }],
    },
  ],
  apiEnums: { status: ['active', 'inactive'] },
  apiInfo: { title: 'Citadel API', version: '1.0' },
}));

import { requireAuth } from '@/lib/auth/middleware';
import type { Mock } from 'vitest';

const mockRequireAuth = requireAuth as Mock;

const authPayload = { userId: 'user-123', email: 'test@example.com', role: 'pm' };

function makeRequest(url = 'http://localhost/api/docs') {
  return new NextRequest(url);
}

describe('GET /api/docs', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireAuth.mockResolvedValue(authPayload);
  });

  it('returns summary with availableGroups when no group param', async () => {
    const response = await GET(makeRequest());
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toHaveProperty('endpoints');
    expect(data).toHaveProperty('enums');
    expect(data).toHaveProperty('info');
    expect(data).toHaveProperty('availableGroups');
    expect(data.availableGroups).toContain('test-group');
    expect(data.availableGroups).toContain('other-group');
  });

  it('summary endpoints do not include responseExample or queryParams', async () => {
    const response = await GET(makeRequest());
    const data = await response.json();

    const endpoint = data.endpoints[0];
    expect(endpoint.methods[0]).not.toHaveProperty('responseExample');
    expect(endpoint.methods[0]).not.toHaveProperty('queryParams');
    expect(endpoint.methods[0]).toHaveProperty('summary');
    expect(endpoint.methods[0]).toHaveProperty('method');
  });

  it('returns full detail when group param is provided', async () => {
    const response = await GET(makeRequest('http://localhost/api/docs?group=test-group'));
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.endpoints).toHaveLength(1);
    expect(data.endpoints[0].path).toBe('/api/test');
    expect(data.endpoints[0].methods[0]).toHaveProperty('responseExample');
    expect(data.endpoints[0].methods[0]).toHaveProperty('queryParams');
    expect(data).not.toHaveProperty('availableGroups');
  });

  it('returns empty endpoints for unknown group', async () => {
    const response = await GET(makeRequest('http://localhost/api/docs?group=nonexistent'));
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.endpoints).toHaveLength(0);
  });

  it('returns 401 when not authenticated', async () => {
    const { AuthError } = await import('@/lib/api/errors');
    mockRequireAuth.mockRejectedValue(new AuthError('Authentication required', 401));

    const response = await GET(makeRequest());

    expect(response.status).toBe(401);
  });
});

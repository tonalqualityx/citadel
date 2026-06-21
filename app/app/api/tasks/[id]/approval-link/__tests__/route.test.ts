import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/auth/middleware', () => ({
  requireAuth: vi.fn(),
  requireRole: vi.fn(),
}));

vi.mock('@/lib/services/portal', () => ({
  ensureTaskPortalToken: vi.fn(),
}));

import { POST } from '../route';
import { requireAuth, requireRole } from '@/lib/auth/middleware';
import { ensureTaskPortalToken } from '@/lib/services/portal';
import type { Mock } from 'vitest';

const mockRequireAuth = requireAuth as Mock;
const mockRequireRole = requireRole as Mock;
const mockEnsureToken = ensureTaskPortalToken as Mock;

function makeRequest(): NextRequest {
  return new NextRequest(new URL('http://localhost/api/tasks/task-1/approval-link'), { method: 'POST' } as any);
}

function makeParams(id: string) {
  return { params: Promise.resolve({ id }) };
}

describe('POST /api/tasks/:id/approval-link', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireAuth.mockResolvedValue({ userId: 'u1', role: 'pm', email: 'pm@test.com' });
    mockRequireRole.mockReturnValue(undefined);
  });

  it('returns the public approval URL for the task token', async () => {
    mockEnsureToken.mockResolvedValue({
      token: 'fresh-token',
      expiresAt: new Date('2026-08-20T00:00:00Z'),
      url: 'http://localhost:3000/portal/task-approval/fresh-token',
    });

    const response = await POST(makeRequest(), makeParams('task-1'));
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(mockEnsureToken).toHaveBeenCalledWith('task-1');
    expect(data.token).toBe('fresh-token');
    expect(data.url).toContain('/portal/task-approval/fresh-token');
    expect(data.expires_at).toBe('2026-08-20T00:00:00.000Z');
  });

  it('returns 404 for a missing or deleted task', async () => {
    mockEnsureToken.mockResolvedValue(null);

    const response = await POST(makeRequest(), makeParams('task-1'));
    const data = await response.json();

    expect(response.status).toBe(404);
    expect(data.error).toBe('Task not found');
  });
});

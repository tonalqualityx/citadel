import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { AuthError } from '@/lib/api/errors';

// Session-scoped list endpoint (GET /api/portal/tasks) — distinct from the token-gated
// tasks/[token]/* flow, whose own tests live in __tests__/route.test.ts.
vi.mock('@/lib/services/client-auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/services/client-auth')>();
  return { ...actual, requireClientAuth: vi.fn() };
});

vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    task: { findMany: vi.fn() },
  },
}));

import { GET } from '../route';
import { requireClientAuth } from '@/lib/services/client-auth';
import { prisma } from '@/lib/db/prisma';
import type { Mock } from 'vitest';

const mockRequireClientAuth = requireClientAuth as Mock;
const mockTaskFindMany = prisma.task.findMany as Mock;

function makeRequest(): NextRequest {
  return new NextRequest(new URL('http://localhost/api/portal/tasks'));
}

const internalPendingRow = {
  id: 'task-1',
  title: 'Homepage refresh',
  description: null,
  status: 'review',
  estimated_minutes: 90,
  staging_preview_url: 'https://staging.example.com/preview',
  staging_deployed_at: new Date('2026-06-21T10:00:00Z'),
  created_at: new Date('2026-06-20T10:00:00Z'),
  updated_at: new Date('2026-06-21T09:00:00Z'),
  // internal-only fields that would be present on a real Prisma row but must never appear
  // through formatTaskForClient's allow-list.
  billing_amount: 5000,
  assignee_id: 'user-1',
  needs_review: true,
};

const approvedRow = {
  id: 'task-2',
  title: 'Fix broken link',
  description: null,
  status: 'done',
  estimated_minutes: 30,
  client_approved_at: new Date('2026-06-18T10:00:00Z'),
  created_at: new Date('2026-06-17T10:00:00Z'),
  updated_at: new Date('2026-06-18T10:00:00Z'),
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('GET /api/portal/tasks', () => {
  it('returns 401 when there is no client session', async () => {
    mockRequireClientAuth.mockRejectedValue(new AuthError('Client authentication required', 401));

    const res = await GET(makeRequest());
    expect(res.status).toBe(401);
    expect(mockTaskFindMany).not.toHaveBeenCalled();
  });

  it('scopes both queries to the session client via client_id OR site.client_id', async () => {
    mockRequireClientAuth.mockResolvedValue({ clientId: 'client-acme', contactId: 'contact-1' });
    mockTaskFindMany.mockResolvedValue([]);

    await GET(makeRequest());

    expect(mockTaskFindMany).toHaveBeenCalledTimes(2);
    for (const call of mockTaskFindMany.mock.calls) {
      expect(call[0].where.OR).toEqual([
        { client_id: 'client-acme' },
        { site: { client_id: 'client-acme' } },
      ]);
      expect(call[0].where.is_deleted).toBe(false);
    }
    // First call = pending (client_approved_at: null), second = recently approved (not null).
    expect(mockTaskFindMany.mock.calls[0][0].where.client_approved_at).toBeNull();
    expect(mockTaskFindMany.mock.calls[1][0].where.client_approved_at).toEqual({ not: null });
  });

  it('projects pending + recently-approved tasks client-safe, with staging fields on pending', async () => {
    mockRequireClientAuth.mockResolvedValue({ clientId: 'client-acme', contactId: 'contact-1' });
    mockTaskFindMany.mockResolvedValueOnce([internalPendingRow]).mockResolvedValueOnce([approvedRow]);

    const res = await GET(makeRequest());
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.pending).toHaveLength(1);
    expect(body.pending[0]).toMatchObject({
      id: 'task-1',
      title: 'Homepage refresh',
      status: 'review',
      staging_preview_url: 'https://staging.example.com/preview',
    });
    expect(body.pending[0]).not.toHaveProperty('billing_amount');
    expect(body.pending[0]).not.toHaveProperty('assignee_id');
    expect(body.pending[0]).not.toHaveProperty('needs_review');

    expect(body.recently_approved).toHaveLength(1);
    expect(body.recently_approved[0]).toMatchObject({ id: 'task-2', title: 'Fix broken link' });
    expect(body.recently_approved[0].client_approved_at).toBeTruthy();
  });

  it('returns empty lists when the client has nothing pending or approved', async () => {
    mockRequireClientAuth.mockResolvedValue({ clientId: 'client-acme', contactId: 'contact-1' });
    mockTaskFindMany.mockResolvedValue([]);

    const res = await GET(makeRequest());
    const body = await res.json();

    expect(body).toEqual({ pending: [], recently_approved: [] });
  });
});

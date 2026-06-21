import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { AuthError } from '@/lib/api/errors';

// Use the REAL client-auth module so assertClientScope's 403 logic is exercised end-to-end;
// only requireClientAuth (which reads cookies/DB) is stubbed per-test to set the session scope.
vi.mock('@/lib/services/client-auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/services/client-auth')>();
  return { ...actual, requireClientAuth: vi.fn() };
});

vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    client: { findFirst: vi.fn() },
  },
}));

import { GET } from '../[clientId]/route';
import { requireClientAuth } from '@/lib/services/client-auth';
import { prisma } from '@/lib/db/prisma';
import type { Mock } from 'vitest';

const mockRequireClientAuth = requireClientAuth as Mock;
const mockClientFindFirst = prisma.client.findFirst as Mock;

function makeRequest(): NextRequest {
  return new NextRequest(new URL('http://localhost/api/portal/clients/client-acme'));
}
function makeParams(clientId: string) {
  return { params: Promise.resolve({ clientId }) };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('GET /api/portal/clients/:clientId', () => {
  it('returns 200 with the client when the session owns that client', async () => {
    mockRequireClientAuth.mockResolvedValue({ clientId: 'client-acme', contactId: 'contact-1' });
    mockClientFindFirst.mockResolvedValue({ id: 'client-acme', name: 'Acme' });

    const res = await GET(makeRequest(), makeParams('client-acme'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.client).toEqual({ id: 'client-acme', name: 'Acme' });
  });

  it('returns 403 when the session belongs to a different client (cross-client block)', async () => {
    mockRequireClientAuth.mockResolvedValue({ clientId: 'client-acme', contactId: 'contact-1' });

    const res = await GET(makeRequest(), makeParams('client-other'));
    expect(res.status).toBe(403);
    // Never leaked another client's data.
    expect(mockClientFindFirst).not.toHaveBeenCalled();
  });

  it('returns 401 when there is no client session', async () => {
    mockRequireClientAuth.mockRejectedValue(new AuthError('Client authentication required', 401));

    const res = await GET(makeRequest(), makeParams('client-acme'));
    expect(res.status).toBe(401);
    expect(mockClientFindFirst).not.toHaveBeenCalled();
  });

  it('returns 404 when the owned client does not exist', async () => {
    mockRequireClientAuth.mockResolvedValue({ clientId: 'client-acme', contactId: 'contact-1' });
    mockClientFindFirst.mockResolvedValue(null);

    const res = await GET(makeRequest(), makeParams('client-acme'));
    expect(res.status).toBe(404);
  });
});

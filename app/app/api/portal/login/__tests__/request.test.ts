import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/api/rate-limit', () => ({
  authRateLimit: vi.fn(() => null),
}));

vi.mock('@/lib/services/client-auth', () => ({
  requestClientMagicLink: vi.fn(),
}));

import { POST } from '../request/route';
import { authRateLimit } from '@/lib/api/rate-limit';
import { requestClientMagicLink } from '@/lib/services/client-auth';
import type { Mock } from 'vitest';

const mockRateLimit = authRateLimit as Mock;
const mockRequest = requestClientMagicLink as Mock;

function makeRequest(body: unknown): NextRequest {
  return new NextRequest(new URL('http://localhost/api/portal/login/request'), {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockRateLimit.mockReturnValue(null);
});

describe('POST /api/portal/login/request', () => {
  it('returns { requested: true } for a known email and triggers the link', async () => {
    mockRequest.mockResolvedValue(1);
    const res = await POST(makeRequest({ email: 'ann@acme.com' }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ requested: true });
    expect(mockRequest).toHaveBeenCalledWith(expect.objectContaining({ email: 'ann@acme.com' }));
  });

  it('returns the same { requested: true } for an unknown email (no enumeration)', async () => {
    mockRequest.mockResolvedValue(0);
    const res = await POST(makeRequest({ email: 'nobody@nowhere.com' }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ requested: true });
  });

  it('rejects an invalid email with 400', async () => {
    const res = await POST(makeRequest({ email: 'not-an-email' }));
    expect(res.status).toBe(400);
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it('honors the rate limiter', async () => {
    const limited = new Response(null, { status: 429 });
    mockRateLimit.mockReturnValue(limited);
    const res = await POST(makeRequest({ email: 'ann@acme.com' }));
    expect(res.status).toBe(429);
    expect(mockRequest).not.toHaveBeenCalled();
  });
});

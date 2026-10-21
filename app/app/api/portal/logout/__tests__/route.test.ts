import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/services/client-auth', () => ({
  revokeClientSession: vi.fn(),
  CLIENT_SESSION_COOKIE: 'client_session',
}));

import { POST } from '../route';
import { revokeClientSession } from '@/lib/services/client-auth';
import type { Mock } from 'vitest';

const mockRevoke = revokeClientSession as Mock;

function req(cookie?: string): NextRequest {
  return new NextRequest(new URL('http://localhost/api/portal/logout'), {
    method: 'POST',
    headers: cookie ? { cookie: `client_session=${cookie}` } : {},
  });
}

beforeEach(() => vi.clearAllMocks());

describe('POST /api/portal/logout', () => {
  it('revokes the session server-side and clears the cookie', async () => {
    const res = await POST(req('sess-1'));
    expect(res.status).toBe(200);
    expect(mockRevoke).toHaveBeenCalledWith('sess-1');
    const cookie = res.cookies.get('client_session');
    expect(cookie?.value).toBe('');
    expect(cookie?.maxAge).toBe(0);
  });

  it('is 200 and clears the cookie even when nobody is logged in', async () => {
    const res = await POST(req());
    expect(res.status).toBe(200);
    expect(mockRevoke).not.toHaveBeenCalled();
    expect(res.cookies.get('client_session')?.maxAge).toBe(0);
  });

  it('still clears the cookie if revocation throws', async () => {
    mockRevoke.mockRejectedValue(new Error('db down'));
    const res = await POST(req('sess-1'));
    expect(res.status).toBe(200);
    expect(res.cookies.get('client_session')?.maxAge).toBe(0);
  });
});

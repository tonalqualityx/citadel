import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/api/rate-limit', () => ({
  authRateLimit: vi.fn(() => null),
}));

vi.mock('@/lib/services/client-auth', () => ({
  consumeClientMagicLink: vi.fn(),
  CLIENT_SESSION_COOKIE: 'client_session',
  SESSION_TTL_DAYS: 30,
}));

import { POST as consumePOST } from '../consume/route';
import { GET as legacyGET } from '../[token]/route';
import { consumeClientMagicLink } from '@/lib/services/client-auth';
import type { Mock } from 'vitest';

const mockConsume = consumeClientMagicLink as Mock;

function post(body: unknown, headers: Record<string, string> = {}): NextRequest {
  return new NextRequest(new URL('http://localhost/api/portal/login/consume'), {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json', ...headers },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('POST /api/portal/login/consume', () => {
  it('valid token sets the httpOnly cookie and returns the redirect', async () => {
    mockConsume.mockResolvedValue({
      sessionToken: 'sess-xyz',
      clientId: 'c1',
      contactId: 'k1',
      expiresAt: new Date(),
    });
    const res = await consumePOST(post({ token: 'tok' }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ redirect: '/portal/home' });
    const cookie = res.cookies.get('client_session');
    expect(cookie?.value).toBe('sess-xyz');
    expect(res.headers.get('set-cookie')).toMatch(/HttpOnly/i);
    expect(cookie?.maxAge).toBe(30 * 24 * 60 * 60);
    expect(mockConsume).toHaveBeenCalledWith(expect.objectContaining({ magicToken: 'tok' }));
  });

  it('used, expired or unknown token returns 401 and sets no cookie', async () => {
    mockConsume.mockResolvedValue(null);
    const res = await consumePOST(post({ token: 'dead' }));
    expect(res.status).toBe(401);
    expect(res.cookies.get('client_session')).toBeUndefined();
  });

  it('missing token is a 400 and never reaches the service', async () => {
    const res = await consumePOST(post({}));
    expect(res.status).toBe(400);
    expect(mockConsume).not.toHaveBeenCalled();
  });
});

describe('POST /api/portal/login/consume login-CSRF guard', () => {
  it('rejects a non-JSON content type (cross-site form post) without consuming', async () => {
    const res = await consumePOST(post({ token: 'tok' }, { 'content-type': 'application/x-www-form-urlencoded' }));
    expect(res.status).toBe(415);
    expect(mockConsume).not.toHaveBeenCalled();
  });

  it('rejects Sec-Fetch-Site cross-site and same-site', async () => {
    for (const site of ['cross-site', 'same-site']) {
      const res = await consumePOST(post({ token: 'tok' }, { 'sec-fetch-site': site }));
      expect(res.status).toBe(403);
    }
    expect(mockConsume).not.toHaveBeenCalled();
  });

  it('rejects a foreign Origin', async () => {
    const res = await consumePOST(post({ token: 'tok' }, { origin: 'https://evil.example' }));
    expect(res.status).toBe(403);
    expect(mockConsume).not.toHaveBeenCalled();
  });

  it('accepts same-origin and none (direct navigation tools)', async () => {
    mockConsume.mockResolvedValue({ sessionToken: 's', clientId: 'c', contactId: 'k', expiresAt: new Date() });
    for (const h of [{ 'sec-fetch-site': 'same-origin', origin: 'http://localhost' }, { 'sec-fetch-site': 'none' }] as Record<string, string>[]) {
      const res = await consumePOST(post({ token: 'tok' }, h));
      expect(res.status).toBe(200);
    }
  });
});

describe('GET /api/portal/login/[token] (legacy link)', () => {
  it('redirects to the interstitial and NEVER consumes', async () => {
    const res = await legacyGET(
      new NextRequest(new URL('http://localhost/api/portal/login/abc123')),
      { params: Promise.resolve({ token: 'abc123' }) }
    );
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toContain('/portal/login/verify#token=abc123');
    expect(mockConsume).not.toHaveBeenCalled();
    expect(res.cookies.get('client_session')).toBeUndefined();
  });
});

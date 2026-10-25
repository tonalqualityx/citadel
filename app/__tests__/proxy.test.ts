import { describe, it, expect } from 'vitest';
import { NextRequest } from 'next/server';
import { proxy, config } from '../proxy';

// Fleet item 6: the proxy stamps x-citadel-route and changes nothing else.
const OVERRIDE = 'x-middleware-override-headers';
const fwd = (res: Response, name: string) => res.headers.get(`x-middleware-request-${name}`);

describe('proxy (x-citadel-route)', () => {
  it('only runs on /api', () => {
    expect(config.matcher).toEqual(['/api/:path*']);
  });

  it('sets the route header from the real method and pathname', () => {
    const res = proxy(new NextRequest('http://localhost:3000/api/tasks/abc?limit=5', { method: 'PATCH' }));
    expect(fwd(res, 'x-citadel-route')).toBe('PATCH /api/tasks/abc');
  });

  it('overwrites a spoofed incoming x-citadel-route', () => {
    const req = new NextRequest('http://localhost:3000/api/sites', {
      method: 'DELETE',
      headers: { 'x-citadel-route': 'GET /api/email-outbox', authorization: 'Bearer citadel_test' },
    });
    const res = proxy(req);
    expect(fwd(res, 'x-citadel-route')).toBe('DELETE /api/sites');
  });

  it('overwrites a spoofed header in any letter case', () => {
    const req = new NextRequest('http://localhost:3000/api/sites', {
      method: 'GET',
      headers: { 'X-Citadel-Route': 'PUT /api/waits/sweep' },
    });
    expect(fwd(proxy(req), 'x-citadel-route')).toBe('GET /api/sites');
  });

  it('passes every other request header through unchanged', () => {
    const req = new NextRequest('http://localhost:3000/api/clients', {
      method: 'PATCH',
      headers: { authorization: 'Bearer citadel_test', 'content-type': 'application/json', 'x-other': 'keep' },
    });
    const res = proxy(req);
    expect(fwd(res, 'authorization')).toBe('Bearer citadel_test');
    expect(fwd(res, 'content-type')).toBe('application/json');
    expect(fwd(res, 'x-other')).toBe('keep');
    const overridden = (res.headers.get(OVERRIDE) ?? '').split(',').map((s) => s.trim()).sort();
    expect(overridden).toEqual(['authorization', 'content-type', 'x-citadel-route', 'x-other']);
  });

  it('is a plain pass-through: status 200, no body, no redirect or rewrite, no other response headers', async () => {
    const res = proxy(new NextRequest('http://localhost:3000/api/auth/me', { method: 'GET' }));
    expect(res.status).toBe(200);
    expect(res.headers.get('x-middleware-next')).toBe('1');
    expect(res.headers.get('location')).toBeNull();
    expect(res.headers.get('x-middleware-rewrite')).toBeNull();
    const names = [...res.headers.keys()].filter((n) => !n.startsWith('x-middleware-'));
    expect(names).toEqual([]);
    expect(await res.text()).toBe('');
  });
});

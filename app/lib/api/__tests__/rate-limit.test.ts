import { describe, it, expect } from 'vitest';
import { NextRequest } from 'next/server';
import { rateLimit, portalReadRateLimit, PORTAL_READ_LIMIT_PER_MINUTE } from '../rate-limit';

const req = (ip: string) => new NextRequest('http://localhost/x', { headers: { 'x-forwarded-for': ip } });

describe('rateLimit buckets', () => {
  it('names the limiter in the 429 body', async () => {
    const ip = '10.0.0.1';
    for (let i = 0; i < 3; i++) expect(rateLimit(req(ip), 3)).toBeNull();
    const res = rateLimit(req(ip), 3)!;
    expect(res.status).toBe(429);
    expect(await res.json()).toMatchObject({ limit: 'ip:default' });
  });

  it('keeps polling reads in their own counter so they never starve the writes', async () => {
    const ip = '10.0.0.2';
    expect(PORTAL_READ_LIMIT_PER_MINUTE).toBe(600);
    // 500 polling GETs in a minute: allowed, and the write budget is untouched.
    for (let i = 0; i < 500; i++) expect(portalReadRateLimit(req(ip))).toBeNull();
    for (let i = 0; i < 120; i++) expect(rateLimit(req(ip), 120)).toBeNull();
    const writes = rateLimit(req(ip), 120)!;
    expect(writes.status).toBe(429);
    expect((await writes.json()).limit).toBe('ip:default');
    // And the reads stop at 600 with their own name.
    for (let i = 0; i < 100; i++) expect(portalReadRateLimit(req(ip))).toBeNull();
    const reads = portalReadRateLimit(req(ip))!;
    expect(reads.status).toBe(429);
    expect((await reads.json()).limit).toBe('ip:portal-read');
  });
});

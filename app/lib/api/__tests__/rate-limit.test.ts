import { describe, it, expect } from 'vitest';
import { NextRequest } from 'next/server';
import { rateLimit, sweepRateLimits, portalReadRateLimit, PORTAL_READ_LIMIT_PER_MINUTE } from '../rate-limit';

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

describe('rateLimit windows longer than a minute', () => {
  it('an hourly limit survives the periodic sweep and ends with its own window', async () => {
    const ip = '10.0.0.3';
    const hour = 60 * 60 * 1000;
    const t0 = Date.now();
    for (let i = 0; i < 2; i++) expect(rateLimit(req(ip), 2, hour, 'hourly')).toBeNull();
    // the sweep that runs every minute: five minutes on, the hourly entry must still be there
    sweepRateLimits(t0 + 5 * 60 * 1000);
    expect(rateLimit(req(ip), 2, hour, 'hourly')!.status).toBe(429);
    // a one-minute entry of the same caller is swept after its minute
    expect(rateLimit(req(ip), 1, 60000, 'minute')).toBeNull();
    sweepRateLimits(t0 + 2 * 60 * 1000);
    expect(rateLimit(req(ip), 1, 60000, 'minute')).toBeNull();
    // past the hour the hourly entry goes
    sweepRateLimits(t0 + hour + 1000);
    expect(rateLimit(req(ip), 2, hour, 'hourly')).toBeNull();
  });
});

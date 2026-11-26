import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';

const run = vi.hoisted(() => vi.fn());
vi.mock('@/lib/initiatives/citadel-numbers', () => ({ runCitadelNumbers: run }));

import { POST } from '../route';

const req = (headers: Record<string, string> = {}) =>
  new NextRequest('http://localhost/api/cron/initiative-numbers', { method: 'POST', headers });

beforeEach(() => {
  vi.clearAllMocks();
  process.env.CRON_SECRET = 'test-secret';
});
afterEach(() => {
  delete process.env.CRON_SECRET;
});

describe('POST /api/cron/initiative-numbers', () => {
  it('401s without the secret header', async () => {
    const res = await POST(req());
    expect(res.status).toBe(401);
    expect(run).not.toHaveBeenCalled();
  });

  it('401s with a wrong secret', async () => {
    const res = await POST(req({ 'x-cron-secret': 'nope' }));
    expect(res.status).toBe(401);
    expect(run).not.toHaveBeenCalled();
  });

  it('401s when CRON_SECRET is not configured', async () => {
    delete process.env.CRON_SECRET;
    const res = await POST(req({ 'x-cron-secret': 'test-secret' }));
    expect(res.status).toBe(401);
  });

  it('runs and returns the summary with the right secret', async () => {
    run.mockResolvedValue({ read: 2, skipped: [{ number_id: 'n', source: 'citadel:x', reason: 'unknown key "x"' }], refreshed: 3 });
    const res = await POST(req({ 'x-cron-secret': 'test-secret' }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, read: 2, skipped: [{ number_id: 'n', source: 'citadel:x', reason: 'unknown key "x"' }], refreshed: 3 });
  });

  it('500s when the run throws', async () => {
    run.mockRejectedValue(new Error('boom'));
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await POST(req({ 'x-cron-secret': 'test-secret' }));
    expect(res.status).toBe(500);
    spy.mockRestore();
  });
});

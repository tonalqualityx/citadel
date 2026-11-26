import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';

const run = vi.hoisted(() => vi.fn());
vi.mock('@/lib/retainer-months/service', () => ({ runRetainerMonthCycle: run }));

import { POST } from '../route';

const req = (headers: Record<string, string> = {}) =>
  new NextRequest('http://localhost/api/cron/retainer-months', { method: 'POST', headers });

beforeEach(() => {
  vi.clearAllMocks();
  process.env.CRON_SECRET = 'test-secret';
});
afterEach(() => {
  delete process.env.CRON_SECRET;
});

describe('POST /api/cron/retainer-months', () => {
  it('401s without the secret header or with a wrong one', async () => {
    expect((await POST(req())).status).toBe(401);
    expect((await POST(req({ 'x-cron-secret': 'nope' }))).status).toBe(401);
    expect(run).not.toHaveBeenCalled();
  });

  it('401s when CRON_SECRET is not configured', async () => {
    delete process.env.CRON_SECRET;
    expect((await POST(req({ 'x-cron-secret': 'test-secret' }))).status).toBe(401);
  });

  it('runs the cycle and returns its summary', async () => {
    run.mockResolvedValue({ drafted: 2, planningTasks: 2, autoPlanned: 1, closed: 3, errors: [] });
    const res = await POST(req({ 'x-cron-secret': 'test-secret' }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, drafted: 2, planningTasks: 2, autoPlanned: 1, closed: 3, errors: [] });
  });

  it('500s when the cycle throws', async () => {
    run.mockRejectedValue(new Error('boom'));
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect((await POST(req({ 'x-cron-secret': 'test-secret' }))).status).toBe(500);
    spy.mockRestore();
  });
});

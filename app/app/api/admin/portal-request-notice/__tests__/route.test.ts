import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Mock } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/auth/middleware', () => ({
  requireAuth: vi.fn(async () => ({ userId: 'u', role: 'admin' })),
  requireRole: vi.fn(),
}));
vi.mock('@/lib/portal/staff-notify', () => ({ notifyNewPortalRequest: vi.fn(async () => ({ notified: true, emailed: true })) }));

import { requireRole } from '@/lib/auth/middleware';
import { notifyNewPortalRequest } from '@/lib/portal/staff-notify';
import { POST } from '../route';

const TASK = '3ecfb7be-20bb-43cb-9b4d-31c44337dc81';
const req = (body: unknown) => new NextRequest('http://x/api/admin/portal-request-notice', { method: 'POST', body: JSON.stringify(body) });

beforeEach(() => vi.clearAllMocks());

describe('POST /api/admin/portal-request-notice', () => {
  it('runs the notice for the task and reports what it did', async () => {
    const res = await POST(req({ task_id: TASK }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, notified: true, emailed: true });
    expect(requireRole).toHaveBeenCalledWith(expect.anything(), ['admin']);
    expect(notifyNewPortalRequest).toHaveBeenCalledWith(TASK);
  });
  it('rejects a body without a uuid', async () => {
    const res = await POST(req({ task_id: 'nope' }));
    expect(res.status).toBe(400);
    expect(notifyNewPortalRequest).not.toHaveBeenCalled();
  });
  it('refuses a non-admin', async () => {
    (requireRole as Mock).mockImplementationOnce(() => { throw Object.assign(new Error('Forbidden'), { statusCode: 403 }); });
    const res = await POST(req({ task_id: TASK }));
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(notifyNewPortalRequest).not.toHaveBeenCalled();
  });
});

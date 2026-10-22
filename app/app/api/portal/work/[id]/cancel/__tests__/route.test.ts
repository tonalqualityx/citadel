import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import type { Mock } from 'vitest';
import { ApiError, AuthError } from '@/lib/api/errors';
import { VIEW_AS_READ_ONLY_LINE } from '@/lib/portal/view-as-copy';

vi.mock('@/lib/services/client-auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/services/client-auth')>();
  return { ...actual, requireClientAuth: vi.fn() };
});
vi.mock('@/lib/portal/access', () => ({ loadPortalAccess: vi.fn() }));
vi.mock('@/lib/portal/cancel', () => ({ cancelRequest: vi.fn() }));
vi.mock('@/lib/portal/view-as-guard', () => ({ refuseIfViewAs: vi.fn() }));

import { POST } from '../route';
import { requireClientAuth } from '@/lib/services/client-auth';
import { loadPortalAccess } from '@/lib/portal/access';
import { cancelRequest } from '@/lib/portal/cancel';
import { refuseIfViewAs } from '@/lib/portal/view-as-guard';
import { NextResponse } from 'next/server';

const ID = '33333333-3333-4333-8333-333333333333';
const call = (id = ID) => POST(new NextRequest(new URL(`http://localhost/api/portal/work/${id}/cancel`), { method: 'POST' }), { params: Promise.resolve({ id }) });

beforeEach(() => {
  vi.clearAllMocks();
  (refuseIfViewAs as Mock).mockResolvedValue(null);
  (requireClientAuth as Mock).mockResolvedValue({ clientId: 'cl1', contactId: 'c1', role: 'viewer' });
  (loadPortalAccess as Mock).mockResolvedValue({ clientId: 'cl1', contactId: 'c1', role: 'viewer' });
});

describe('POST /api/portal/work/:id/cancel', () => {
  it('refuses a view-as session first, before auth, access or any work', async () => {
    (refuseIfViewAs as Mock).mockResolvedValue(NextResponse.json({ error: VIEW_AS_READ_ONLY_LINE, code: 'view_as_read_only' }, { status: 403 }));
    const res = await call();
    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe('view_as_read_only');
    expect(requireClientAuth).not.toHaveBeenCalled();
    expect(cancelRequest).not.toHaveBeenCalled();
  });

  it('401s without a session', async () => {
    (requireClientAuth as Mock).mockRejectedValue(new AuthError('Client authentication required', 401));
    expect((await call()).status).toBe(401);
    expect(cancelRequest).not.toHaveBeenCalled();
  });

  it('404s a malformed id without touching the database', async () => {
    expect((await call('not-a-uuid')).status).toBe(404);
    expect(cancelRequest).not.toHaveBeenCalled();
  });

  it('any role may cancel: a viewer reaches the service with their own access', async () => {
    (cancelRequest as Mock).mockResolvedValue({ cancelled: true, already_cancelled: false, staff_notified: false });
    const res = await call();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ cancelled: true, already_cancelled: false, staff_notified: false });
    expect((cancelRequest as Mock).mock.calls[0]).toEqual([{ clientId: 'cl1', contactId: 'c1', role: 'viewer' }, ID]);
  });

  it('a repeat is a 200 no-op', async () => {
    (cancelRequest as Mock).mockResolvedValue({ cancelled: false, already_cancelled: true, staff_notified: false });
    const res = await call();
    expect(res.status).toBe(200);
    expect((await res.json()).already_cancelled).toBe(true);
  });

  it('409s live work with the code the page keys on', async () => {
    (cancelRequest as Mock).mockRejectedValue(new ApiError('This change is already live.', 409, 'live'));
    const res = await call();
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe('live');
  });

  it('404s work the contact may not see', async () => {
    (cancelRequest as Mock).mockRejectedValue(new ApiError('Not found', 404));
    expect((await call()).status).toBe(404);
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import type { Mock } from 'vitest';
import { AuthError } from '@/lib/api/errors';

vi.mock('@/lib/services/client-auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/services/client-auth')>();
  return { ...actual, requireClientAuth: vi.fn() };
});
vi.mock('@/lib/portal/requests', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/portal/requests')>();
  return { ...actual, loadWorkItem: vi.fn() };
});

import { GET } from '../route';
import { requireClientAuth } from '@/lib/services/client-auth';
import { loadWorkItem } from '@/lib/portal/requests';

const ID = '33333333-3333-4333-8333-333333333333';
const call = (id = ID) => GET(new NextRequest(new URL(`http://localhost/api/portal/work/${id}`)), { params: Promise.resolve({ id }) });

beforeEach(() => {
  vi.clearAllMocks();
  (requireClientAuth as Mock).mockResolvedValue({ clientId: 'cl1', contactId: 'c1', role: 'viewer' });
});

describe('GET /api/portal/work/:id', () => {
  it('401s without a session', async () => {
    (requireClientAuth as Mock).mockRejectedValue(new AuthError('Client authentication required', 401));
    expect((await call()).status).toBe(401);
  });

  it('404s anything the contact may not see, the same as a missing task', async () => {
    (loadWorkItem as Mock).mockResolvedValue(null);
    const res = await call();
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe('Not found');
  });

  it('404s a malformed id without touching the database', async () => {
    expect((await call('not-a-uuid')).status).toBe(404);
    expect(loadWorkItem).not.toHaveBeenCalled();
  });

  it('returns the client-safe work for the signed-in access', async () => {
    (loadWorkItem as Mock).mockResolvedValue({ id: ID, title: 'Site change: hours', answers: [] });
    const res = await call();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ work: { id: ID, title: 'Site change: hours', answers: [] } });
    const [access, id] = (loadWorkItem as Mock).mock.calls[0];
    expect(access).toMatchObject({ clientId: 'cl1', contactId: 'c1', role: 'viewer' });
    expect(id).toBe(ID);
  });
});

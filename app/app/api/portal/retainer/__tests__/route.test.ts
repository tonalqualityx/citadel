import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import type { Mock } from 'vitest';
import { AuthError } from '@/lib/api/errors';

vi.mock('@/lib/services/client-auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/services/client-auth')>();
  return { ...actual, requireClientAuth: vi.fn() };
});
vi.mock('@/lib/portal/retainer', () => ({ loadRetainers: vi.fn() }));

import { GET } from '../route';
import { requireClientAuth } from '@/lib/services/client-auth';
import { loadRetainers } from '@/lib/portal/retainer';

const call = () => GET(new NextRequest(new URL('http://localhost/api/portal/retainer')));

beforeEach(() => {
  vi.clearAllMocks();
  (requireClientAuth as Mock).mockResolvedValue({ clientId: 'cl1', contactId: 'c1', role: 'member' });
});

describe('GET /api/portal/retainer', () => {
  it('401s without a session', async () => {
    (requireClientAuth as Mock).mockRejectedValue(new AuthError('Client authentication required', 401));
    expect((await call()).status).toBe(401);
    expect(loadRetainers).not.toHaveBeenCalled();
  });
  it('returns the cards for the signed-in access', async () => {
    (loadRetainers as Mock).mockResolvedValue([{ id: 'ch1', heading: 'SEO' }]);
    const res = await call();
    expect(await res.json()).toEqual({ retainers: [{ id: 'ch1', heading: 'SEO' }] });
    expect((loadRetainers as Mock).mock.calls[0][0]).toMatchObject({ clientId: 'cl1', contactId: 'c1', role: 'member' });
  });
  it('an empty account is an empty list', async () => {
    (loadRetainers as Mock).mockResolvedValue([]);
    expect(await (await call()).json()).toEqual({ retainers: [] });
  });
});

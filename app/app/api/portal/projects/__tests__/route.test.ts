import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import type { Mock } from 'vitest';
import { AuthError } from '@/lib/api/errors';

vi.mock('@/lib/services/client-auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/services/client-auth')>();
  return { ...actual, requireClientAuth: vi.fn() };
});
vi.mock('@/lib/portal/projects-list', () => ({ loadProjectList: vi.fn() }));

import { GET } from '../route';
import { requireClientAuth } from '@/lib/services/client-auth';
import { loadProjectList } from '@/lib/portal/projects-list';

const call = () => GET(new NextRequest(new URL('http://localhost/api/portal/projects')));

beforeEach(() => {
  vi.clearAllMocks();
  (requireClientAuth as Mock).mockResolvedValue({ clientId: 'cl1', contactId: 'c1', role: 'viewer' });
});

describe('GET /api/portal/projects', () => {
  it('401s without a session', async () => {
    (requireClientAuth as Mock).mockRejectedValue(new AuthError('Client authentication required', 401));
    expect((await call()).status).toBe(401);
  });
  it('returns active and complete for the signed-in access', async () => {
    (loadProjectList as Mock).mockResolvedValue({ active: [{ id: 'p1' }], complete: [] });
    const res = await call();
    expect(await res.json()).toEqual({ active: [{ id: 'p1' }], complete: [] });
    expect((loadProjectList as Mock).mock.calls[0][0]).toMatchObject({ clientId: 'cl1', role: 'viewer' });
  });
});

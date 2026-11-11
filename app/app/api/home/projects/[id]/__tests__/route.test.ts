import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Mock } from 'vitest';
import { GET } from '../route';
import { AuthError } from '@/lib/api/errors';
import { IDS, tonight } from '@/lib/home/__tests__/fixtures/tonight';

vi.mock('@/lib/auth/middleware', () => ({ requireAuth: vi.fn() }));
vi.mock('@/lib/db/prisma', () => ({
  prisma: { userPreference: { findUnique: vi.fn() }, project: { findFirst: vi.fn() } },
}));
vi.mock('@/lib/home/load', () => ({ loadHomeInputs: vi.fn() }));
vi.mock('@/lib/home/state', () => ({ loadItemStates: vi.fn(async () => []) }));
vi.mock('@/lib/home/projects/load', () => ({ loadProjectWaits: vi.fn(async () => [{ who: 'Andy (client)', since: '2026-11-03T14:00:00.000Z', title: 'Logo files' }]) }));
vi.mock('@/lib/services/user-timezone', () => ({ resolveUserTimezone: vi.fn(async () => 'America/New_York') }));

import { requireAuth } from '@/lib/auth/middleware';
import { prisma } from '@/lib/db/prisma';
import { loadHomeInputs } from '@/lib/home/load';
import { loadProjectWaits } from '@/lib/home/projects/load';

const mockAuth = vi.mocked(requireAuth);
const mockPref = prisma.userPreference.findUnique as Mock;
const mockProject = prisma.project.findFirst as Mock;
const mockLoad = loadHomeInputs as Mock;

const call = (id: string) => GET(new Request('http://localhost/api/home/projects/' + id), { params: Promise.resolve({ id }) });

beforeEach(() => {
  vi.clearAllMocks();
  mockAuth.mockResolvedValue({ userId: 'user-1', role: 'admin', email: 'm@example.com', via: 'session' });
  mockPref.mockResolvedValue({ home_view: 'home' });
  mockProject.mockResolvedValue({ id: IDS.grokProject, name: 'Grok of the Rock', client: { id: IDS.grokClient, name: 'Grok of the Rock' } });
  mockLoad.mockResolvedValue(tonight().raw);
});

describe('GET /api/home/projects/[id]', () => {
  it('403 for an API key, and nothing is read', async () => {
    mockAuth.mockResolvedValue({ userId: 'user-1', role: 'admin', email: 'm@example.com', via: 'api_key' });
    const res = await call(IDS.grokProject);
    expect(res.status).toBe(403);
    expect(mockLoad).not.toHaveBeenCalled();
    expect(mockProject).not.toHaveBeenCalled();
  });
  it('403 for a non-admin and for a home view that is off', async () => {
    mockAuth.mockResolvedValue({ userId: 'user-2', role: 'tech', email: 't@example.com', via: 'session' });
    expect((await call(IDS.grokProject)).status).toBe(403);
    mockAuth.mockResolvedValue({ userId: 'user-1', role: 'admin', email: 'm@example.com', via: 'session' });
    mockPref.mockResolvedValue({ home_view: 'overlook' });
    expect((await call(IDS.grokProject)).status).toBe(403);
    expect(mockLoad).not.toHaveBeenCalled();
  });
  it('401 without a login', async () => {
    mockAuth.mockRejectedValue(new AuthError('Unauthorized', 401));
    expect((await call(IDS.grokProject)).status).toBe(401);
  });
  it('404 for a bad id and for an unknown project', async () => {
    expect((await call('not-a-uuid')).status).toBe(404);
    mockProject.mockResolvedValue(null);
    expect((await call(IDS.grokProject)).status).toBe(404);
    expect(mockLoad).not.toHaveBeenCalled();
  });
  it('200: his items of that project only, the waits, no-store, loaded for the caller alone', async () => {
    const res = await call(IDS.grokProject);
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    const body = await res.json();
    expect(body.project).toEqual({ id: IDS.grokProject, name: 'Grok of the Rock', client: { id: IDS.grokClient, name: 'Grok of the Rock' } });
    expect(body.items.length).toBeGreaterThan(0);
    for (const x of body.items) {
      expect(x.item.project.id).toBe(IDS.grokProject);
      expect(typeof x.where).toBe('string');
    }
    expect(body.waits).toEqual([{ who: 'Andy (client)', since: '2026-11-03T14:00:00.000Z', title: 'Logo files' }]);
    expect(mockLoad.mock.calls[0][1]).toBe('user-1');
    expect((loadProjectWaits as Mock).mock.calls[0].slice(1)).toEqual([IDS.grokProject, 'user-1']);
    expect(JSON.stringify(body)).not.toMatch(/"(score|class|klass|urgency|candidates)"/);
  });
});

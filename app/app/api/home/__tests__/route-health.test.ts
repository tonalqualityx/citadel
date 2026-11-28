import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Mock } from 'vitest';
import { NOW, tonight } from '@/lib/home/__tests__/fixtures/tonight';

const MIKE = '3ecfb7be-20bb-43cb-9b4d-31c44337dc81';

vi.mock('@/lib/auth/middleware', () => ({ requireAuth: vi.fn() }));
vi.mock('@/lib/db/prisma', () => ({ prisma: { userPreference: { findUnique: vi.fn() } } }));
vi.mock('@/lib/home/load', () => ({ loadHomeInputs: vi.fn() }));
vi.mock('@/lib/home/state', () => ({
  loadItemStates: vi.fn(async () => []),
  getHomeDay: vi.fn(async () => null),
  getOrCreateHomeDay: vi.fn(async (_db: unknown, _u: string, date: string, build: () => Record<string, unknown>) => ({ day: { id: 'd', date, ...build() }, created: true })),
  updateHomeDay: vi.fn(async () => 1),
}));
vi.mock('@/lib/tasks/triage', () => ({ loadTriage: vi.fn(async () => null), isTriageOwner: (id: string) => id === MIKE }));
vi.mock('@/lib/home/overdue-others', () => ({ loadOverdueByOthers: vi.fn(async () => null) }));
vi.mock('@/lib/home/first-list-money', () => ({ loadMoneyToCollect: vi.fn(async () => []) }));
vi.mock('@/app/api/oracle/projects/route', () => ({
  GET: vi.fn(async () => new Response(JSON.stringify({ projects: [{ name: 'P', stale: true, days_quiet: 9 }] }), { status: 200 })),
}));
vi.mock('@/lib/home/health/load', async (orig) => {
  const real = await orig<typeof import('@/lib/home/health/load')>();
  return { ...real, loadHomeHealth: vi.fn() };
});

import { GET } from '../route';
import { requireAuth } from '@/lib/auth/middleware';
import { prisma } from '@/lib/db/prisma';
import { loadHomeInputs } from '@/lib/home/load';
import { loadHomeHealth } from '@/lib/home/health/load';

const mockAuth = vi.mocked(requireAuth);
const mockHealth = loadHomeHealth as Mock;
const HEALTH = { summary: 'All six are normal.', tiles: [], generated_at: NOW.toISOString() };

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  (prisma.userPreference.findUnique as Mock).mockResolvedValue({ home_view: 'home', timezone: 'America/New_York' });
  (loadHomeInputs as Mock).mockResolvedValue(tonight().raw);
  mockHealth.mockResolvedValue(HEALTH);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('GET /api/home health tiles', () => {
  it('adds the health tiles for the owner, reading projects through the projects tab', async () => {
    mockAuth.mockResolvedValue({ userId: MIKE, role: 'admin', email: 'm@example.com', via: 'session' });
    const res = await GET();
    expect(res.status).toBe(200);
    expect((await res.json()).health).toEqual(HEALTH);
    expect(mockHealth).toHaveBeenCalledTimes(1);
    const input = mockHealth.mock.calls[0][1] as { clients: unknown; projects: () => Promise<unknown> };
    expect(input.clients).toEqual(expect.objectContaining({ sites_down: expect.any(Array), mail_waiting: expect.any(Array) }));
    await expect(input.projects()).resolves.toEqual([{ name: 'P', stale: true, days_quiet: 9 }]);
  });

  it('leaves health out for anyone else', async () => {
    mockAuth.mockResolvedValue({ userId: 'user-1', role: 'admin', email: 'x@example.com', via: 'session' });
    const body = await (await GET()).json();
    expect(body.health).toBeUndefined();
    expect(mockHealth).not.toHaveBeenCalled();
  });

  it('still opens the screen, without health, when the tiles fail', async () => {
    mockAuth.mockResolvedValue({ userId: MIKE, role: 'admin', email: 'm@example.com', via: 'session' });
    mockHealth.mockRejectedValue(new Error('boom'));
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.health).toBeUndefined();
    expect(body.first_list).toBeDefined();
  });
});

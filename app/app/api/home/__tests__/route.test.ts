import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Mock } from 'vitest';
import { GET } from '../route';
import { AuthError } from '@/lib/api/errors';
import { taskKey } from '@/lib/home/item-key';
import type { RawHomeDay } from '@/lib/home/types';
import { NOW, makeInputs, makeTask, tonight } from '@/lib/home/__tests__/fixtures/tonight';

vi.mock('@/lib/auth/middleware', () => ({
  requireAuth: vi.fn(),
}));

vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    userPreference: { findUnique: vi.fn() },
  },
}));

vi.mock('@/lib/home/load', () => ({
  loadHomeInputs: vi.fn(),
}));

// An in-memory home_day table keyed by date, with the same contract as state.ts.
const store = vi.hoisted(() => ({ days: new Map<string, unknown>(), creates: 0, updates: 0 }));
vi.mock('@/lib/home/state', () => ({
  loadItemStates: vi.fn(async () => []),
  getHomeDay: vi.fn(async (_db: unknown, _u: string, date: string) => store.days.get(date) ?? null),
  getOrCreateHomeDay: vi.fn(
    async (_db: unknown, _u: string, date: string, build: () => Record<string, unknown>) => {
      const existing = store.days.get(date);
      if (existing) return { day: existing, created: false };
      const row = { id: 'day-1', date, ...build() };
      store.days.set(date, row);
      store.creates += 1;
      return { day: row, created: true };
    },
  ),
  updateHomeDay: vi.fn(async (_db: unknown, _u: string, date: string, patch: Record<string, unknown>) => {
    store.days.set(date, { ...(store.days.get(date) as object), ...patch });
    store.updates += 1;
    return 1;
  }),
}));

import { requireAuth } from '@/lib/auth/middleware';
import { prisma } from '@/lib/db/prisma';
import { loadHomeInputs } from '@/lib/home/load';

const mockRequireAuth = vi.mocked(requireAuth);
const mockPref = prisma.userPreference.findUnique as Mock;
const mockLoad = loadHomeInputs as Mock;

function setPref(home_view: string) {
  mockPref.mockResolvedValue({ home_view, timezone: 'America/New_York' });
}

beforeEach(() => {
  vi.clearAllMocks();
  store.days.clear();
  store.creates = 0;
  store.updates = 0;
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  mockRequireAuth.mockResolvedValue({ userId: 'user-1', role: 'admin', email: 'mike@example.com', via: 'session' });
  setPref('home');
  mockLoad.mockResolvedValue(tonight().raw);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('GET /api/home', () => {
  it('401 without auth', async () => {
    mockRequireAuth.mockRejectedValue(new AuthError('Unauthorized', 401));
    const res = await GET();
    expect(res.status).toBe(401);
    expect(mockLoad).not.toHaveBeenCalled();
  });

  it('403 for an admin whose home_view is overlook', async () => {
    setPref('overlook');
    const res = await GET();
    expect(res.status).toBe(403);
    expect(mockLoad).not.toHaveBeenCalled();
    expect(store.creates).toBe(0);
  });

  it('403 for a non-admin even if a home row existed', async () => {
    mockRequireAuth.mockResolvedValue({ userId: 'user-2', role: 'pm', email: 'pm@example.com', via: 'session' });
    const res = await GET();
    expect(res.status).toBe(403);
    expect(mockLoad).not.toHaveBeenCalled();
  });

  it('200 with the screen shape, no-store, the caller as user_id, and no scoring data', async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    const body = await res.json();
    expect(body.user_id).toBe('user-1');
    expect(body.date).toBe('2026-11-09');
    expect(body.timezone).toBe('America/New_York');
    expect(body.today).not.toBeNull();
    expect(Array.isArray(body.today.steps)).toBe(true);
    expect(body.sections).toBeDefined();
    expect(body.everything_else).toBeDefined();
    expect(body.empty).toBeDefined();
    expect(body.candidates).toBeUndefined();
    const text = JSON.stringify(body);
    expect(text).not.toMatch(/"(score|class|klass|candidates|urgency)"/);
    expect(mockLoad.mock.calls[0][1]).toBe('user-1');
    expect(store.creates).toBe(1);
  });

  it('a second call the same day reuses the day row and creates none', async () => {
    const first = await (await GET()).json();
    expect(store.creates).toBe(1);
    const second = await (await GET()).json();
    expect(store.creates).toBe(1);
    expect(store.updates).toBe(0);
    expect(second.today.steps.map((s: { key: string }) => s.key)).toEqual(
      first.today.steps.map((s: { key: string }) => s.key),
    );
  });

  it('a new emergency on the second call lands at the top of Quick and the steps do not change', async () => {
    const base = tonight().raw;
    mockLoad.mockResolvedValue(base);
    const first = await (await GET()).json();
    const stepsBefore = (store.days.values().next().value as RawHomeDay).step_item_keys;

    const emergency = makeTask({ tags: ['lifeline'], estimated_minutes: 10, title: 'Lifeline is down' });
    mockLoad.mockResolvedValue(makeInputs({ ...base, tasks: [...base.tasks, emergency] }));
    const second = await (await GET()).json();

    const stored = store.days.values().next().value as RawHomeDay;
    expect(store.creates).toBe(1);
    expect(stored.quick_item_keys[0]).toBe(taskKey(emergency.id));
    expect(stored.step_item_keys).toEqual(stepsBefore);
    expect(second.today.quick[0].key).toBe(taskKey(emergency.id));
    expect(second.today.steps.map((s: { key: string }) => s.key)).toEqual(
      first.today.steps.map((s: { key: string }) => s.key),
    );
  });

  it('writes no day when nothing is in view', async () => {
    mockLoad.mockResolvedValue(makeInputs({ now: NOW }));
    const res = await GET();
    expect(res.status).toBe(200);
    expect((await res.json()).today).toBeNull();
    expect(store.creates).toBe(0);
  });
});

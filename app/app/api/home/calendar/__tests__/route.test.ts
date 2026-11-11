import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Mock } from 'vitest';
import { GET } from '../route';
import { ev, guest, me, at } from '@/lib/home/calendar/__tests__/helpers';

const h = vi.hoisted(() => ({ rows: {} as Record<string, unknown>, calls: [] as string[] }));
const WRITES = ['create', 'createMany', 'update', 'updateMany', 'upsert', 'delete', 'deleteMany'];

vi.mock('@/lib/auth/middleware', () => ({ requireAuth: vi.fn() }));
vi.mock('@/lib/services/user-timezone', () => ({ resolveUserTimezone: vi.fn(async () => 'America/New_York') }));
vi.mock('@/lib/home/load', async (orig) => ({ ...(await orig<typeof import('@/lib/home/load')>()), loadHomeInputs: vi.fn() }));
vi.mock('@/lib/db/prisma', () => {
  const model = (name: string) =>
    new Proxy({}, {
      get: (_t, op: string) =>
        vi.fn(async () => {
          h.calls.push(`${name}.${op}`);
          if (['create', 'createMany', 'update', 'updateMany', 'upsert', 'delete', 'deleteMany'].includes(op)) throw new Error(`write ${name}.${op}`);
          const r = h.rows[`${name}.${op}`];
          return r === undefined ? (op === 'findMany' ? [] : null) : r;
        }),
    });
  return { prisma: new Proxy({}, { get: (_t, name: string) => model(name) }) };
});

import { requireAuth } from '@/lib/auth/middleware';
import { loadHomeInputs } from '@/lib/home/load';

const mockAuth = requireAuth as Mock;
const mike = { userId: 'u1', email: 'mike@becomeindelible.com', role: 'admin', via: 'session' };

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(at('11:40'));
  h.calls = [];
  h.rows = { 'userPreference.findUnique': { home_view: 'home' } };
  mockAuth.mockResolvedValue(mike);
});
afterEach(() => vi.useRealTimers());

describe('GET /api/home/calendar', () => {
  it('403 for an API key, a tech user, an overlook admin and another admin, and nothing is read', async () => {
    for (const [auth, pref] of [
      [{ ...mike, via: 'api_key' }, 'home'],
      [{ ...mike, role: 'tech' }, 'home'],
      [mike, 'overlook'],
      [{ ...mike, email: 'sabeen@becomeindelible.com' }, 'home'],
    ] as const) {
      mockAuth.mockResolvedValue(auth);
      h.rows['userPreference.findUnique'] = { home_view: pref };
      h.calls = [];
      const r = await GET();
      expect(r.status).toBe(403);
      expect(h.calls.filter((c) => !c.startsWith('userPreference'))).toEqual([]);
    }
  });

  it('answers the strip with no-store, never builds the home list and never writes', async () => {
    const call = ev({ start: '14:00', end: '14:30', attendees: [me(), guest('m@vt.org', 'Morgan Ellis')] });
    h.rows['calendarEvent.findMany'] = [call];
    h.rows['clientContact.findMany'] = [{ email: 'm@vt.org', name: 'Morgan Ellis', client_id: 'c1', client: { name: 'VT Standard' } }];
    const r = await GET();
    expect(r.status).toBe(200);
    expect(r.headers.get('Cache-Control')).toBe('no-store');
    const body = await r.json();
    expect(body.upcoming).toEqual([{ id: call.id, time: '2:00', who: 'Morgan, VT Standard', muted: false, openable: true }]);
    expect(Object.keys(body).sort()).toEqual(['all_day', 'earlier', 'later', 'soon', 'tomorrow', 'upcoming']);
    expect(loadHomeInputs).not.toHaveBeenCalled();
    expect(h.calls.filter((c) => WRITES.some((w) => c.endsWith(`.${w}`)))).toEqual([]);
    expect(h.calls.some((c) => c.startsWith('homeDay'))).toBe(false);
    expect(JSON.stringify(body)).not.toContain('@');
  });

  it('an empty day gives an empty strip', async () => {
    const r = await GET();
    expect(await r.json()).toEqual({ upcoming: [], later: [], earlier: [], all_day: null, tomorrow: null, soon: null });
  });
});

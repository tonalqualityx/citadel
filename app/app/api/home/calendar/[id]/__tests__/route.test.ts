import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Mock } from 'vitest';
import { GET } from '../route';
import { ev, guest, me, at } from '@/lib/home/calendar/__tests__/helpers';
import { tonight } from '@/lib/home/__tests__/fixtures/tonight';

const h = vi.hoisted(() => ({ rows: {} as Record<string, unknown>, calls: [] as string[] }));
const WRITES = ['create', 'createMany', 'update', 'updateMany', 'upsert', 'delete', 'deleteMany'];

vi.mock('@/lib/auth/middleware', () => ({ requireAuth: vi.fn() }));
vi.mock('@/lib/services/user-timezone', () => ({ resolveUserTimezone: vi.fn(async () => 'America/New_York') }));
vi.mock('@/lib/home/load', async (orig) => ({ ...(await orig<typeof import('@/lib/home/load')>()), loadHomeInputs: vi.fn() }));
vi.mock('@/lib/home/state', () => ({ loadItemStates: vi.fn(async () => []) }));
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
const call = (id: string) => GET(new Request('http://localhost/api/home/calendar/' + id), { params: Promise.resolve({ id }) });

const today = ev({ start: '14:00', end: '14:30', meet_url: 'https://meet.google.com/abc-defg-hij', attendees: [me(), guest('m@vt.org', 'Morgan Ellis')] });

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(at('11:40'));
  h.calls = [];
  h.rows = {
    'userPreference.findUnique': { home_view: 'home' },
    'calendarEvent.findUnique': today,
    'clientContact.findMany': [{ email: 'm@vt.org', name: 'Morgan Ellis', client_id: 'c1', client: { name: 'VT Standard' } }],
  };
  mockAuth.mockResolvedValue(mike);
  (loadHomeInputs as Mock).mockResolvedValue({ ...tonight().raw, now: at('11:40') });
});
afterEach(() => vi.useRealTimers());

describe('GET /api/home/calendar/[id]', () => {
  it('403 for an API key, a tech user, an overlook admin and another admin', async () => {
    for (const [auth, pref] of [
      [{ ...mike, via: 'api_key' }, 'home'],
      [{ ...mike, role: 'tech' }, 'home'],
      [mike, 'overlook'],
      [{ ...mike, email: 'sabeen@becomeindelible.com' }, 'home'],
    ] as const) {
      mockAuth.mockResolvedValue(auth);
      h.rows['userPreference.findUnique'] = { home_view: pref };
      h.calls = [];
      expect((await call(today.id)).status).toBe(403);
      expect(h.calls.filter((c) => !c.startsWith('userPreference'))).toEqual([]);
    }
  });

  it('404 for a bad uuid, an unknown event, an event 3 days out and a declined event', async () => {
    expect((await call('nope')).status).toBe(404);
    h.rows['calendarEvent.findUnique'] = null;
    expect((await call(today.id)).status).toBe(404);
    h.rows['calendarEvent.findUnique'] = ev({ day: '2026-11-14' });
    expect((await call(today.id)).status).toBe(404);
    h.rows['calendarEvent.findUnique'] = ev({ attendees: [me('declined'), guest('m@vt.org')] });
    expect((await call(today.id)).status).toBe(404);
    expect(loadHomeInputs).not.toHaveBeenCalled();
  });

  it('answers the drawer with no-store and never writes', async () => {
    const r = await call(today.id);
    expect(r.status).toBe(200);
    expect(r.headers.get('Cache-Control')).toBe('no-store');
    const body = await r.json();
    expect(body.event.join).toEqual({ href: 'https://meet.google.com/abc-defg-hij', label: 'Join on Google Meet' });
    expect(body.client).toEqual({ id: 'c1', name: 'VT Standard' });
    expect(body.matched_by).toBe('Matched by the email address of Morgan.');
    expect(Object.keys(body).sort()).toEqual(['also_with', 'client', 'event', 'hints', 'items', 'links', 'matched_by', 'more_items', 'more_project_id', 'people']);
    expect(loadHomeInputs).toHaveBeenCalledTimes(1);
    expect(h.calls.filter((c) => WRITES.some((w) => c.endsWith(`.${w}`)))).toEqual([]);
  });
});

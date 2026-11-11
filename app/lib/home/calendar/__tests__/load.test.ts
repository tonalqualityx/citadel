import { describe, it, expect, vi } from 'vitest';
import { loadBookedEventIds, loadCalendarDays, loadCalendarView, loadMatchTables } from '../load';
import { ev, guest, me, ZONE, at } from './helpers';

const WRITES = ['create', 'createMany', 'update', 'updateMany', 'upsert', 'delete', 'deleteMany'];

function fakeDb(over: Record<string, unknown[]> = {}) {
  const calls: string[] = [];
  const model = (name: string) =>
    new Proxy({}, {
      get: (_t, op: string) => {
        calls.push(`${name}.${op}`);
        if (WRITES.includes(op)) throw new Error(`write ${name}.${op}`);
        return vi.fn(async () => (op === 'findUnique' ? null : (over[name] ?? [])));
      },
    });
  const db = Object.fromEntries(['calendarEvent', 'homeOwedThread', 'user', 'clientContact', 'accord', 'domain', 'site', 'project', 'client', 'emailAsk'].map((m) => [m, model(m)]));
  return { db: db as never, calls };
}

describe('loaders', () => {
  it('loadCalendarDays asks for today and tomorrow in his zone', async () => {
    const find = vi.fn(async () => []);
    await loadCalendarDays({ calendarEvent: { findMany: find } } as never, at('11:40'), ZONE);
    const where = (find.mock.calls[0] as unknown as [{ where: { starts_at: { lt: Date }; ends_at: { gt: Date } } }])[0].where;
    expect(where.ends_at.gt.toISOString()).toBe('2026-11-11T05:00:00.000Z');
    expect(where.starts_at.lt.toISOString()).toBe('2026-11-13T05:00:00.000Z');
  });
  it('loadBookedEventIds reads only his own rows', async () => {
    const find = vi.fn(async () => [{ booked_event_id: 'g1' }, { booked_event_id: null }]);
    const ids = await loadBookedEventIds({ homeOwedThread: { findMany: find } } as never, 'u1');
    expect([...ids]).toEqual(['g1']);
    expect(find).toHaveBeenCalledWith({ where: { user_id: 'u1', booked_event_id: { not: null } }, select: { booked_event_id: true } });
  });
  it('loadMatchTables reads nothing without events and skips address tables without guests', async () => {
    const a = fakeDb();
    await loadMatchTables(a.db, []);
    expect(a.calls).toEqual([]);
    const b = fakeDb();
    await loadMatchTables(b.db, [ev({})]);
    expect(b.calls.sort()).toEqual(['client.findMany', 'emailAsk.findMany', 'project.findMany']);
  });
  it('loadMatchTables maps rows and never writes', async () => {
    const e = ev({ attendees: [me(), guest('m@vt.org', 'Morgan')] });
    const { db, calls } = fakeDb({
      clientContact: [{ email: 'm@vt.org', name: 'Morgan', client_id: 'c1', client: { name: 'VT Standard' } }],
      project: [{ id: 'p1', name: 'Phil', client_id: 'c1', client: { name: 'VT Standard' } }],
      domain: [{ name: 'vt.org', site: { client_id: 'c1' } }],
      emailAsk: [{ calendar_event_id: e.event_id, client_id: 'c1', client: { name: 'VT Standard' }, received_at: new Date(), from_email: 'm@vt.org' }],
    });
    const t = await loadMatchTables(db, [e]);
    expect(t.contacts[0]).toEqual({ email: 'm@vt.org', name: 'Morgan', client_id: 'c1', client_name: 'VT Standard' });
    expect([...t.liveClientIds]).toEqual(['c1']);
    expect(t.domains[0]).toEqual({ name: 'vt.org', client_id: 'c1' });
    expect(t.eventAsks[0].client_name).toBe('VT Standard');
    expect(calls.some((c) => WRITES.some((w) => c.endsWith(`.${w}`)))).toBe(false);
  });
  it('loadCalendarView drops declined events, matches the rest and reads only', async () => {
    const keep = ev({ start: '14:00', end: '14:30', attendees: [me(), guest('m@vt.org', 'Morgan')] });
    const gone = ev({ start: '16:00', end: '16:30', attendees: [me('declined'), guest('m@vt.org')] });
    const { db } = fakeDb({
      calendarEvent: [keep, gone],
      homeOwedThread: [],
      clientContact: [{ email: 'm@vt.org', name: 'Morgan Ellis', client_id: 'c1', client: { name: 'VT Standard' } }],
    });
    const v = await loadCalendarView(db, 'u1', at('11:40'), ZONE);
    expect(v.events.map((x) => x.id)).toEqual([keep.id]);
    expect(v.who.get(keep.id)).toEqual({ label: 'Morgan, VT Standard', matched: true });
  });
});

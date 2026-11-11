// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/db/prisma', () => ({ prisma: {} }));
vi.mock('@/lib/services/user-timezone', () => ({ resolveUserTimezone: vi.fn(async () => 'America/New_York') }));
vi.mock('@/lib/home/load', () => ({ loadHomeInputs: vi.fn(async () => ({ calendar_events: [] })) }));
vi.mock('@/lib/home/state', () => ({ loadItemStates: vi.fn(async () => []), getHomeDay: vi.fn(async () => null) }));
vi.mock('@/lib/home/select', () => ({
  selectHome: vi.fn(() => ({
    candidates: [
      { key: 'task:9', parked: true, parkedBy: 'user', item: { title: 'Parked one' }, state: { view_at: new Date('2026-11-11T14:00:00Z') } },
      { key: 'task:6', parked: true, parkedBy: 'keeper', item: { title: 'Keeper day' }, state: { view_at: new Date('2026-11-12T05:05:00Z') } },
      { key: 'task:8', parked: false, item: { title: 'In view' }, state: undefined },
      { key: 'task:7', parked: true, parkedBy: 'user', item: { title: 'Parked for good' }, state: { view_at: null } },
    ],
  })),
}));
const item = (n: number) => ({ key: `task:${n}`, title: `T${n}`, who: 'Gene', age: '2 days', effort: 'About 10 minutes', why_now: 'secret', reason: 'secret', actions: [{ id: 'done' }], minutes: 10, opened: { summary: 'long' } });
vi.mock('@/lib/home/today', () => ({
  proposeDay: vi.fn(() => ({ group_key: 'own' })),
  assembleHomeResponse: vi.fn(() => ({
    today: {
      group_key: 'arc:abc', arc_name: 'Arc', why: 'Because', size_line: 'About 20 minutes', quick: [item(1)], steps: [item(2)],
      swap: [{ group_key: 'client:c1', name: 'Jill', why: 'secret', minutes: 30, effort: 'About 30 minutes' }],
      lighter: { group_key: 'own', name: 'Indelible', why: 'secret', minutes: 10, effort: 'About 10 minutes' },
    },
    sections: { needs_you_now: [item(3)], working_on: [item(4)], leads: [], mail: [item(5)], next: [], handled: [{ id: 'h' }], handled_more: { count: 2, text: '2 more handled' } },
    everything_else: { count: 7, line: 'x', groups: [] },
  })),
}));

import { ownerToday } from '../route-helpers';

describe('ownerToday', () => {
  it('trims to the arc name and, per item, key, title, who, age and effort', async () => {
    const t = await ownerToday('u1', new Date('2026-11-10T15:00:00Z'), {} as never);
    expect(Object.keys(t).sort()).toEqual(['arc_name', 'calendar', 'counts', 'date', 'emergencies', 'group_key', 'lighter', 'parked', 'pinned', 'quick', 'size_line', 'steps', 'swap', 'why']);
    expect(t.date).toBe('2026-11-10');
    expect(Object.keys(t.quick[0]).sort()).toEqual(['age', 'effort', 'key', 'title', 'who']);
    expect(JSON.stringify(t)).not.toContain('secret');
    expect(t.group_key).toBe('arc:abc');
    expect(t.swap).toEqual([{ group_key: 'client:c1', name: 'Jill', effort: 'About 30 minutes' }]);
    expect(t.lighter).toEqual({ group_key: 'own', name: 'Indelible', effort: 'About 10 minutes' });
    expect(t.pinned).toEqual({ key: 'task:4', title: 'T4' });
    expect(t.emergencies).toEqual([{ key: 'task:3', title: 'T3', emergency: true }]);
    expect(t.parked).toEqual([{ key: 'task:9', title: 'Parked one', until: '2026-11-11T14:00:00.000Z' }, { key: 'task:7', title: 'Parked for good', until: null }]);
    expect(t.counts).toEqual({ needs_you_now: 1, working_on: 1, leads: 0, mail: 1, next: 0, handled: 3, everything_else: 7 });
    // Slice 10a: no calendar rows when the calendar cannot be read (this fake db has no tables).
    expect(t.calendar).toEqual({ rows: [], tomorrow_first: null });
  });

  it('adds today\'s calendar for the calendar owner, by names only', async () => {
    const start = new Date('2026-11-10T19:00:00Z');
    const db = {
      user: { findUnique: vi.fn(async () => ({ email: 'mike@becomeindelible.com' })), findMany: vi.fn(async () => []) },
      calendarEvent: {
        findMany: vi.fn(async () => [{ id: 'e1', event_id: 'g1', title: 'Erick a@b.co', starts_at: start, ends_at: new Date(start.getTime() + 1_800_000), all_day: false, description: 'secret@x.com', meet_url: 'https://meet.google.com/a', location: null, attendees: [{ email: 'erick@boot.com', display_name: 'Erick', response_status: 'accepted' }] }]),
      },
    };
    const none = vi.fn(async () => []);
    const full = { ...db, homeOwedThread: { findMany: none }, clientContact: { findMany: none }, accord: { findMany: none }, domain: { findMany: none }, site: { findMany: none }, project: { findMany: none }, client: { findMany: none }, emailAsk: { findMany: none } };
    const t = await ownerToday('u1', new Date('2026-11-10T15:00:00Z'), full as never);
    expect(t.calendar.rows).toHaveLength(1);
    expect(t.calendar.rows[0]).toMatchObject({ who: 'Erick', kind: 'meeting', join_url: 'https://meet.google.com/a', client: null, lead: false });
    expect(JSON.stringify(t.calendar)).not.toContain('@');
    // The existing fields are the same as without the calendar.
    const { calendar: _c, ...rest } = t;
    void _c;
    const base = await ownerToday('u1', new Date('2026-11-10T15:00:00Z'), {} as never);
    const { calendar: _d, ...baseRest } = base;
    void _d;
    expect(rest).toEqual(baseRest);
  });
});

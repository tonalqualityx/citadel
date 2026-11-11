import { describe, it, expect, vi } from 'vitest';
import { chatCalendarFrom, ownerCalendar, EMPTY_CHAT_CALENDAR } from '../chat';
import type { CalendarView } from '../load';
import { matchEvent, EMPTY_TABLES } from '../match';
import { ev, guest, me, ZONE, at } from './helpers';

function view(events: ReturnType<typeof ev>[], booked: string[] = []): CalendarView {
  const tables = {
    ...EMPTY_TABLES,
    contacts: [{ email: 'm@vt.org', name: 'Morgan Ellis', client_id: 'c1', client_name: 'VT Standard' }],
    accords: [{ id: 'a1', lead_email: 'e@boot.com', lead_name: 'Erick', lead_business_name: 'Bootleggers', updated_at: new Date() }],
  };
  const matches = new Map(events.map((e) => [e.id, matchEvent(e, tables)]));
  return { events, bookedIds: new Set(booked), tables, matches, who: new Map([...matches].map(([k, m]) => [k, { label: m.label, matched: m.matched }])) };
}

describe('chatCalendarFrom', () => {
  const vt = ev({ title: 'VT call', start: '11:30', end: '12:00', meet_url: 'https://meet.google.com/abc', description: 'secret@evil.com', attendees: [me(), guest('m@vt.org', 'Morgan Ellis')] });
  const lead = ev({ title: 'Erick Bootleggers and Mike Dion', start: '14:00', end: '14:30', attendees: [me(), guest('e@boot.com', 'Erick')] });
  const answer = ev({ title: 'Answer Jessica', start: '15:00', end: '15:30' });
  const block = ev({ title: 'Boys to Robotics', start: '15:30', end: '18:00' });
  const home = ev({ title: 'Home', all_day: true, starts_at: new Date('2026-11-11T00:00:00Z'), ends_at: new Date('2026-11-12T00:00:00Z') });
  const tmw = ev({ title: 'Morgan tomorrow', start: '13:00', end: '13:30', day: '2026-11-12', attendees: [me(), guest('m@vt.org', 'Morgan Ellis')] });
  const v = view([block, answer, lead, vt, home, tmw], [answer.event_id]);

  it('lists today by names with kind, client, lead and join, and the first meeting tomorrow', () => {
    const c = chatCalendarFrom(v, at('11:40'), ZONE);
    expect(c.rows.map((r) => [r.who, r.kind, r.client, r.lead, r.all_day])).toEqual([
      ['Home', 'block', null, false, true],
      ['Morgan, VT Standard', 'meeting', 'VT Standard', false, false],
      ['Erick, Bootleggers (lead)', 'meeting', null, true, false],
      ['Your time to answer Jessica', 'answer', null, false, false],
      ['Boys to Robotics', 'block', null, false, false],
    ]);
    expect(c.rows[1].join_url).toBe('https://meet.google.com/abc');
    expect(c.rows[1].start).toBe('2026-11-11T16:30:00.000Z');
    expect(c.tomorrow_first).toMatchObject({ who: 'Morgan, VT Standard', kind: 'meeting' });
    expect(Object.keys(c.rows[0]).sort()).toEqual(['all_day', 'client', 'end', 'join_url', 'kind', 'lead', 'start', 'title', 'who']);
  });

  it('has no @ anywhere, even from a hostile title, and refuses an @ in a link', () => {
    const bad = ev({ title: 'Meet a@b.co now', start: '16:00', end: '16:30', meet_url: 'https://meet.google.com/x@y', attendees: [me(), guest('q@z.io', 'q@z.io')] });
    const c = chatCalendarFrom(view([vt, bad]), at('11:40'), ZONE);
    expect(JSON.stringify(c)).not.toContain('@');
    expect(c.rows[1].join_url).toBeNull();
  });

  it('leaves declined events out and caps the rows at 12', () => {
    const many = Array.from({ length: 15 }, (_, i) => ev({ title: `E${i}`, start: '09:00', end: '09:30' }));
    const gone = ev({ start: '10:00', end: '10:30', attendees: [me('declined'), guest('m@vt.org')] });
    const c = chatCalendarFrom(view([...many, gone]), at('11:40'), ZONE);
    expect(c.rows).toHaveLength(12);
    expect(c.rows.some((r) => r.start === gone.starts_at.toISOString())).toBe(false);
  });
});

describe('ownerCalendar', () => {
  it('is empty when the owner is not the calendar owner, and reads nothing else', async () => {
    const find = vi.fn(async () => ({ email: 'sabeen@becomeindelible.com' }));
    const cal = vi.fn();
    const r = await ownerCalendar({ user: { findUnique: find }, calendarEvent: { findMany: cal } } as never, 'u2', at('11:40'), ZONE);
    expect(r).toEqual(EMPTY_CHAT_CALENDAR);
    expect(cal).not.toHaveBeenCalled();
  });
  it('is empty, not an error, when a read fails', async () => {
    expect(await ownerCalendar({} as never, 'u1', at('11:40'), ZONE)).toEqual(EMPTY_CHAT_CALENDAR);
  });
});

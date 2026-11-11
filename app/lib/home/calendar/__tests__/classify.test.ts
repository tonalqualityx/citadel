import { describe, it, expect } from 'vitest';
import { dayWindow, eventKind, isDeclined, isMeeting, onDay, others, parseAttendees } from '../classify';
import { daysFor } from '../strip';
import { ev, guest, me, ZONE, at } from './helpers';

const now = at('11:40');

describe('onDay', () => {
  it('an all-day event stored Nov 12 to Nov 13 is not on Nov 11 and is on Nov 12', () => {
    const e = ev({ all_day: true, starts_at: new Date('2026-11-12T00:00:00Z'), ends_at: new Date('2026-11-13T00:00:00Z') });
    const d11 = daysFor(now, ZONE);
    expect(onDay(e, d11.today)).toBe(false);
    expect(onDay(e, d11.tomorrow)).toBe(true);
    const d12 = daysFor(at('11:40', '2026-11-12'), ZONE);
    expect(onDay(e, d12.today)).toBe(true);
  });
  it('a timed event overlapping the day counts, one ending at midnight does not count for the next day', () => {
    const d = daysFor(now, ZONE);
    expect(onDay(ev({ start: '23:00', end: '23:59' }), d.today)).toBe(true);
    expect(onDay(ev({ start: '23:00', end: '23:59' }), d.tomorrow)).toBe(false);
  });
  it('dayWindow carries the zoned date text', () => {
    const d = daysFor(now, ZONE);
    expect(dayWindow(d.today.start, d.today.end, ZONE).ymd).toBe('2026-11-11');
  });
});

describe('attendees', () => {
  it('others drops him, rooms and group calendars, and repeats', () => {
    const e = ev({
      attendees: [me(), guest('A@x.com'), guest('a@x.com'), guest('room@resource.calendar.google.com'), guest('g@group.calendar.google.com'), { email: 'mike@becomeindelible.com' }],
    });
    expect(others(e).map((a) => a.email)).toEqual(['a@x.com']);
  });
  it('unreadable attendee data gives none', () => {
    expect(parseAttendees('nope')).toEqual([]);
    expect(parseAttendees([null, 3, {}])).toEqual([]);
  });
  it('declined means his own entry only', () => {
    expect(isDeclined(ev({ attendees: [me('declined'), guest('a@x.com')] }))).toBe(true);
    expect(isDeclined(ev({ attendees: [me(), guest('a@x.com', null, 'declined')] }))).toBe(false);
  });
});

describe('kinds', () => {
  const none = new Set<string>();
  it('answer when booked, meeting with another attendee or a title match, block otherwise', () => {
    const booked = ev({});
    expect(eventKind(booked, { bookedIds: new Set([booked.event_id]) })).toBe('answer');
    expect(eventKind(ev({ attendees: [me(), guest('a@x.com')] }), { bookedIds: none })).toBe('meeting');
    expect(eventKind(ev({ attendees: [me()] }), { bookedIds: none })).toBe('block');
    expect(eventKind(ev({}), { bookedIds: none, titleMatched: true })).toBe('meeting');
  });
  it('isMeeting is timed, not declined and kind meeting', () => {
    const base = { attendees: [me(), guest('a@x.com')] };
    expect(isMeeting(ev(base), { bookedIds: none })).toBe(true);
    expect(isMeeting(ev({ ...base, all_day: true }), { bookedIds: none })).toBe(false);
    expect(isMeeting(ev({ attendees: [me('declined'), guest('a@x.com')] }), { bookedIds: none })).toBe(false);
    expect(isMeeting(ev({}), { bookedIds: none })).toBe(false);
  });
});

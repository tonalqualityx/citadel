import { describe, it, expect } from 'vitest';
import { buildStrip, type EventWho } from '../strip';
import type { CalEvent } from '../classify';
import { ev, guest, me, ZONE, at } from './helpers';

const vt: EventWho = { label: 'Morgan and Dan, VT Standard', matched: true };
const noBooked = new Set<string>();

function strip(now: Date, events: CalEvent[], who: Record<string, EventWho> = {}, booked = noBooked) {
  return buildStrip({ now, timeZone: ZONE, events, bookedIds: booked, who: new Map(Object.entries(who)) });
}
const call = (over: Partial<CalEvent> & { start?: string; end?: string; day?: string }) => ev({ attendees: [me(), guest('m@vt.org', 'Morgan')], ...over });

describe('buildStrip', () => {
  it('a declined event is gone', () => {
    const d = call({ start: '14:00', end: '14:30', attendees: [me('declined'), guest('m@vt.org')] });
    expect(strip(at('11:40'), [d])).toEqual({ upcoming: [], later: [], earlier: [], all_day: null, tomorrow: null, soon: null });
  });

  it('at 15:00 after 3 ended events: earlier 3 and the tomorrow line; at 14:59 no tomorrow line', () => {
    const past = [call({ start: '09:00', end: '09:30' }), call({ start: '10:00', end: '10:30' }), call({ start: '11:00', end: '11:30' })];
    const later = call({ start: '16:00', end: '16:30' });
    const tmw = call({ start: '13:00', end: '13:30', day: '2026-11-12' });
    const who = Object.fromEntries([...past, later, tmw].map((e) => [e.id, vt]));
    const s = strip(at('15:00'), [...past, later, tmw], who);
    expect(s.earlier).toHaveLength(3);
    expect(s.tomorrow).toMatchObject({ time: 'Tomorrow 1:00', who: 'Morgan and Dan, VT Standard', muted: true, openable: true });
    expect(strip(at('14:59'), [...past, later, tmw], who).tomorrow).toBeNull();
  });

  it('nothing upcoming before 15:00 is an empty strip', () => {
    const past = call({ start: '09:00', end: '09:30' });
    expect(strip(at('11:40'), [past], { [past.id]: vt })).toEqual({ upcoming: [], later: [], earlier: [], all_day: null, tomorrow: null, soon: null });
  });

  it('a lone all-day Home gives an empty strip, but shows beside a timed row', () => {
    const home = ev({ title: 'Home', all_day: true, starts_at: new Date('2026-11-11T00:00:00Z'), ends_at: new Date('2026-11-12T00:00:00Z') });
    expect(strip(at('11:40'), [home]).all_day).toBeNull();
    const c = call({ start: '14:00', end: '14:30' });
    expect(strip(at('11:40'), [home, c], { [c.id]: vt }).all_day).toBe('All day: Home');
  });

  it('a 150 minute block reads "until 6:00", muted and not openable', () => {
    const block = ev({ title: 'Boys to Robotics', start: '15:30', end: '18:00' });
    const c = call({ start: '14:00', end: '14:30' });
    const s = strip(at('11:40'), [c, block], { [c.id]: vt });
    expect(s.upcoming[1]).toMatchObject({ time: '3:30', who: 'Boys to Robotics, until 6:00', muted: true, openable: false });
  });

  it('a short block shows its title only', () => {
    const block = ev({ title: 'Dentist', start: '16:00', end: '17:00' });
    const c = call({ start: '14:00', end: '14:30' });
    expect(strip(at('11:40'), [c, block], { [c.id]: vt }).upcoming[1].who).toBe('Dentist');
  });

  it('times: 2:00, 6:30 am, 8:00 pm and Now', () => {
    const early = call({ start: '06:30', end: '07:00', day: '2026-11-11' });
    const mid = call({ start: '14:00', end: '14:30' });
    const late = call({ start: '20:00', end: '20:30' });
    const live = call({ start: '11:30', end: '12:00' });
    const who = Object.fromEntries([early, mid, late, live].map((e) => [e.id, vt]));
    const s = strip(at('06:00'), [early, mid, late], who);
    expect(s.upcoming.map((r) => r.time)).toEqual(['6:30 am', '2:00', '8:00 pm']);
    const s2 = strip(at('11:40'), [live, mid], who);
    expect(s2.upcoming.map((r) => r.time)).toEqual(['Now', '2:00']);
  });

  it('shows 4 upcoming rows and folds the rest into later', () => {
    const list = ['12:00', '13:00', '14:00', '15:00', '16:00', '17:00'].map((t) => call({ start: t, end: t.replace(/^(\d+)/, (x) => String(Number(x))).replace(':00', ':30') }));
    const who = Object.fromEntries(list.map((e) => [e.id, vt]));
    const s = strip(at('09:00'), list, who);
    expect(s.upcoming).toHaveLength(4);
    expect(s.later).toHaveLength(2);
  });

  it('an answer block is muted and openable, with the name from the title', () => {
    const a = ev({ title: 'Answer Jessica', start: '15:00', end: '15:30' });
    const c = call({ start: '14:00', end: '14:30' });
    const s = strip(at('11:40'), [c, a], { [c.id]: vt }, new Set([a.event_id]));
    expect(s.upcoming[1]).toMatchObject({ who: 'Your time to answer Jessica', muted: true, openable: true });
  });

  it('soon is a meeting under way or within 30 minutes, never a block', () => {
    const c = call({ start: '12:10', end: '12:40' });
    expect(strip(at('11:50'), [c], { [c.id]: vt }).soon).toMatchObject({ time: '12:10', openable: true, muted: false });
    expect(strip(at('11:20'), [c], { [c.id]: vt }).soon).toBeNull();
    const block = ev({ title: 'Focus', start: '12:00', end: '13:00' });
    expect(strip(at('11:50'), [c, block], { [c.id]: vt }).soon?.id).toBe(c.id);
    const live = call({ start: '11:30', end: '12:30' });
    expect(strip(at('11:50'), [live], { [live.id]: vt }).soon?.time).toBe('Now');
  });

  it('tomorrow skips personal blocks and picks the first meeting', () => {
    const block = ev({ title: 'Gym', start: '07:00', end: '08:00', day: '2026-11-12' });
    const m = call({ start: '13:00', end: '13:30', day: '2026-11-12' });
    const today = call({ start: '16:00', end: '16:30' });
    const s = strip(at('15:10'), [block, m, today], { [m.id]: vt, [today.id]: vt });
    expect(s.tomorrow?.id).toBe(m.id);
  });

  it('no row carries an address', () => {
    const c = call({ start: '14:00', end: '14:30', title: 'x@y.com' });
    const s = strip(at('11:40'), [c], { [c.id]: { label: 'Morgan', matched: true } });
    expect(JSON.stringify(s)).not.toContain('@');
  });
});

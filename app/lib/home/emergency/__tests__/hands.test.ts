import { describe, it, expect } from 'vitest';
import { groupHands, handsRow, inHandsWindow, isHandsTask, nextHandsMonday, HANDS_TAGS, type HandsTask } from '../hands';

const TZ = 'America/New_York';
// Monday 2026-11-09 at 09:00 New York.
const MON = new Date('2026-11-09T14:00:00Z');
const SAT = new Date('2026-11-14T15:00:00Z');
const t = (id: string, over: Partial<HandsTask> = {}): HandsTask => ({
  id,
  title: `Job ${id}`,
  tags: ['hands'],
  status: 'not_started',
  has_hard_date: false,
  estimated_minutes: 10,
  sop: null,
  ...over,
});

describe('window', () => {
  it('Monday 00:05 to Friday 23:59, not the weekend', () => {
    expect(inHandsWindow(MON, TZ)).toBe(true);
    expect(inHandsWindow(new Date('2026-11-09T05:04:00Z'), TZ)).toBe(false); // Mon 00:04
    expect(inHandsWindow(new Date('2026-11-09T05:05:00Z'), TZ)).toBe(true); // Mon 00:05
    expect(inHandsWindow(new Date('2026-11-14T04:58:00Z'), TZ)).toBe(true); // Fri 23:58
    expect(inHandsWindow(new Date('2026-11-14T05:00:00Z'), TZ)).toBe(false); // Sat 00:00
    expect(inHandsWindow(SAT, TZ)).toBe(false);
    expect(inHandsWindow(new Date('2026-11-15T15:00:00Z'), TZ)).toBe(false); // Sun
  });
  it('next Monday 00:05 on his clock', () => {
    expect(nextHandsMonday(MON, TZ).toISOString()).toBe('2026-11-16T05:05:00.000Z');
    expect(nextHandsMonday(SAT, TZ).toISOString()).toBe('2026-11-16T05:05:00.000Z');
    expect(nextHandsMonday(new Date('2026-11-15T15:00:00Z'), TZ).toISOString()).toBe('2026-11-16T05:05:00.000Z');
    // across the November clock change the offset is 5 hours already; across March it is 4
    expect(nextHandsMonday(new Date('2026-03-04T15:00:00Z'), TZ).toISOString()).toBe('2026-03-09T04:05:00.000Z');
  });
});

describe('which tasks', () => {
  it('uses the two tags, no hard date, open only', () => {
    expect(HANDS_TAGS).toEqual(['hands', 'credential-rotation']);
    expect(isHandsTask(t('a'))).toBe(true);
    expect(isHandsTask(t('a', { tags: ['credential-rotation'] }))).toBe(true);
    expect(isHandsTask(t('a', { tags: ['other'] }))).toBe(false);
    expect(isHandsTask(t('a', { has_hard_date: true }))).toBe(false);
    expect(isHandsTask(t('a', { status: 'done' }))).toBe(false);
  });
});

describe('handsRow', () => {
  it('words the row with the count and the rounded minutes', () => {
    const r = handsRow([t('a', { estimated_minutes: 12 }), t('b', { estimated_minutes: 20 }), t('c', { tags: ['x'] })], MON, TZ)!;
    expect(r.key).toBe('hands:week');
    expect(r.count).toBe(2);
    expect(r.minutes).toBe(30);
    expect(r.title).toBe("This week's hands: 2 jobs, about 30 minutes in all.");
  });
  it('says 1 job for one job, and counts a job with no estimate as 10 minutes', () => {
    const r = handsRow([t('a', { estimated_minutes: null })], MON, TZ)!;
    expect(r.title).toBe("This week's hands: 1 job, about 10 minutes in all.");
  });
  it('appears on a Monday and not on Saturday', () => {
    expect(handsRow([t('a')], MON, TZ)).not.toBeNull();
    expect(handsRow([t('a')], SAT, TZ)).toBeNull();
  });
  it('is hidden while parked and back after the park time', () => {
    const until = nextHandsMonday(MON, TZ);
    expect(handsRow([t('a')], new Date('2026-11-11T15:00:00Z'), TZ, until)).toBeNull();
    expect(handsRow([t('a')], new Date('2026-11-16T05:06:00Z'), TZ, until)).not.toBeNull();
  });
  it('is null with no jobs', () => {
    expect(handsRow([], MON, TZ)).toBeNull();
  });
});

describe('groupHands', () => {
  it('groups by SOP and puts "No written steps" last', () => {
    const g = groupHands([
      t('1', { sop: { id: 's2', title: 'Rotate keys' } }),
      t('2'),
      t('3', { sop: { id: 's1', title: 'Add a user' } }),
      t('4', { sop: { id: 's2', title: 'Rotate keys' }, title: 'A first' }),
    ]);
    expect(g.map((x) => x.label)).toEqual(['Add a user', 'Rotate keys', 'No written steps']);
    expect(g[1].jobs.map((j) => j.title)).toEqual(['A first', 'Job 1']);
    expect(g[2].sop_id).toBeNull();
  });
});

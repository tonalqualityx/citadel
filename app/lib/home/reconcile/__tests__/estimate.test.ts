import { describe, it, expect } from 'vitest';
import { FALLBACK_BASIS, MINUTES_FALLBACK, basisWords, clampMinutes, minutesWords, sessionSpanMinutes } from '../estimate';

describe('time estimate bounds', () => {
  it('rounds to 15 and clamps to 15 to 480', () => {
    expect(clampMinutes(52)).toBe(45);
    expect(clampMinutes(53)).toBe(60);
    expect(clampMinutes(68)).toBe(75);
    expect(clampMinutes(1)).toBe(15);
    expect(clampMinutes(900)).toBe(480);
  });
  it('uses 30 minutes with "no detail in the mail" when the model gave nothing', () => {
    expect(clampMinutes(0)).toBe(MINUTES_FALLBACK);
    expect(clampMinutes(null)).toBe(MINUTES_FALLBACK);
    expect(basisWords(0, 'six emails')).toBe(FALLBACK_BASIS);
    expect(basisWords(60, '')).toBe(FALLBACK_BASIS);
    expect(basisWords(60, 'six emails over two days')).toBe('six emails over two days');
  });
  it('counts a session span at most 180 minutes', () => {
    const t = new Date('2026-11-10T10:00:00Z');
    expect(sessionSpanMinutes(t, new Date('2026-11-10T11:40:00Z'))).toBe(100);
    expect(sessionSpanMinutes(t, new Date('2026-11-10T20:00:00Z'))).toBe(180);
    expect(sessionSpanMinutes(null, t)).toBe(0);
  });
  it('words', () => {
    expect(minutesWords(90)).toBe('1 hour 30 minutes');
    expect(minutesWords(60)).toBe('1 hour');
    expect(minutesWords(45)).toBe('45 minutes');
    expect(minutesWords(120)).toBe('2 hours');
  });
});

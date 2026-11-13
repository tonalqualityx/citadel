import { describe, it, expect } from 'vitest';
import { dragWidth, maxPx, normalPx, parseWidthPref, resolveWidth, serializeWidthPref, widePx, NORMAL_WIDTH_CSS } from '../chat-width';

describe('chat width bounds', () => {
  it('normal follows the old clamp', () => {
    expect(normalPx(1000)).toBe(360);
    expect(normalPx(1280)).toBeCloseTo(435.2);
    expect(normalPx(2400)).toBe(480);
  });
  it('wide is about twice normal, clamped 640..960', () => {
    expect(widePx(1000)).toBe(640);
    expect(widePx(1440)).toBe(864);
    expect(widePx(2400)).toBe(960);
  });
  it('the page column keeps 360px after the sidebar, and nothing passes 960', () => {
    expect(maxPx(1440, 240)).toBe(840);
    expect(maxPx(2400, 240)).toBe(960);
    expect(maxPx(1440, 0)).toBe(960);
  });
  it('normal resolves to the CSS clamp', () => {
    const r = resolveWidth({ kind: 'normal' }, 1440, 240);
    expect(r.css).toBe(NORMAL_WIDTH_CSS);
    expect(r.wide).toBe(false);
    expect(r.canWiden).toBe(true);
  });
  it('wide is capped so the page keeps 360px', () => {
    const r = resolveWidth({ kind: 'wide' }, 1440, 240);
    expect(r.px).toBe(840);
    expect(1440 - 240 - r.px).toBeGreaterThanOrEqual(360);
    expect(r.wide).toBe(true);
    expect(resolveWidth({ kind: 'wide' }, 2000, 240).px).toBe(960);
  });
  it('cannot widen when the window is too small, and a saved wide falls back to normal', () => {
    const r = resolveWidth({ kind: 'wide' }, 1100, 240);
    expect(r.canWiden).toBe(false);
    expect(r.wide).toBe(false);
    expect(r.css).toBe(NORMAL_WIDTH_CSS);
  });
  it('a dragged width is clamped to the bounds of this window', () => {
    expect(resolveWidth({ kind: 'custom', px: 900 }, 1440, 240).px).toBe(840);
    expect(resolveWidth({ kind: 'custom', px: 100 }, 1440, 240).px).toBe(360);
  });
});

describe('drag math', () => {
  it('moving the pointer left widens by the distance, right narrows', () => {
    expect(dragWidth(435, 1000, 900, 1440, 240)).toBe(535);
    expect(dragWidth(535, 900, 1000, 1440, 240)).toBe(435);
  });
  it('stops at the minimum and the maximum', () => {
    expect(dragWidth(435, 1000, 1400, 1440, 240)).toBe(360);
    expect(dragWidth(435, 1000, 0, 1440, 240)).toBe(840);
  });
});

describe('remembered width', () => {
  it('round-trips', () => {
    for (const p of [{ kind: 'normal' }, { kind: 'wide' }, { kind: 'custom', px: 612 }] as const) {
      expect(parseWidthPref(serializeWidthPref(p))).toEqual(p);
    }
  });
  it('junk means normal', () => {
    expect(parseWidthPref('banana')).toEqual({ kind: 'normal' });
    expect(parseWidthPref(null)).toEqual({ kind: 'normal' });
    expect(parseWidthPref('5')).toEqual({ kind: 'normal' });
  });
});

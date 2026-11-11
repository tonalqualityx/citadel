import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { isLongAway, useAwayReturn, AWAY_MS } from '../away';

function setVisibility(state: 'hidden' | 'visible') {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state });
  document.dispatchEvent(new Event('visibilitychange'));
}

describe('isLongAway', () => {
  it('is false for no hidden time', () => {
    expect(isLongAway(null, 1_000_000)).toBe(false);
  });
  it('is false just under 20 minutes and true at 20', () => {
    const t0 = 1_000_000;
    expect(isLongAway(t0, t0 + 19 * 60_000)).toBe(false);
    expect(isLongAway(t0, t0 + 20 * 60_000)).toBe(true);
    expect(AWAY_MS).toBe(20 * 60_000);
  });
});

describe('useAwayReturn', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-10T12:00:00Z'));
  });
  afterEach(() => {
    setVisibility('visible');
    vi.useRealTimers();
  });

  it('19 minutes away shows no prompt', () => {
    const { result } = renderHook(() => useAwayReturn(true));
    act(() => setVisibility('hidden'));
    vi.advanceTimersByTime(19 * 60_000);
    act(() => setVisibility('visible'));
    expect(result.current.away).toBe(false);
  });

  it('20 minutes away shows the prompt, and dismiss closes it', () => {
    const { result } = renderHook(() => useAwayReturn(true));
    act(() => setVisibility('hidden'));
    vi.advanceTimersByTime(20 * 60_000);
    act(() => setVisibility('visible'));
    expect(result.current.away).toBe(true);
    act(() => result.current.dismiss());
    expect(result.current.away).toBe(false);
  });

  it('does nothing while inactive', () => {
    const { result } = renderHook(() => useAwayReturn(false));
    act(() => setVisibility('hidden'));
    vi.advanceTimersByTime(30 * 60_000);
    act(() => setVisibility('visible'));
    expect(result.current.away).toBe(false);
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { TOP_KEY, isWorkspaceRoute, resetTopHiddenForTests, useTopHidden } from '../workspace-chrome';

function memoryStorage() {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, String(v)), removeItem: (k: string) => void m.delete(k), clear: () => m.clear() };
}
let store = memoryStorage();

beforeEach(() => {
  store = memoryStorage();
  vi.stubGlobal('localStorage', store);
  resetTopHiddenForTests();
});

describe('workspace-chrome', () => {
  it('the key is the documented one', () => {
    expect(TOP_KEY).toBe('citadel-design-workspace-top');
  });

  it('recognises only the workspace route', () => {
    expect(isWorkspaceRoute('/design/s/abc')).toBe(true);
    expect(isWorkspaceRoute('/design')).toBe(false);
    expect(isWorkspaceRoute('/design/admin')).toBe(false);
    expect(isWorkspaceRoute('/design/publishes/x')).toBe(false);
    expect(isWorkspaceRoute(null)).toBe(false);
  });

  it('defaults to shown', () => {
    const { result } = renderHook(() => useTopHidden());
    expect(result.current[0]).toBe(false);
  });

  it('reads a stored hidden choice', () => {
    store.setItem(TOP_KEY, 'hidden');
    const { result } = renderHook(() => useTopHidden());
    expect(result.current[0]).toBe(true);
  });

  it('set persists and every hook follows', () => {
    const a = renderHook(() => useTopHidden());
    const b = renderHook(() => useTopHidden());
    act(() => a.result.current[1](true));
    expect(store.getItem(TOP_KEY)).toBe('hidden');
    expect(a.result.current[0]).toBe(true);
    expect(b.result.current[0]).toBe(true);
    act(() => b.result.current[1](false));
    expect(store.getItem(TOP_KEY)).toBe('shown');
    expect(a.result.current[0]).toBe(false);
  });

  it('storage that throws does not crash and the choice lasts for the page', () => {
    vi.stubGlobal('localStorage', { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } });
    const { result } = renderHook(() => useTopHidden());
    expect(result.current[0]).toBe(false);
    act(() => result.current[1](true));
    expect(result.current[0]).toBe(true);
  });
});

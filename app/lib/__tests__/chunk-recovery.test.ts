import { describe, it, expect, vi } from 'vitest';
import {
  isChunkError,
  shouldReloadForChunkError,
  reloadOnceForChunkError,
  CHUNK_RELOAD_WINDOW_MS,
  type ReloadStorage,
} from '../chunk-recovery';

function memStorage(): ReloadStorage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v) };
}

describe('isChunkError', () => {
  it('matches chunk and dynamic import failures', () => {
    expect(isChunkError(Object.assign(new Error('x'), { name: 'ChunkLoadError' }))).toBe(true);
    expect(isChunkError('Uncaught ChunkLoadError: Failed to load chunk /_next/static/chunks/a.js from module 964893')).toBe(true);
    expect(isChunkError(new Error('Loading chunk 123 failed.'))).toBe(true);
    expect(isChunkError(new TypeError('Failed to fetch dynamically imported module: https://x/a.js'))).toBe(true);
  });
  it('ignores unrelated errors', () => {
    expect(isChunkError(new Error('Cannot read properties of undefined'))).toBe(false);
    expect(isChunkError(null)).toBe(false);
    expect(isChunkError(42)).toBe(false);
  });
});

describe('shouldReloadForChunkError', () => {
  it('allows the first reload, then blocks within the hour for the same build', () => {
    const s = memStorage();
    expect(shouldReloadForChunkError('b1', 1000, s)).toBe(true);
    expect(shouldReloadForChunkError('b1', 1000 + CHUNK_RELOAD_WINDOW_MS - 1, s)).toBe(false);
    expect(shouldReloadForChunkError('b1', 1000 + CHUNK_RELOAD_WINDOW_MS, s)).toBe(true);
  });
  it('is keyed per build id', () => {
    const s = memStorage();
    expect(shouldReloadForChunkError('b1', 1000, s)).toBe(true);
    expect(shouldReloadForChunkError('b2', 1001, s)).toBe(true);
  });
  it('refuses when storage is missing or throws', () => {
    expect(shouldReloadForChunkError('b1', 1, null)).toBe(false);
    const bad: ReloadStorage = { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('denied'); } };
    expect(shouldReloadForChunkError('b1', 1, bad)).toBe(false);
  });
});

describe('reloadOnceForChunkError', () => {
  it('reloads once per session window', () => {
    sessionStorage.clear();
    const reload = vi.fn();
    expect(reloadOnceForChunkError(reload)).toBe(true);
    expect(reloadOnceForChunkError(reload)).toBe(false);
    expect(reload).toHaveBeenCalledTimes(1);
  });
});

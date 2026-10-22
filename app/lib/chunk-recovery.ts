/**
 * Stale-chunk recovery. A tab holding a page from an older build can request a JS chunk the
 * newer build no longer serves (404, then "ChunkLoadError"). One reload fetches the new build.
 * Guarded to once per hour per build id so a genuinely broken chunk can never loop.
 */

const CHUNK_ERROR_PATTERN =
  /ChunkLoadError|Loading chunk [\w-]+ failed|Loading CSS chunk|Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed/i;

export const CHUNK_RELOAD_WINDOW_MS = 60 * 60 * 1000;

/** True when an error (Error, string, event reason or message) looks like a chunk/dynamic-import failure. */
export function isChunkError(input: unknown): boolean {
  if (input == null) return false;
  if (typeof input === 'string') return CHUNK_ERROR_PATTERN.test(input);
  if (typeof input === 'object') {
    const e = input as { name?: unknown; message?: unknown };
    const name = typeof e.name === 'string' ? e.name : '';
    const message = typeof e.message === 'string' ? e.message : '';
    return CHUNK_ERROR_PATTERN.test(`${name} ${message}`);
  }
  return false;
}

export function currentBuildId(): string {
  return process.env.NEXT_PUBLIC_BUILD_ID || 'unknown';
}

export interface ReloadStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function defaultStorage(): ReloadStorage | null {
  try {
    return typeof window !== 'undefined' ? window.sessionStorage : null;
  } catch {
    return null;
  }
}

/**
 * Returns true (and records it) when a reload is allowed for this build id: none yet, or the
 * last one was over an hour ago. If storage is unavailable we refuse, because without a guard
 * a persistent failure would reload forever.
 */
export function shouldReloadForChunkError(
  buildId: string = currentBuildId(),
  now: number = Date.now(),
  storage: ReloadStorage | null = defaultStorage(),
): boolean {
  if (!storage) return false;
  const key = `citadel-chunk-reload:${buildId}`;
  try {
    const last = Number(storage.getItem(key));
    if (Number.isFinite(last) && last > 0 && now - last < CHUNK_RELOAD_WINDOW_MS) return false;
    storage.setItem(key, String(now));
    return true;
  } catch {
    return false;
  }
}

/** Reload once if the guard allows it. Returns whether a reload was triggered. */
export function reloadOnceForChunkError(reload: () => void = () => window.location.reload()): boolean {
  if (!shouldReloadForChunkError()) return false;
  reload();
  return true;
}

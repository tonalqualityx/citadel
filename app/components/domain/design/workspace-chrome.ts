'use client';

import * as React from 'react';

/** Whether the top of the workspace page (site header, sidebar row, the workspace's own header) is hidden. */
export const TOP_KEY = 'citadel-design-workspace-top';

/** The workspace page (/design/s/:id), where the preview needs the room. Other /design pages keep today's layout. */
export const isWorkspaceRoute = (pathname: string | null) => /^\/design\/s\/[^/]+/.test(pathname ?? '');

function read(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}
function write(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // private window or blocked storage: the choice just lasts for this page
  }
}

// Kept in memory too, so the choice still holds for this page when storage is blocked.
let memory: boolean | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

function getSnapshot(): boolean {
  const stored = read(TOP_KEY);
  if (stored === 'hidden') return true;
  if (stored === 'shown') return false;
  return memory ?? false;
}
const getServerSnapshot = () => false;

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  const onStorage = (e: StorageEvent) => {
    if (e.key === null || e.key === TOP_KEY) listener();
  };
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('storage', onStorage);
  };
}

function setTopHidden(next: boolean) {
  memory = next;
  write(TOP_KEY, next ? 'hidden' : 'shown');
  emit();
}

/**
 * [hidden, setHidden]. The server and the first client render are both false; the stored value applies right after
 * hydration. Shared by every component on the page, so the shell and the workspace stay in step.
 */
export function useTopHidden(): [boolean, (next: boolean) => void] {
  const hidden = React.useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  return [hidden, setTopHidden];
}

/** Unit tests only: forget the in-memory choice. Clear or stub localStorage separately. */
export function resetTopHiddenForTests() {
  memory = null;
  emit();
}

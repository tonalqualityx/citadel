'use client';

import { useSyncExternalStore } from 'react';

/** A CSS media query as a boolean. False on the server and where matchMedia does not exist (tests, old browsers). */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (notify) => {
      if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return () => {};
      const mq = window.matchMedia(query);
      mq.addEventListener?.('change', notify);
      return () => mq.removeEventListener?.('change', notify);
    },
    () => (typeof window !== 'undefined' && typeof window.matchMedia === 'function' ? window.matchMedia(query).matches : false),
    () => false,
  );
}

/** Landscape at 1024px and up, and every desktop window shaped that way: the chat sits beside the page. */
export const SPLIT_QUERY = '(min-width: 1024px) and (orientation: landscape)';
/** A finger is the main pointer: Enter makes a new line and the Send button sends. */
export const COARSE_QUERY = '(pointer: coarse)';

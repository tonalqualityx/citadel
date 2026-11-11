'use client';

import * as React from 'react';

/** How long the tab must have been hidden before "You were on this." shows. */
export const AWAY_MS = 20 * 60 * 1000;

/** Pure: was the tab hidden for at least `thresholdMs` between `hiddenAt` and `now`? */
export function isLongAway(hiddenAt: number | null, now: number, thresholdMs: number = AWAY_MS): boolean {
  if (hiddenAt === null || !Number.isFinite(hiddenAt)) return false;
  return now - hiddenAt >= thresholdMs;
}

/**
 * Watches the tab. While `active`, coming back after a long away turns `away` on until `dismiss()`.
 * Hiding the tab starts the clock; showing it checks the clock.
 */
export function useAwayReturn(active: boolean, thresholdMs: number = AWAY_MS): { away: boolean; dismiss: () => void } {
  const [away, setAway] = React.useState(false);
  const hiddenAt = React.useRef<number | null>(null);

  React.useEffect(() => {
    if (!active) {
      hiddenAt.current = null;
      setAway(false);
      return;
    }
    const onChange = () => {
      if (document.visibilityState === 'hidden') {
        hiddenAt.current = Date.now();
        return;
      }
      if (isLongAway(hiddenAt.current, Date.now(), thresholdMs)) setAway(true);
      hiddenAt.current = null;
    };
    document.addEventListener('visibilitychange', onChange);
    return () => document.removeEventListener('visibilitychange', onChange);
  }, [active, thresholdMs]);

  const dismiss = React.useCallback(() => setAway(false), []);
  return { away, dismiss };
}

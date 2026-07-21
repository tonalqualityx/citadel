'use client';

import * as React from 'react';

// Matches Tailwind's `sm` breakpoint (640px) — below it counts as "mobile" for the
// Oracle's hard mobile rule (single column, queues collapse to counts, week strip under
// the header). SSR-safe: defaults to false until the effect runs client-side, same
// mounted-gate discipline as useTerminology.
const MOBILE_BREAKPOINT_QUERY = '(max-width: 639px)';

export function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = React.useState(false);

  React.useEffect(() => {
    const mql = window.matchMedia(MOBILE_BREAKPOINT_QUERY);
    setIsMobile(mql.matches);
    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mql.addEventListener('change', handler);
    return () => mql.removeEventListener('change', handler);
  }, []);

  return isMobile;
}

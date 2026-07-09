'use client';

import * as React from 'react';

// Lightweight ticking clock for client-computed elapsed timers (Oracle fleet cards,
// live clock in the topbar). Never triggers a refetch — timestamps come from the
// polled fleet data and elapsed/wait durations are derived locally against this tick.
export function useNow(intervalMs = 1000): number {
  const [now, setNow] = React.useState(() => Date.now());

  React.useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);

  return now;
}

'use client';

import { useEffect, useState } from 'react';

/** True only when the app runs as an installed Home Screen app. False on the server and in a normal browser tab. */
export function useStandalone(): boolean {
  const [standalone, setStandalone] = useState(false);
  useEffect(() => {
    const mq = typeof window.matchMedia === 'function' ? window.matchMedia('(display-mode: standalone)') : null;
    const read = () => setStandalone(Boolean(mq?.matches) || (navigator as Navigator & { standalone?: boolean }).standalone === true);
    read();
    mq?.addEventListener?.('change', read);
    return () => mq?.removeEventListener?.('change', read);
  }, []);
  return standalone;
}

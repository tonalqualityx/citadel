'use client';

import * as React from 'react';
import { useStandalone } from '@/lib/hooks/use-standalone';

/** Installed Home Screen app has no browser reload button, so the home screen carries one. Never shown in a normal tab. */
export function HomeRefreshButton({ onRefresh }: { onRefresh: () => Promise<unknown> | void }) {
  const standalone = useStandalone();
  const [busy, setBusy] = React.useState(false);
  if (!standalone) return null;
  return (
    <button
      type="button"
      className="home-btn"
      data-home-refresh
      aria-busy={busy}
      disabled={busy}
      onClick={() => {
        setBusy(true);
        Promise.resolve(onRefresh())
          .catch(() => undefined)
          .finally(() => setBusy(false));
      }}
    >
      {busy ? 'Refreshing' : 'Refresh'}
    </button>
  );
}

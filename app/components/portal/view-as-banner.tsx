'use client';

import { useState } from 'react';
import { VIEW_AS_EXIT_LABEL, viewAsBannerText } from '@/lib/portal/view-as-copy';
import type { ViewAsState } from './view-as-context';

/** Ends the view on the server, then goes back to the client's record in Citadel. */
export async function exitViewAs(): Promise<void> {
  let returnTo = '/dashboard';
  try {
    const res = await fetch('/api/portal-view-as/exit', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    if (res.ok) returnTo = ((await res.json()) as { return_to?: string }).return_to ?? returnTo;
  } catch {
    // The session ends on its own in at most 30 minutes; still leave the page.
  }
  window.location.assign(returnTo);
}

/**
 * The fixed top banner on every portal page while an admin is looking at the portal as a client.
 * Exit view ends the view session on the server and goes back to the client's record in Citadel.
 */
export function ViewAsBanner({ viewAs }: { viewAs: ViewAsState }) {
  const [leaving, setLeaving] = useState(false);

  async function exit() {
    setLeaving(true);
    await exitViewAs();
  }

  return (
    <div className="va-banner" role="region" aria-label="Read-only view" data-view-as-banner>
      <span className="va-text">{viewAsBannerText(viewAs.clientName, viewAs.role)}</span>
      <button type="button" className="va-exit" onClick={exit} disabled={leaving}>
        {VIEW_AS_EXIT_LABEL}
      </button>
    </div>
  );
}

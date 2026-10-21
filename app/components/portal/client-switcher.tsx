'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

export interface PortalSession {
  loaded: boolean;
  /** True once the session check has answered either way (200, 401 or a network error). */
  settled: boolean;
  /** The active client's name, or '' when signed out or not loaded. */
  name: string;
  canSwitch: boolean;
  moved: boolean;
  /** Set while an admin is viewing this client's portal read-only. */
  viewAs: { clientName: string; role: string } | null;
}

const MOVED_COOKIE = 'portal_client_moved';

function readAndClearMovedFlag(): boolean {
  try {
    if (!document.cookie.split('; ').some((c) => c.startsWith(`${MOVED_COOKIE}=`))) return false;
    document.cookie = `${MOVED_COOKIE}=; Max-Age=0; path=/`;
    return true;
  } catch {
    return false;
  }
}

/**
 * Who is signed in and which client is active (A4). `canSwitch` is true when the person can reach
 * two or more clients. When the server had to move the session off a revoked client, `moved` is
 * true so the shell can say so in one line. Fails quietly: no name is better than a broken page.
 */
export function usePortalSession(enabled: boolean, pathname: string): PortalSession {
  const [state, setState] = useState<PortalSession>({ loaded: false, settled: false, name: '', canSwitch: false, moved: false, viewAs: null });
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/portal/clients');
        if (!res.ok) {
          if (!cancelled) setState((prev) => ({ ...prev, settled: true }));
          return;
        }
        const body: {
          active_client_id: string;
          moved?: boolean;
          clients: Array<{ id: string; name: string }>;
          view_as?: { client_name: string; role: string };
        } = await res.json();
        if (cancelled) return;
        const name = body.clients.find((c) => c.id === body.active_client_id)?.name ?? '';
        setState((prev) => ({ loaded: true, settled: true, name, canSwitch: body.clients.length >= 2, moved: prev.moved || readAndClearMovedFlag() || !!body.moved, viewAs: body.view_as ? { clientName: body.view_as.client_name, role: body.view_as.role } : null }));
      } catch {
        if (!cancelled) setState((prev) => ({ ...prev, settled: true }));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [enabled, pathname]);
  return state;
}

/** The account block at the top of the sidebar: client name and a way to switch. */
export function AccountBlock({ name, canSwitch }: { name: string; canSwitch: boolean }) {
  if (!name) return null;
  return (
    <div className="acct">
      <b>{name}</b>
      {canSwitch ? <Link href="/portal/select">Switch account</Link> : null}
    </div>
  );
}

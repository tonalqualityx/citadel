'use client';

import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';

interface SwitcherClient {
  id: string;
  name: string;
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
 * Header client control (A4). Always names the active client; becomes a select when the signed-in
 * person can reach two or more. Renders nothing on the sign-in pages or when signed out. Switching
 * posts to /api/portal/session/client (re-checked server-side) and reloads, so no page keeps the
 * previous client's data. When the server had to move the session off a revoked client, a one-line
 * notice says so.
 */
export function ClientSwitcher() {
  const pathname = usePathname();
  const [clients, setClients] = useState<SwitcherClient[]>([]);
  const [active, setActive] = useState<string>('');
  const [busy, setBusy] = useState(false);
  const [moved, setMoved] = useState(false);

  const onLoginPage = pathname?.startsWith('/portal/login') ?? false;

  useEffect(() => {
    if (onLoginPage) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/portal/clients');
        if (!res.ok) return;
        const body: { active_client_id: string; moved?: boolean; clients: SwitcherClient[] } = await res.json();
        if (cancelled) return;
        setClients(body.clients);
        setActive(body.active_client_id);
        if (readAndClearMovedFlag() || body.moved) setMoved(true);
      } catch {
        // No switcher is better than a broken header.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [onLoginPage, pathname]);

  if (onLoginPage || clients.length === 0) return null;

  const activeName = clients.find((c) => c.id === active)?.name ?? '';

  async function onChange(clientId: string) {
    if (!clientId || clientId === active) return;
    setBusy(true);
    try {
      const res = await fetch('/api/portal/session/client', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ client_id: clientId }),
      });
      if (res.ok) {
        window.location.assign('/portal');
        return;
      }
    } catch {
      // fall through: restore the select to the real active client
    }
    setBusy(false);
  }

  return (
    <div className="flex flex-col items-end gap-1">
      {clients.length >= 2 ? (
        <label className="flex items-center gap-2 text-sm text-text-sub">
          <span>Viewing</span>
          <select
            aria-label="Switch client"
            value={active}
            disabled={busy}
            onChange={(e) => onChange(e.target.value)}
            className="rounded-md border border-border bg-surface px-2 py-1 text-sm text-text-main"
          >
            {clients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
      ) : (
        <span className="text-sm text-text-sub">{activeName}</span>
      )}
      {moved && (
        <p role="status" className="text-xs text-text-tertiary">
          You no longer have access to the account you were viewing, so we opened {activeName}.
        </p>
      )}
    </div>
  );
}

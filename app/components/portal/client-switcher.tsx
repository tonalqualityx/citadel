'use client';

import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';

interface SwitcherClient {
  id: string;
  name: string;
}

/**
 * Header switcher (A4). Shows a select only when the signed-in person can reach two or more
 * clients; renders nothing on the sign-in pages, when signed out, or with a single client.
 * Switching posts to /api/portal/session/client (re-checked server-side) and reloads, so no page
 * keeps the previous client's data.
 */
export function ClientSwitcher() {
  const pathname = usePathname();
  const [clients, setClients] = useState<SwitcherClient[]>([]);
  const [active, setActive] = useState<string>('');
  const [busy, setBusy] = useState(false);

  const onLoginPage = pathname?.startsWith('/portal/login') ?? false;

  useEffect(() => {
    if (onLoginPage) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/portal/clients');
        if (!res.ok) return;
        const body: { active_client_id: string; clients: SwitcherClient[] } = await res.json();
        if (cancelled) return;
        setClients(body.clients);
        setActive(body.active_client_id);
      } catch {
        // No switcher is better than a broken header.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [onLoginPage, pathname]);

  if (onLoginPage || clients.length < 2) return null;

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
  );
}

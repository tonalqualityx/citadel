'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

interface PickerClient {
  id: string;
  name: string;
  role: string;
  project_only: boolean;
}

// Client picker (A4). The sign-in redirect lands here when the person can reach two or more
// clients. One client, or none, skips straight on.
export default function PortalSelectClientPage() {
  const router = useRouter();
  const [clients, setClients] = useState<PickerClient[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/portal/clients');
        if (res.status === 401) {
          router.replace('/portal/login');
          return;
        }
        if (!res.ok) {
          setError('We could not load your accounts. Please try again in a minute.');
          return;
        }
        const body: { clients: PickerClient[] } = await res.json();
        if (body.clients.length < 2) {
          router.replace('/portal/home');
          return;
        }
        setClients(body.clients);
      } catch {
        setError('We could not reach the server. Please check your connection and try again.');
      }
    })();
  }, [router]);

  async function choose(clientId: string) {
    setBusyId(clientId);
    setError(null);
    try {
      const res = await fetch('/api/portal/session/client', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ client_id: clientId }),
      });
      if (res.ok) {
        window.location.assign('/portal/home');
        return;
      }
      setError(
        res.status === 403
          ? 'You no longer have access to that account.'
          : 'Something went wrong on our end. Please try again in a minute.'
      );
    } catch {
      setError('We could not reach the server. Please check your connection and try again.');
    }
    setBusyId(null);
  }

  return (
    <div className="max-w-md mx-auto bg-surface border border-border rounded-lg p-6">
      <h2 className="text-xl font-semibold text-text-main mb-2">Choose an account</h2>
      <p className="text-sm text-text-sub mb-4">
        You have access to more than one account. Pick the one to open. You can switch at any time
        from the header.
      </p>
      {error && (
        <p role="alert" className="mb-4 text-sm text-red-600">
          {error}
        </p>
      )}
      {clients === null && !error && <p className="text-sm text-text-sub">Loading...</p>}
      {clients && (
        <ul className="space-y-2">
          {clients.map((c) => (
            <li key={c.id}>
              <button
                type="button"
                onClick={() => choose(c.id)}
                disabled={busyId !== null}
                className="w-full rounded-md border border-border bg-surface px-4 py-3 text-left text-sm font-medium text-text-main hover:bg-surface-secondary disabled:opacity-50"
              >
                {c.name}
                {c.project_only && <span className="ml-2 text-xs text-text-tertiary">Shared projects</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

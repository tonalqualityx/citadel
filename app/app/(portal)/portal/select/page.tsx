'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Building2, FolderKanban, TriangleAlert } from 'lucide-react';
import { PageHeader } from '@/components/portal/ui/page-header';
import { Callout } from '@/components/portal/ui/callout';
import { Skeleton, SkeletonRegion } from '@/components/portal/ui/skeleton';

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

  const full = (clients ?? []).filter((c) => !c.project_only);
  const shared = (clients ?? []).filter((c) => c.project_only);

  function choiceCards(list: PickerClient[], Icon: typeof Building2) {
    return (
      <ul className="choices-list" style={{ display: 'grid', gap: 10, listStyle: 'none', padding: 0, margin: 0 }}>
        {list.map((c) => (
          <li key={c.id}>
            <button
              type="button"
              onClick={() => choose(c.id)}
              disabled={busyId !== null}
              className="cardlink"
              style={{ width: '100%', textAlign: 'left', font: 'inherit', cursor: 'pointer', minHeight: 44 }}
            >
              <Icon className="i" aria-hidden="true" focusable="false" />
              <b>{c.name}</b>
              <small>{c.project_only ? 'Shared projects' : c.role}</small>
            </button>
          </li>
        ))}
      </ul>
    );
  }

  return (
    <>
      <PageHeader
        motif="meadow"
        title="Choose an account"
        lede="You have access to more than one account. Pick the one to open. You can switch at any time."
      />
      {error && (
        <Callout tone="urgent" icon={TriangleAlert} title="We could not finish that">
          <p role="alert">{error}</p>
        </Callout>
      )}
      {clients === null && !error && (
        <SkeletonRegion label="Loading your accounts">
          <div className="card">
            <Skeleton lines={2} block />
            <Skeleton lines={2} block />
          </div>
        </SkeletonRegion>
      )}
      {clients && full.length > 0 && (
        <section className="card" aria-labelledby="sel-accounts">
          <h2 id="sel-accounts">Your accounts</h2>
          {choiceCards(full, Building2)}
        </section>
      )}
      {clients && shared.length > 0 && (
        <section className="card" aria-labelledby="sel-shared">
          <h2 id="sel-shared">Shared projects</h2>
          {choiceCards(shared, FolderKanban)}
        </section>
      )}
    </>
  );
}

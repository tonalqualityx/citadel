'use client';

import { useState } from 'react';
import { Eye } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/select';
import { apiClient } from '@/lib/api/client';
import { useActivities } from '@/lib/hooks/use-activities';

const ROLE_OPTIONS = [
  { value: 'owner', label: 'Owner' },
  { value: 'member', label: 'Member' },
  { value: 'viewer', label: 'Viewer' },
];

/**
 * Admin only. Opens the client's portal as a contact with the chosen role: read-only, 30 minutes,
 * logged on this client's record. Your Citadel session is not touched.
 */
export function ViewAsPortalButton({ clientId, clientName }: { clientId: string; clientName: string }) {
  const [role, setRole] = useState('owner');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { data: recent } = useActivities({ entity_type: 'client', entity_id: clientId, action: 'view_as_started', limit: 5 });

  async function start() {
    setBusy(true);
    setError(null);
    try {
      const res = await apiClient.post<{ url: string }>(`/clients/${clientId}/view-as`, { role });
      window.location.assign(res.url);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not start the view.');
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex items-center gap-2">
        <Select aria-label="View as role" options={ROLE_OPTIONS} value={role} onChange={setRole} />
        <Button variant="secondary" size="sm" onClick={start} disabled={busy}>
          <Eye className="h-4 w-4 mr-2" />
          View portal as {clientName}
        </Button>
      </div>
      {error ? <p className="text-xs text-error" role="alert">{error}</p> : null}
      {recent && recent.activities.length > 0 ? (
        <ul className="text-xs text-text-sub text-right" aria-label="Recent portal views">
          {recent.activities.map((a) => {
            const role = (a.changes as { role?: { to?: string } } | null)?.role?.to ?? 'owner';
            return (
              <li key={a.id}>
                {a.user?.name ?? 'Someone'} as {role}, {new Date(a.created_at).toLocaleString()}
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}

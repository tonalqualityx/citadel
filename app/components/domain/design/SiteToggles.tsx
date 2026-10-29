'use client';

import * as React from 'react';
import { Switch } from '@/components/ui/switch';
import { Spinner } from '@/components/ui/spinner';
import { useAdminSites, useUpdateSiteToggle, type AdminSite, type SiteToggleField } from '@/lib/hooks/use-design-admin';

const COLUMNS: Array<{ field: SiteToggleField; label: string }> = [
  { field: 'design_portal_enabled', label: 'Design portal' },
  { field: 'designer_publish', label: 'Designer publish' },
  { field: 'design_auto_timer', label: 'Auto timer' },
];

export function SiteToggles({ canWrite }: { canWrite: boolean }) {
  const { data, isLoading, error } = useAdminSites();
  const toggle = useUpdateSiteToggle();

  if (isLoading) return <Spinner />;
  if (error || !data) return <p className="text-sm text-text-sub">The sites could not be loaded.</p>;
  if (data.sites.length === 0) return <p className="text-sm text-text-sub">No sites yet.</p>;

  return (
    <div className="overflow-x-auto rounded-lg border border-border-warm bg-surface">
      <table className="w-full min-w-[34rem] text-sm">
        <thead>
          <tr className="border-b border-border-warm text-left text-xs text-text-sub">
            <th scope="col" className="px-3 py-2 font-medium">Site</th>
            {COLUMNS.map((c) => <th key={c.field} scope="col" className="px-3 py-2 font-medium">{c.label}</th>)}
          </tr>
        </thead>
        <tbody>
          {data.sites.map((s: AdminSite) => (
            <tr key={s.id} className="border-b border-border-warm last:border-0">
              <th scope="row" className="px-3 py-2 text-left font-medium text-text-main">
                {s.name}
                <span className="block text-xs font-normal text-text-sub">{s.main_role === 'production' ? 'main is the live site' : 'main is the client preview'}</span>
              </th>
              {COLUMNS.map((c) => (
                <td key={c.field} className="px-3 py-2">
                  <Switch
                    checked={s[c.field]}
                    disabled={!canWrite || toggle.isPending}
                    id={`${c.field}-${s.id}`}
                    onCheckedChange={(value) => toggle.mutate({ siteId: s.id, field: c.field, value })}
                  />
                  <span className="sr-only">{`${c.label} for ${s.name}`}</span>
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

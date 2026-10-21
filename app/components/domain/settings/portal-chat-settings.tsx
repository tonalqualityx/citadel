'use client';

import * as React from 'react';
import { Loader2 } from 'lucide-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

interface ChatSettings {
  mode: 'off' | 'pilot' | 'on';
  daily_cap_usd: number;
  pilot_contact_ids: string[];
  sites: Array<{ id: string; name: string; url: string | null; client: string | null; portal_chat_enabled: boolean }>;
  contacts: Array<{ id: string; name: string | null; email: string | null; role: string; client: string }>;
}

const MODES: Array<{ value: ChatSettings['mode']; title: string; text: string }> = [
  { value: 'off', title: 'Off', text: 'Everyone sees the question steps.' },
  { value: 'pilot', title: 'Pilot', text: 'Only the pilot contacts below get the chat.' },
  { value: 'on', title: 'On', text: 'Every contact on a switched-on site gets the chat.' },
];

// Admin: the portal chat's mode, daily spend cap, pilot contacts and per-site switch. Each control
// saves on its own (PUT /api/portal-chat/settings, PATCH /api/sites/:id).
export function PortalChatSettings() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ['portal-chat-settings'], queryFn: () => apiClient.get<ChatSettings>('/portal-chat/settings'), retry: false });
  const [cap, setCap] = React.useState('');
  const [find, setFind] = React.useState('');
  const [siteFind, setSiteFind] = React.useState('');
  React.useEffect(() => {
    if (data) setCap(String(data.daily_cap_usd));
  }, [data]);

  const save = useMutation({
    mutationFn: (body: Partial<Pick<ChatSettings, 'mode' | 'daily_cap_usd' | 'pilot_contact_ids'>>) => apiClient.put('/portal-chat/settings', body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['portal-chat-settings'] }),
  });
  const toggleSite = useMutation({
    mutationFn: (v: { id: string; on: boolean }) => apiClient.patch(`/sites/${v.id}`, { portal_chat_enabled: v.on }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['portal-chat-settings'] }),
  });

  if (isLoading) return <Loader2 className="h-5 w-5 animate-spin text-primary" aria-label="Loading" />;
  if (!data) return <p className="text-sm text-text-sub">Only admins can change the portal chat.</p>;

  const pilot = new Set(data.pilot_contact_ids);
  const q = find.trim().toLowerCase();
  const contacts = data.contacts.filter((c) => pilot.has(c.id) || !q || `${c.name} ${c.email} ${c.client}`.toLowerCase().includes(q)).slice(0, 40);
  const sq = siteFind.trim().toLowerCase();
  const sites = data.sites.filter((s) => s.portal_chat_enabled || !sq || `${s.name} ${s.url} ${s.client}`.toLowerCase().includes(sq)).slice(0, 40);

  return (
    <div className="space-y-6" data-testid="portal-chat-settings">
      <fieldset>
        <legend className="text-sm font-medium text-text-main mb-2">Mode</legend>
        <div className="grid gap-2 sm:grid-cols-3">
          {MODES.map((m) => (
            <label key={m.value} className={`p-3 rounded-lg border-2 cursor-pointer ${data.mode === m.value ? 'border-primary bg-primary/5' : 'border-border-warm'}`}>
              <input type="radio" name="portal-chat-mode" className="sr-only" checked={data.mode === m.value} disabled={save.isPending} onChange={() => save.mutate({ mode: m.value })} />
              <span className="block font-medium text-text-main">{m.title}</span>
              <span className="block text-xs text-text-sub">{m.text}</span>
            </label>
          ))}
        </div>
      </fieldset>

      <div>
        <label htmlFor="portal-chat-cap" className="block text-sm font-medium text-text-main mb-1">Daily spend cap (USD, all clients)</label>
        <div className="flex gap-2 max-w-xs">
          <Input id="portal-chat-cap" type="number" min={0} max={1000} step="1" value={cap} onChange={(e) => setCap(e.target.value)} />
          <Button onClick={() => save.mutate({ daily_cap_usd: Number(cap) })} disabled={save.isPending || !Number.isFinite(Number(cap)) || Number(cap) === data.daily_cap_usd}>Save</Button>
        </div>
      </div>

      <div>
        <h3 className="text-sm font-medium text-text-main mb-1">Pilot contacts ({pilot.size})</h3>
        <Input aria-label="Find a contact" placeholder="Find a contact" value={find} onChange={(e) => setFind(e.target.value)} />
        <ul className="mt-2 max-h-56 overflow-y-auto space-y-1">
          {contacts.map((c) => (
            <li key={c.id}>
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <input
                  type="checkbox"
                  checked={pilot.has(c.id)}
                  disabled={save.isPending}
                  onChange={(e) => save.mutate({ pilot_contact_ids: e.target.checked ? [...pilot, c.id] : [...pilot].filter((x) => x !== c.id) })}
                />
                <span>{c.name || c.email} <span className="text-text-sub">({c.client}, {c.role})</span></span>
              </label>
            </li>
          ))}
        </ul>
      </div>

      <div>
        <h3 className="text-sm font-medium text-text-main mb-1">Sites with the chat switched on ({data.sites.filter((s) => s.portal_chat_enabled).length})</h3>
        <Input aria-label="Find a site" placeholder="Find a site" value={siteFind} onChange={(e) => setSiteFind(e.target.value)} />
        <ul className="mt-2 max-h-56 overflow-y-auto space-y-1">
          {sites.map((s) => (
            <li key={s.id}>
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <input type="checkbox" checked={s.portal_chat_enabled} disabled={toggleSite.isPending} onChange={(e) => toggleSite.mutate({ id: s.id, on: e.target.checked })} />
                <span>{s.name} <span className="text-text-sub">({s.client ?? 'no client'})</span></span>
              </label>
            </li>
          ))}
        </ul>
      </div>
      {(save.isError || toggleSite.isError) && <p role="alert" className="text-sm text-red-600">That did not save. Try again.</p>}
    </div>
  );
}

'use client';

import * as React from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { useUsers } from '@/lib/hooks/use-users';
import { useUpdateAdminSettings, type AdminSettings as Settings, type PublishMode } from '@/lib/hooks/use-design-admin';

export const PUBLISH_MODE_OPTIONS: Array<{ value: PublishMode; label: string }> = [
  { value: 'per_site', label: 'Per site: designers publish where the site switch is on' },
  { value: 'pre_launch_only', label: 'Pre-launch only: designers publish only to a client preview' },
  { value: 'off', label: 'Off: designers request a publish instead' },
];

const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'].map((v) => ({ value: v, label: v }));

/** The server refuses Fable too (400); this is the same check client-side. */
export function modelError(model: string): string | null {
  if (!model.trim()) return 'Enter a model.';
  if (/fable/i.test(model)) return 'The Fable model cannot be used for the designer worker.';
  return null;
}

type Draft = Record<string, string | boolean>;

const NUMBER_FIELDS = [
  ['confirmation_ttl_minutes', 'Confirmation window (minutes)', 1, 60, true],
  ['idle_close_minutes', 'Close idle sessions after (minutes)', 1, 240, true],
  ['max_live_sessions', 'Max live sessions', 1, 20, true],
  ['default_session_budget_usd', 'Default session budget (USD)', 0.01, 1000, false],
  ['designer_raise_cap_usd', 'Designer raise cap (USD)', 0.01, 1000, false],
  ['hard_session_cap_usd', 'Hard session cap (USD)', 0.01, 5000, false],
  ['default_monthly_cap_usd', 'Default monthly cap per designer (USD, blank for none)', 0.01, 100000, false],
  ['auto_timer_lapse_minutes', 'Timer lapse after (minutes without a visible poll)', 1, 60, true],
] as const;

function toDraft(s: Settings): Draft {
  return {
    enabled: s.enabled,
    owner_user_id: s.owner_user_id ?? '',
    designer_publish_mode: s.designer_publish_mode,
    model: s.model,
    effort: s.effort,
    auto_timer_enabled: s.auto_timer_enabled,
    auto_timer_billable: s.auto_timer_billable,
    ...Object.fromEntries(NUMBER_FIELDS.map(([k]) => [k, s[k] === null ? '' : String(s[k])])),
  };
}

/** Only what changed, typed as the PATCH expects. Returns an error string when a number is out of range. */
export function buildPatch(s: Settings, d: Draft): { patch: Partial<Settings>; error: string | null } {
  const patch: Record<string, unknown> = {};
  const before = toDraft(s);
  for (const key of Object.keys(d)) {
    if (d[key] === before[key]) continue;
    const num = NUMBER_FIELDS.find(([k]) => k === key);
    if (num) {
      const [, label, min, max, int] = num;
      if (d[key] === '' && key === 'default_monthly_cap_usd') {
        patch[key] = null;
        continue;
      }
      const n = Number(d[key]);
      if (!Number.isFinite(n) || n < min || n > max || (int && !Number.isInteger(n))) return { patch: {}, error: `${label}: enter ${int ? 'a whole number' : 'a number'} from ${min} to ${max}.` };
      patch[key] = n;
    } else if (key === 'owner_user_id') {
      patch[key] = d[key] === '' ? null : d[key];
    } else {
      patch[key] = d[key];
    }
  }
  return { patch: patch as Partial<Settings>, error: null };
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 py-1.5">
      <span className="text-sm text-text-main">{label}</span>
      {children}
    </div>
  );
}

export function AdminSettings({ settings, canWrite }: { settings: Settings; canWrite: boolean }) {
  const [draft, setDraft] = React.useState<Draft>(() => toDraft(settings));
  const [formError, setFormError] = React.useState<string | null>(null);
  const save = useUpdateAdminSettings();
  const users = useUsers();
  const set = (k: string, v: string | boolean) => setDraft((d) => ({ ...d, [k]: v }));

  // Follow the server after a save or a refetch.
  React.useEffect(() => setDraft(toDraft(settings)), [settings]);

  const mErr = modelError(String(draft.model));
  const ownerOptions = (users.data?.users ?? []).filter((u) => u.is_active && u.role === 'admin').map((u) => ({ value: u.id, label: u.name }));
  const dirty = JSON.stringify(draft) !== JSON.stringify(toDraft(settings));

  const submit = (ev: React.FormEvent) => {
    ev.preventDefault();
    if (mErr) return;
    const { patch, error } = buildPatch(settings, draft);
    setFormError(error);
    if (error || Object.keys(patch).length === 0) return;
    save.mutate(patch);
  };

  const ro = !canWrite;
  return (
    <form onSubmit={submit} className="space-y-4" aria-label="Designer portal settings">
      <fieldset disabled={ro} className="space-y-1">
        <Row label="Designer portal enabled (kill switch)">
          <Switch checked={draft.enabled as boolean} onCheckedChange={(v) => set('enabled', v)} disabled={ro} id="design-enabled" />
        </Row>
        <Select
          label="Owner (gets the FYI notices)"
          value={String(draft.owner_user_id)}
          onChange={(v) => set('owner_user_id', v)}
          options={ownerOptions}
          placeholder="No owner (admins get the notices)"
        />
        <Select
          label="Designer publish mode"
          value={String(draft.designer_publish_mode)}
          onChange={(v) => set('designer_publish_mode', v)}
          options={PUBLISH_MODE_OPTIONS}
          disabled={ro}
        />
        <Input label="Model" value={String(draft.model)} onChange={(e) => set('model', e.target.value)} error={mErr ?? undefined} readOnly={ro} />
        <Select label="Effort" value={String(draft.effort)} onChange={(v) => set('effort', v)} options={EFFORTS} disabled={ro} />
        <div className="grid gap-3 sm:grid-cols-2">
          {NUMBER_FIELDS.map(([k, label, min, max, int]) => (
            <Input
              key={k}
              label={label}
              type="number"
              inputMode={int ? 'numeric' : 'decimal'}
              min={min}
              max={max}
              step={int ? 1 : 'any'}
              value={String(draft[k])}
              onChange={(e) => set(k, e.target.value)}
              readOnly={ro}
            />
          ))}
        </div>
        <Row label="Automatic time tracking on design sessions">
          <Switch checked={draft.auto_timer_enabled as boolean} onCheckedChange={(v) => set('auto_timer_enabled', v)} disabled={ro} id="design-auto-timer" />
        </Row>
        <Row label="Automatic time entries are billable">
          <Switch checked={draft.auto_timer_billable as boolean} onCheckedChange={(v) => set('auto_timer_billable', v)} disabled={ro} id="design-auto-billable" />
        </Row>
      </fieldset>
      {formError && <p role="alert" className="text-sm text-error">{formError}</p>}
      {canWrite ? (
        <Button type="submit" disabled={!dirty || !!mErr || save.isPending}>{save.isPending ? 'Saving...' : 'Save settings'}</Button>
      ) : (
        <p className="text-xs text-text-sub">Only an admin can change these.</p>
      )}
    </form>
  );
}

'use client';

import * as React from 'react';
import { Button } from '@/components/ui/button';
import { useAddSite } from '@/lib/hooks/use-design-board';

/** Friendly check on the client; the server is the authority. Returns a sentence, or null when the address looks fine. */
export function checkSiteUrl(raw: string): string | null {
  const text = raw.trim();
  if (!text) return 'Paste the web address of a site.';
  let u: URL;
  try { u = new URL(text); } catch { return 'That does not look like a web address. Start it with https://'; }
  if (u.protocol !== 'https:') return 'The address has to start with https://';
  return null;
}

export function AddSite({ sessionId, onAdded }: { sessionId: string; onAdded: (message: string) => void }) {
  const add = useAddSite(sessionId);
  const [value, setValue] = React.useState('');
  const [error, setError] = React.useState('');
  const inputId = React.useId();
  const errId = React.useId();

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const problem = checkSiteUrl(value);
    if (problem) { setError(problem); return; }
    setError('');
    add.mutate(value.trim(), {
      onSuccess: ({ reference }) => { setValue(''); onAdded(`${reference.title} is on the board. Capturing it now.`); },
      onError: (err) => setError(err instanceof Error ? err.message : 'Could not add that site'),
    });
  };

  return (
    <form onSubmit={submit} noValidate className="flex flex-wrap items-end gap-2" aria-label="Add a site by web address">
      <div className="min-w-[14rem] flex-1">
        <label htmlFor={inputId} className="mb-1 block text-sm font-medium text-text-main">Add a site</label>
        <input
          id={inputId}
          type="text"
          inputMode="url"
          autoComplete="off"
          placeholder="https://example.com"
          value={value}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errId : undefined}
          onChange={(e) => { setValue(e.target.value); if (error) setError(''); }}
          className="block min-h-[44px] w-full rounded-lg border border-border-warm bg-surface px-3 py-2 text-sm text-text-main focus:outline-none focus:ring-2 focus:ring-primary/40 sm:min-h-10"
        />
      </div>
      <Button type="submit" className="min-h-[44px] sm:min-h-10" disabled={add.isPending}>{add.isPending ? 'Adding' : 'Add site'}</Button>
      {error && <p id={errId} role="alert" className="basis-full text-sm text-red-700">{error}</p>}
    </form>
  );
}

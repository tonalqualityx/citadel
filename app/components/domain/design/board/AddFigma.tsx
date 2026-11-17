'use client';

import * as React from 'react';
import { Button } from '@/components/ui/button';
import { useAddFigma } from '@/lib/hooks/use-design-board';

/** Friendly check on the client; the server is the authority. Returns a sentence, or null when the link looks like Figma. */
export function checkFigmaUrl(raw: string): string | null {
  const text = raw.trim();
  if (!text) return 'Paste a Figma link.';
  let u: URL;
  try { u = new URL(text); } catch { return 'That is not a Figma link. Sites go on the Inspiration tab.'; }
  if (u.protocol !== 'https:' || (u.hostname !== 'figma.com' && u.hostname !== 'www.figma.com')) return 'That is not a Figma link. Sites go on the Inspiration tab.';
  return null;
}

export function AddFigma({ sessionId, onAdded }: { sessionId: string; onAdded: (message: string) => void }) {
  const add = useAddFigma(sessionId);
  const [value, setValue] = React.useState('');
  const [error, setError] = React.useState('');
  const inputId = React.useId();
  const hintId = React.useId();
  const errId = React.useId();

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const problem = checkFigmaUrl(value);
    if (problem) { setError(problem); return; }
    setError('');
    add.mutate(value.trim(), {
      onSuccess: () => { setValue(''); onAdded('Your Figma design is on the board. Bringing in the frames now.'); },
      // The server's sentence (not_figma, bad_figma_link and the rest) is the error message.
      onError: (err) => setError(err instanceof Error ? err.message : 'Could not add that Figma link'),
    });
  };

  return (
    <form onSubmit={submit} noValidate className="flex flex-wrap items-end gap-2" aria-label="Add a Figma design by link">
      <div className="min-w-[14rem] flex-1">
        <label htmlFor={inputId} className="mb-1 block text-sm font-medium text-text-main">Add a Figma link</label>
        <input
          id={inputId}
          type="text"
          inputMode="url"
          autoComplete="off"
          placeholder="https://www.figma.com/design/..."
          value={value}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${hintId} ${errId}` : hintId}
          onChange={(e) => { setValue(e.target.value); if (error) setError(''); }}
          className="block min-h-[44px] w-full rounded-lg border border-border-warm bg-surface px-3 py-2 text-sm text-text-main focus:outline-none focus:ring-2 focus:ring-primary/40 sm:min-h-10"
        />
      </div>
      <Button type="submit" className="min-h-[44px] sm:min-h-10" disabled={add.isPending}>{add.isPending ? 'Adding' : 'Add from Figma'}</Button>
      <p id={hintId} className="basis-full text-xs text-text-sub">Paste a link to a frame, a page or a whole file. The file has to be shared with Indelible&apos;s Figma account.</p>
      {error && <p id={errId} role="alert" className="basis-full text-sm text-red-700">{error}</p>}
    </form>
  );
}

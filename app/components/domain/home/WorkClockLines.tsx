'use client';

import * as React from 'react';
import { useWorkClocks } from '@/lib/hooks/use-work-clocks';
import { useHomeReconcile } from '@/lib/hooks/use-home';
import { plain } from './home-screen-logic';

/**
 * Work stage F: the two clock lines on a project drawer or a task card. "Your time: about 2 h 10 m this month (Bast's estimate from 3 of
 * your sessions on 2 days). Log it?" and "Bast worked: 1 h 05 m, $3.40." Owner only (the route refuses every other caller). Log it offers
 * 15, 30, 60, 90, 120 minutes or a number with the estimate preselected; his tap makes one time entry, with Undo in the toast.
 * Nothing here is ever shown to a client.
 */
export function WorkClockLines({ targetKey }: { targetKey: string }) {
  const q = useWorkClocks(targetKey);
  const reconcile = useHomeReconcile();
  const [open, setOpen] = React.useState(false);
  const [choice, setChoice] = React.useState<number | null>(null);
  const [typed, setTyped] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const data = q.data;
  if (!data || (!data.mike && !data.bast)) return null;
  const mike = data.mike;
  const chosen = typed.trim() !== '' ? Number(typed) : (choice ?? mike?.suggested ?? null);
  const valid = chosen !== null && Number.isInteger(chosen) && chosen >= 1 && chosen <= 1440;
  const choices = mike ? [...new Set([...(mike.suggested ? [mike.suggested] : []), ...mike.choices])].sort((a, b) => a - b) : [];

  async function logIt() {
    if (!valid || busy) return;
    setBusy(true);
    try {
      const ok = await reconcile({ action: 'log_clock', target_key: targetKey, minutes: chosen as number });
      if (ok) {
        setOpen(false);
        setTyped('');
        setChoice(null);
        await q.refetch();
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <section data-testid="work-clock-lines" className="flex flex-col gap-1">
      {mike ? (
        <div>
          <p className="home-small" data-testid="work-clock-mike" title={mike.basis.join(' / ') || undefined}>
            {plain(mike.line)}{' '}
            {mike.unlogged_minutes > 0 && !open ? (
              <button type="button" className="home-linkbtn" data-testid="work-clock-log-open" onClick={() => setOpen(true)}>
                Log it
              </button>
            ) : null}
          </p>
          {open ? (
            <div className="home-small flex flex-wrap items-center gap-2" data-testid="work-clock-log">
              {choices.map((m) => (
                <button key={m} type="button" className="home-btn" aria-pressed={typed.trim() === '' && chosen === m} onClick={() => { setTyped(''); setChoice(m); }}>
                  {m} minutes
                </button>
              ))}
              <label>
                <span className="sr-only">Minutes</span>
                <input type="number" min={1} max={1440} inputMode="numeric" value={typed} placeholder="Minutes" onChange={(e) => setTyped(e.target.value)} className="home-input" style={{ width: '6rem' }} />
              </label>
              <button type="button" className="home-btn" data-testid="work-clock-log-go" disabled={!valid || busy} onClick={() => void logIt()}>
                Log it
              </button>
              <button type="button" className="home-linkbtn" onClick={() => setOpen(false)}>
                Not now
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
      {data.bast ? (
        <p className="home-small" data-testid="work-clock-bast">
          {plain(data.bast.line)}
        </p>
      ) : null}
    </section>
  );
}

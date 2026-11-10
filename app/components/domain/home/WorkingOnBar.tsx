'use client';

import * as React from 'react';
import type { WorkingOnBarProps } from '@/lib/home/types';
import { plain } from './home-screen-logic';

/** The pinned item with Done and Stop for now. The other lists shrink to one line. */
export function WorkingOnBar({ item, collapsedLine, onDone, onStop, busy = false }: WorkingOnBarProps) {
  const [asking, setAsking] = React.useState(false);
  const [note, setNote] = React.useState('');
  const noteId = React.useId();

  const stop = () => {
    onStop(note.trim());
    setAsking(false);
    setNote('');
  };

  return (
    <section className="home-pane home-working" aria-label="Working on">
      <h3>Working on</h3>
      <h2>{plain(item.title)}</h2>
      <div className="home-meta">
        {item.who ? <span>{plain(item.who)}</span> : null}
        {item.age ? <span>{plain(item.age)}</span> : null}
        {item.hard_date ? <span className="home-pill">{plain(item.hard_date)}</span> : null}
      </div>
      {asking ? (
        <div className="home-blk">
          <label htmlFor={noteId}>
            <strong>Where did you leave it?</strong>
          </label>
          <textarea id={noteId} value={note} onChange={(e) => setNote(e.target.value)} />
          <div className="home-actions">
            <button type="button" className="home-btn" data-filled="true" disabled={busy} onClick={stop}>
              Stop for now
            </button>
            <button type="button" className="home-btn" onClick={() => setAsking(false)}>
              Keep going
            </button>
          </div>
        </div>
      ) : (
        <div className="home-actions">
          <button type="button" className="home-btn" data-filled="true" disabled={busy} onClick={onDone}>
            Done
          </button>
          <button type="button" className="home-btn" disabled={busy} onClick={() => setAsking(true)}>
            Stop for now
          </button>
        </div>
      )}
      {collapsedLine ? <p className="home-muted home-small">{plain(collapsedLine)}</p> : null}
    </section>
  );
}

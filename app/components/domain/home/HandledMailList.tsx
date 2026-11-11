'use client';

import * as React from 'react';
import { plain } from './home-screen-logic';

export interface HandledMailRowView {
  /** `ask:<id>`: what Undo (the home act reopen_ask) takes. */
  key: string;
  title: string;
  reason: string;
  href: string | null;
  at: string;
}

const ZONE = 'America/New_York';
const day = (iso: string): string => new Intl.DateTimeFormat('en-US', { timeZone: ZONE, month: 'short', day: 'numeric' }).format(new Date(iso));

/** Work stage B: Mail recorded as handled, the last 30 days. Each row has Bast's reason, a link to the email and its own Undo. */
export function HandledMailList({ rows, onReopen }: { rows: HandledMailRowView[]; onReopen: (askKey: string) => void }) {
  return (
    <ul aria-label="Mail recorded as handled" style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', maxHeight: '60vh', overflowY: 'auto' }}>
      {rows.map((r) => (
        <li key={r.key} style={{ display: 'flex', gap: 12, alignItems: 'center', justifyContent: 'space-between', borderTop: '1px solid var(--border)', padding: '10px 0' }}>
          <div style={{ minWidth: 0 }}>
            <strong>{plain(r.title)}</strong>
            <div className="home-muted">{`${day(r.at)}. ${plain(r.reason)}`}</div>
            {r.href ? (
              <a href={r.href} target="_blank" rel="noopener noreferrer">
                Open the email
              </a>
            ) : null}
          </div>
          <button type="button" className="home-btn" onClick={() => onReopen(r.key)}>
            Undo
          </button>
        </li>
      ))}
    </ul>
  );
}

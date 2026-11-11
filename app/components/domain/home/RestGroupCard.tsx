'use client';

import * as React from 'react';
import type { HomeEverythingElseGroup, HomeRestItem } from '@/lib/home/types';
import { plain } from './home-screen-logic';

export interface RestGroupCardProps {
  /** The heading lines from restHeadingLines (count and day line, past-day line, scope line). */
  headingLines: string[];
  group: HomeEverythingElseGroup | null;
  emptyText: string;
  /** Item key being moved right now, or null. */
  busyKey?: string | null;
  onBringForward: (itemKey: string) => void;
}

/** Everything else, one group opened: every item with who holds it and when it comes back. */
export function RestGroupCard({ headingLines, group, emptyText, busyKey = null, onBringForward }: RestGroupCardProps) {
  return (
    <div className="home-card" style={{ maxHeight: '70vh', overflowY: 'auto' }}>
      <div>
        {headingLines.map((l, i) => (
          <p key={i} className={i === 0 ? undefined : 'home-muted'}>
            {plain(l)}
          </p>
        ))}
      </div>
      {group ? (
        <>
          <h2>{plain(group.label)}</h2>
          <p className="home-muted">{`Held by: ${plain(group.owner)}`}</p>
          <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column' }}>
            {group.items.map((it, i) => (
              <RestRow key={it.key ?? `${group.key}-${i}`} item={it} busy={it.key !== null && busyKey === it.key} onBringForward={onBringForward} />
            ))}
          </ul>
        </>
      ) : (
        <p className="home-muted">{plain(emptyText)}</p>
      )}
    </div>
  );
}

function RestRow({ item, busy, onBringForward }: { item: HomeRestItem; busy: boolean; onBringForward: (key: string) => void }) {
  return (
    <li style={{ display: 'flex', gap: 12, alignItems: 'center', justifyContent: 'space-between', borderTop: '1px solid var(--border)', padding: '10px 0' }}>
      <div style={{ minWidth: 0 }}>
        <strong>{plain(item.title)}</strong>
        <div className="home-muted">{plain(item.owner)}</div>
        <div className="home-muted">{plain(item.check_text)}</div>
      </div>
      {item.can_bring_forward && item.key ? (
        <button type="button" className="home-btn" disabled={busy} onClick={() => onBringForward(item.key as string)}>
          Bring it forward
        </button>
      ) : null}
    </li>
  );
}

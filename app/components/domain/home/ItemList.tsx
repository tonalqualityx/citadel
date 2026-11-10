'use client';

import * as React from 'react';
import type { ListRow } from './home-screen-logic';

export interface ItemListProps {
  rows: ListRow[];
  selectedKey: string | null;
  onSelect: (key: string) => void;
  emptyText: string;
}

/** One short list: a bold statement, a muted second line. Nothing here reorders. */
export function ItemList({ rows, selectedKey, onSelect, emptyText }: ItemListProps) {
  if (rows.length === 0) return <p className="home-empty">{emptyText}</p>;
  return (
    <div className="home-list">
      {rows.map((row) => (
        <button
          key={row.key}
          type="button"
          className="home-row"
          data-rule={row.rule ? 'now' : undefined}
          aria-current={row.key === selectedKey ? 'true' : 'false'}
          onClick={() => onSelect(row.key)}
        >
          <strong>{row.title}</strong>
          {row.meta ? <span className="home-row-meta">{row.meta}</span> : null}
        </button>
      ))}
    </div>
  );
}

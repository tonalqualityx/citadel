'use client';

import * as React from 'react';
import Link from 'next/link';
import type { HomeFirstList, HomeFirstRow, HomeTileId } from '@/lib/home/types';
import type { OpenCardInput } from '@/components/domain/bast-chat/card-context';
import { FIRST_LIST_EMPTY } from '@/lib/home/first-list-copy';
import { cardTalk } from './triage-talk';
import { plain } from './home-screen-logic';

export interface FirstListProps {
  list: HomeFirstList | undefined;
  /** A Triage row: the card's own chat opens (the same path as Talk about this on the Triage board). */
  onTalk: (card: OpenCardInput) => void;
  /** A task row: open the task peek and tell the chat it is the card he is on. */
  onOpenTask: (row: { task_id: string; key: string; title: string; item_type: string }) => void;
  /** Any other item: open Everything else on its tile with the row picked. */
  onOpenItem: (key: string, tile: HomeTileId) => void;
  /** The one Everything else button under the list (aria-expanded); it also says how many more qualified. */
  allOpen: boolean;
  onToggleAll: () => void;
}

function Figure({ row }: { row: HomeFirstRow }) {
  const text = row.amount ?? row.date ?? row.age;
  return text ? <span className="home-first-figure">{plain(text)}</span> : null;
}

function Body({ row }: { row: HomeFirstRow }) {
  return (
    <>
      <span className="home-first-tier">{row.tier_label}</span>
      <span className="home-first-title">{plain(row.title)}</span>
      <Figure row={row} />
      <span className="home-first-line">{plain(row.line)}</span>
    </>
  );
}

/** The one short list the screen opens on: only what needs him, in order, with one button for the rest. */
export function FirstList({ list, onTalk, onOpenTask, onOpenItem, allOpen, onToggleAll }: FirstListProps) {
  const rows = list?.rows ?? [];
  const more = list?.more ?? 0;
  return (
    <section className="home-first" aria-label="What needs you" data-testid="first-list">
      {rows.length === 0 ? (
        <p className="home-first-empty">{FIRST_LIST_EMPTY}</p>
      ) : (
        <ul className="home-first-list">
          {rows.map((row) => {
            const open = row.open;
            return (
              <li key={row.key}>
                {open.kind === 'link' ? (
                  <Link className="home-first-row" href={open.href} data-tier={row.tier}>
                    <Body row={row} />
                  </Link>
                ) : (
                  <button
                    type="button"
                    className="home-first-row"
                    data-tier={row.tier}
                    onClick={() => {
                      if (open.kind === 'triage') onTalk(cardTalk({ task_id: open.task_id, title: open.title }));
                      else if (open.kind === 'task') onOpenTask({ task_id: open.task_id, key: open.key, title: open.title, item_type: open.item_type });
                      else onOpenItem(open.key, open.tile);
                    }}
                  >
                    <Body row={row} />
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
      <button type="button" className="home-btn home-first-all" aria-expanded={allOpen} onClick={onToggleAll}>
        Everything else
        {more > 0 ? <span className="home-first-more">{`, and ${more} more`}</span> : null}
      </button>
    </section>
  );
}

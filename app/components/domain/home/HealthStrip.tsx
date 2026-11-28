'use client';

import * as React from 'react';
import Link from 'next/link';
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle, DrawerBody, DrawerCloseButton } from '@/components/ui/drawer';
import type { HealthTile, HomeHealth } from '@/lib/home/health/types';
import { plain } from './home-screen-logic';

/** The state as a shape plus a word, never colour alone (web accessibility guidelines 1.4.1). */
const MARK: Record<HealthTile['state'], string> = { normal: '✓', look: '◆', building: '○', unknown: '?' };

function Tile({ tile, onOpen }: { tile: HealthTile; onOpen: (id: HealthTile['id']) => void }) {
  return (
    <li>
      <button
        type="button"
        className="home-health-tile"
        data-state={tile.state}
        data-testid={`health-tile-${tile.id}`}
        onClick={() => onOpen(tile.id)}
        aria-label={`${tile.label}: ${tile.figure}, ${tile.line}. ${tile.state_label}. ${tile.usual}. ${tile.fresh}. Open the detail.`}
      >
        <span className="home-health-label">{plain(tile.label)}</span>
        <span className="home-health-figure">{plain(tile.figure)}</span>
        <span className="home-health-line">{plain(tile.line)}</span>
        <span className="home-health-state">
          <span aria-hidden="true">{MARK[tile.state]}</span> {plain(tile.state_label)}
        </span>
        {tile.usual ? <span className="home-health-usual">{plain(tile.usual)}</span> : null}
        {tile.fresh ? <span className="home-health-fresh">{plain(tile.fresh)}</span> : null}
      </button>
    </li>
  );
}

/**
 * The six health tiles in one row above the first list (task 183ec7a8, option A). One number and one line per tile, its state as a
 * shape and a word, its usual, and how fresh it is. Tapping a tile opens its detail in the side panel. Nothing here refreshes on its own.
 */
export function HealthStrip({ health }: { health: HomeHealth | undefined }) {
  const [openId, setOpenId] = React.useState<HealthTile['id'] | null>(null);
  if (!health || health.tiles.length === 0) return null;
  const open = health.tiles.find((t) => t.id === openId) ?? null;
  return (
    <section className="home-health" aria-label="How things stand" data-testid="health-strip">
      <p className="home-health-summary">{plain(health.summary)}</p>
      <ul className="home-health-row">
        {health.tiles.map((t) => (
          <Tile key={t.id} tile={t} onOpen={setOpenId} />
        ))}
      </ul>
      <Drawer open={open !== null} onOpenChange={(o) => { if (!o) setOpenId(null); }}>
        <DrawerContent side="right" size="md">
          <DrawerHeader>
            <DrawerTitle>{open ? plain(open.label) : ''}</DrawerTitle>
            <DrawerCloseButton />
          </DrawerHeader>
          <DrawerBody>
            {open ? (
              <div data-home className="home-health-detail" data-testid="health-detail">
                <p className="home-health-detail-figure">
                  {plain(open.figure)} <span className="home-muted">{plain(open.line)}</span>
                </p>
                <p>
                  <span aria-hidden="true">{MARK[open.state]}</span> {plain(open.state_label)}
                  {open.usual ? `. ${plain(open.usual)}` : ''}
                  {open.fresh ? `. ${plain(open.fresh)}.` : ''}
                </p>
                {open.detail.length > 0 ? (
                  <ul className="home-health-detail-list">
                    {open.detail.map((d, i) => (
                      <li key={i}>{plain(d)}</li>
                    ))}
                  </ul>
                ) : (
                  <p className="home-muted">Nothing more to show.</p>
                )}
                {open.href && open.href_label ? (
                  <Link className="home-btn" href={open.href}>
                    {open.href_label}
                  </Link>
                ) : null}
              </div>
            ) : null}
          </DrawerBody>
        </DrawerContent>
      </Drawer>
    </section>
  );
}

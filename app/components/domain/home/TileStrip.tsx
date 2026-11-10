'use client';

import * as React from 'react';
import type { TileStripProps } from '@/lib/home/types';

/** The strip of tiles. Real buttons with aria-pressed; counts are quiet background. */
export function TileStrip({ tiles, selected, onSelect }: TileStripProps) {
  return (
    <div className="home-strip" role="group" aria-label="What needs you">
      {tiles.map((tile) => {
        const isToday = tile.id === 'today';
        return (
          <button
            key={tile.id}
            type="button"
            className="home-tile"
            data-tile={tile.id}
            data-today={isToday ? 'true' : undefined}
            data-zero={!isToday && tile.count === 0 ? 'true' : undefined}
            data-hot={tile.hot ? 'true' : undefined}
            aria-pressed={tile.id === selected}
            onClick={() => onSelect(tile.id)}
          >
            <span className="home-tile-n">{tile.value}</span>
            {tile.label ? <span className="home-tile-l">{tile.label}</span> : null}
          </button>
        );
      })}
    </div>
  );
}

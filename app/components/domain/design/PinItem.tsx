'use client';

import * as React from 'react';
import { MoreHorizontal } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import type { TrayPin } from '@/lib/hooks/use-design-tray';

/** Blast radius from lib_index when the projection carries it: a number (pages) or {pages|count}. Null otherwise. */
export function blastRadiusLabel(value: unknown): string | null {
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) return `Used on ${value} ${value === 1 ? 'page' : 'pages'}`;
  if (value && typeof value === 'object') {
    const v = value as Record<string, unknown>;
    const n = typeof v.pages === 'number' ? v.pages : typeof v.count === 'number' ? v.count : null;
    if (n !== null && n >= 0) return `Used on ${n} ${n === 1 ? 'page' : 'pages'}`;
  }
  return null;
}

export interface PinItemProps {
  pin: TrayPin;
  /** Taken on an older preview than the session's current one. */
  stale?: boolean;
  busy?: boolean;
  onNote: (pin: TrayPin, note: string) => void;
  onDiscard: (pin: TrayPin) => void;
  onFollowup: (pin: TrayPin) => void;
  onHighlight?: (pin: TrayPin) => void;
}

export function pinTitle(pin: Pick<TrayPin, 'data_lib' | 'tag' | 'page_path'>): string {
  return `${pin.data_lib ?? pin.tag ?? 'Element'} on ${pin.page_path}`;
}

export function PinItem({ pin, stale, busy, onNote, onDiscard, onFollowup, onHighlight }: PinItemProps) {
  const [note, setNote] = React.useState(pin.note);
  const [menu, setMenu] = React.useState(false);
  React.useEffect(() => setNote(pin.note), [pin.note]);

  const isFollowup = pin.status === 'followup';
  const pending = pin.status === 'pending';
  const blast = blastRadiusLabel(pin.blast_radius);

  return (
    <li className="rounded-lg border border-border-warm bg-surface p-3" data-testid="pin-item" data-pin-id={pin.id}>
      <div className="flex items-start gap-2">
        <button
          type="button"
          className="min-w-0 flex-1 text-left text-sm font-medium text-text-main hover:underline"
          onClick={() => onHighlight?.(pin)}
        >
          <span className="block truncate">{pinTitle(pin)}</span>
        </button>
        {pending && (
          <div className="relative">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              aria-label="Pin actions"
              aria-haspopup="menu"
              aria-expanded={menu}
              onClick={() => setMenu((m) => !m)}
            >
              <MoreHorizontal className="h-4 w-4" />
            </Button>
            {menu && (
              <div role="menu" className="absolute right-0 z-10 mt-1 w-56 rounded-lg border border-border-warm bg-surface p-1 shadow-lg">
                <button
                  type="button"
                  role="menuitem"
                  className="block w-full rounded px-3 py-2 text-left text-sm text-text-main hover:bg-background-light"
                  disabled={busy}
                  onClick={() => {
                    setMenu(false);
                    onDiscard(pin);
                  }}
                >
                  Discard
                </button>
                <button
                  type="button"
                  role="menuitem"
                  className="block w-full rounded px-3 py-2 text-left text-sm text-text-main hover:bg-background-light"
                  disabled={busy}
                  onClick={() => {
                    setMenu(false);
                    onFollowup(pin);
                  }}
                >
                  Belongs to another task
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="mt-1 flex flex-wrap gap-1.5">
        {blast && <Badge variant="default">{blast}</Badge>}
        {stale && <Badge variant="warning">Older preview</Badge>}
        {isFollowup && <Badge variant="default">Follow-up task filed</Badge>}
        <Badge variant="default">{pin.viewport_width}px</Badge>
      </div>

      {pin.text_quote && <p className="mt-2 truncate text-xs text-text-sub">&ldquo;{pin.text_quote}&rdquo;</p>}

      {pending ? (
        <Textarea
          aria-label={`Note for ${pinTitle(pin)}`}
          className="mt-2 min-h-[56px]"
          placeholder="What should change here?"
          value={note}
          maxLength={4000}
          onChange={(e) => setNote(e.target.value)}
          onBlur={() => {
            if (note !== pin.note) onNote(pin, note);
          }}
        />
      ) : (
        pin.note && <p className="mt-2 whitespace-pre-wrap text-sm text-text-sub">{pin.note}</p>
      )}
    </li>
  );
}

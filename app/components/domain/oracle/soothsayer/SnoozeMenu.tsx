'use client';

import * as React from 'react';
import { Moon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils/cn';
import { useSnoozeArc } from '@/lib/hooks/use-arcs';
import { computeSnoozeUntil, isArcSnoozed, type SnoozeQuickOption } from '@/lib/arc-snooze';

interface SnoozeMenuProps {
  arcId: string;
  snoozedUntil: string | null;
  className?: string;
}

const QUICK_OPTIONS: { key: SnoozeQuickOption; label: string }[] = [
  { key: '1d', label: '1 day' },
  { key: '3d', label: '3 days' },
  { key: 'next_week', label: 'Next week' },
];

// Clarity Phase 5 — the small snooze menu every arc card gets: 1d / 3d / next week / pick
// date -> PATCH snoozed_until. A snoozed arc hides from the Soothsayer's "no day assigned"
// section (and Today's un-picked-arc surfacing) until the date passes. Already-snoozed arcs
// get an Unsnooze shortcut instead of the quick-option list.
export function SnoozeMenu({ arcId, snoozedUntil, className }: SnoozeMenuProps) {
  const [open, setOpen] = React.useState(false);
  const [pickingDate, setPickingDate] = React.useState(false);
  const snooze = useSnoozeArc();
  const currentlySnoozed = isArcSnoozed(snoozedUntil);

  function applyQuick(option: SnoozeQuickOption) {
    const until = computeSnoozeUntil(option);
    snooze.mutate({ id: arcId, snoozedUntil: until.toISOString() });
    setOpen(false);
  }

  function applyCustomDate(dateStr: string) {
    if (!dateStr) return;
    const until = computeSnoozeUntil({ customDate: `${dateStr}T00:00:00.000Z` });
    snooze.mutate({ id: arcId, snoozedUntil: until.toISOString() });
    setOpen(false);
    setPickingDate(false);
  }

  function unsnooze() {
    snooze.mutate({ id: arcId, snoozedUntil: null });
    setOpen(false);
  }

  return (
    <div className={cn('relative inline-block', className)} data-testid="snooze-menu">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label="Snooze"
        aria-expanded={open}
        data-testid="snooze-menu-trigger"
        className="flex h-6 w-6 items-center justify-center rounded-full text-text-sub hover:bg-background-light"
      >
        <Moon className="h-3.5 w-3.5" aria-hidden="true" />
      </button>

      {open && (
        <div
          className="absolute right-0 z-10 mt-1 flex w-40 flex-col gap-1 rounded-md border border-border-warm bg-surface p-1.5 shadow-md"
          data-testid="snooze-menu-panel"
        >
          {currentlySnoozed ? (
            <button
              type="button"
              onClick={unsnooze}
              className="rounded px-2 py-1 text-left text-xs text-text-main hover:bg-background-light"
              data-testid="snooze-unsnooze"
            >
              Unsnooze
            </button>
          ) : pickingDate ? (
            <input
              type="date"
              autoFocus
              className="rounded border border-border-warm bg-surface px-1.5 py-1 text-xs text-text-main"
              data-testid="snooze-date-input"
              onChange={(e) => applyCustomDate(e.target.value)}
            />
          ) : (
            <>
              {QUICK_OPTIONS.map((opt) => (
                <button
                  key={opt.key}
                  type="button"
                  onClick={() => applyQuick(opt.key)}
                  className="rounded px-2 py-1 text-left text-xs text-text-main hover:bg-background-light"
                  data-testid={`snooze-option-${opt.key}`}
                >
                  {opt.label}
                </button>
              ))}
              <button
                type="button"
                onClick={() => setPickingDate(true)}
                className="rounded px-2 py-1 text-left text-xs text-text-main hover:bg-background-light"
                data-testid="snooze-option-pick-date"
              >
                Pick date…
              </button>
            </>
          )}
          <Button variant="ghost" size="sm" onClick={() => setOpen(false)} className="mt-1">
            Close
          </Button>
        </div>
      )}
    </div>
  );
}

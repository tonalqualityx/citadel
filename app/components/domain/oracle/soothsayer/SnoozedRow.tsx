'use client';

import { CollapsibleGroup } from '../CollapsibleGroup';
import { SnoozeMenu } from './SnoozeMenu';
import type { SoothsayerArc } from '@/lib/hooks/use-soothsayer';

interface SnoozedRowProps {
  arcs: SoothsayerArc[];
  timezone: string;
}

function formatWakeDate(iso: string, timezone: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    timeZone: timezone,
  });
}

// Clarity Phase 5 — "Snoozed" collapsed row at the bottom: arcs with snoozed_until in the
// future, showing the wake date, with unsnooze + snooze-adjust actions (the SAME SnoozeMenu
// every arc card gets — "Unsnooze" replaces the quick-option list once an arc is already
// snoozed, see SnoozeMenu.tsx).
export function SnoozedRow({ arcs, timezone }: SnoozedRowProps) {
  return (
    <CollapsibleGroup title="Snoozed" count={arcs.length}>
      <div className="flex flex-col gap-2" data-testid="soothsayer-snoozed-list">
        {arcs.map((arc) => (
          <div
            key={arc.id}
            className="flex items-center justify-between gap-2 rounded-lg border border-border-warm bg-surface p-2.5"
            data-testid="snoozed-arc-row"
            data-arc-id={arc.id}
          >
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold text-text-main">{arc.name}</div>
              <div className="truncate text-xs text-text-sub">
                wakes {arc.snoozed_until ? formatWakeDate(arc.snoozed_until, timezone) : 'soon'}
              </div>
            </div>
            <SnoozeMenu arcId={arc.id} snoozedUntil={arc.snoozed_until} />
          </div>
        ))}
      </div>
    </CollapsibleGroup>
  );
}

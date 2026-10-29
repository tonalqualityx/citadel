'use client';

import type { DesignTimerView } from '@/lib/hooks/use-design';

/** "1h 12m" / "12m". Whole minutes; the pill never shows seconds. */
export function formatElapsed(elapsedS: number): string {
  const total = Math.max(0, Math.floor(elapsedS / 60));
  const h = Math.floor(total / 60);
  const m = total % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

/** The only time display in the workspace: elapsed time on the quest, from feed.timer. No billing data. */
export function TimerPill({ timer }: { timer: DesignTimerView | null | undefined }) {
  if (!timer || (!timer.running && timer.elapsed_s <= 0)) return null;
  return (
    <span
      className="inline-flex items-center rounded-full bg-surface-alt px-2.5 py-0.5 text-xs font-medium text-text-sub"
      data-testid="timer-pill"
    >
      On this quest: {formatElapsed(timer.elapsed_s)}
    </span>
  );
}

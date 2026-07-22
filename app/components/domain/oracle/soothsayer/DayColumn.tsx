'use client';

import { cn } from '@/lib/utils/cn';
import { TodayPickCard } from '../today/TodayPickCard';
import { dayColumnLabel, meetingLoadLine, isSoothsayerToday } from './soothsayer-logic';
import type { SoothsayerDay } from '@/lib/hooks/use-soothsayer';

interface DayColumnProps {
  day: SoothsayerDay;
  todayDateStr: string;
  legacyAttentionArcIds: Set<string>;
}

// Clarity Phase 5 — The Soothsayer's day column: today + next 6 days, each showing its
// picks as compact cards. Reuses TodayPickCard verbatim (arc name + progress, session
// title, task title, its existing type-adaptive primary action, the complete-toggle, and
// now the arc attention dot / snooze menu) rather than building a parallel card component —
// the shaped pick data is identical to /api/today's own shape (see
// lib/services/today-picks-shape.ts, the single shared shaping helper). Today's own column
// is visually anchored with an accent border, per the spec.
export function DayColumn({ day, todayDateStr, legacyAttentionArcIds }: DayColumnProps) {
  const isToday = isSoothsayerToday(day.date, todayDateStr);

  return (
    <div
      className={cn(
        'flex min-h-[12rem] flex-col gap-2 rounded-lg border p-2',
        isToday ? 'border-[color:var(--accent)] bg-background-light/40' : 'border-border-warm bg-surface'
      )}
      data-testid="soothsayer-day-column"
      data-date={day.date}
      data-is-today={isToday || undefined}
    >
      <div className="flex flex-col gap-0.5 px-1">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-text-main">
          {dayColumnLabel(day.date, todayDateStr)}
        </h3>
        <span className="text-[0.65rem] text-text-sub" data-testid="soothsayer-day-meeting-load">
          {meetingLoadLine(day.meeting_count, day.meeting_minutes)}
        </span>
      </div>

      <div className="flex flex-col gap-2">
        {day.picks.length === 0 ? (
          <p className="px-1 text-xs text-text-sub">Nothing picked</p>
        ) : (
          day.picks.map((pick) => (
            <TodayPickCard
              key={pick.id}
              pick={pick}
              hasAttentionDot={!!pick.arc_id && legacyAttentionArcIds.has(pick.arc_id)}
            />
          ))
        )}
      </div>
    </div>
  );
}

'use client';

import { cn } from '@/lib/utils/cn';
import type { TodayCalendarWeekDay } from '@/lib/hooks/use-today';
import { dayCapacityFillPercent, isDayOverCapacity } from './time-shape-logic';

interface WeekStripProps {
  week: TodayCalendarWeekDay[];
  todayDate: string;
}

function weekdayLabel(dateStr: string): string {
  const d = new Date(`${dateStr}T12:00:00.000Z`); // noon avoids DST/UTC edge rollovers
  return d.toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' });
}

// One capacity encoding, reused verbatim from the day track: blue-accent fill under the
// threshold, gold/warning fill at or past it — never red (evidence-bound rule: no red
// anywhere in the Oracle for aging/capacity/overdue signals).
export function WeekStrip({ week, todayDate }: WeekStripProps) {
  if (week.length === 0) return null;

  return (
    <div className="flex items-end gap-1" title="Week capacity — packed days carry the warning tint" data-testid="week-strip">
      {week.map((day) => {
        const fill = dayCapacityFillPercent(day.meeting_minutes, day.due_tasks_count);
        const packed = isDayOverCapacity(fill);
        const isToday = day.date === todayDate;
        return (
          <div key={day.date} className="flex w-7 flex-col items-center gap-1" data-testid="week-strip-day">
            <div
              className={cn(
                'relative h-7 w-full overflow-hidden rounded-t border bg-surface',
                isToday ? 'border-[color:var(--accent)]' : 'border-border-warm'
              )}
            >
              <div
                className="absolute inset-x-0 bottom-0 rounded-t-sm"
                style={{
                  height: `${Math.round(fill * 100)}%`,
                  backgroundColor: packed ? 'var(--warning-subtle)' : 'var(--accent-subtle)',
                  borderTop: `2px solid ${packed ? 'var(--warning)' : 'var(--accent)'}`,
                }}
                data-testid="week-strip-fill"
                data-packed={packed || undefined}
              />
            </div>
            <span className="text-[0.65rem] text-text-sub">{weekdayLabel(day.date)}</span>
          </div>
        );
      })}
    </div>
  );
}

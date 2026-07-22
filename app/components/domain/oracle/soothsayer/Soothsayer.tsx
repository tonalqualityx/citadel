'use client';

import { Spinner } from '@/components/ui/spinner';
import { useSoothsayer } from '@/lib/hooks/use-soothsayer';
import { useOracleFleet } from '@/lib/hooks/use-oracle';
import { useNow } from '@/lib/hooks/use-now';
import { legacyNeedsAttentionArcIds } from '../oracle-logic';
import { DayColumn } from './DayColumn';
import { UnplannedSection } from './UnplannedSection';
import { SnoozedRow } from './SnoozedRow';

// Clarity Phase 5 — The Soothsayer (🌙): the week-plan visualization. Day columns (today +
// next 6), the can-never-lose-an-arc "No day assigned" section, and the collapsed "Snoozed"
// row — all backed by the single consolidated GET /api/oracle/soothsayer read.
//
// Mobile hard rule (matching the rest of the Oracle): the day-column grid degrades to a
// single column via pure responsive classes (grid-cols-1 up through lg:grid-cols-7) — no
// JS-driven layout branch, so there's no hydration flash. "No day assigned" stays a full-
// width section below the columns on every breakpoint, per spec — it never competes for
// grid space with the day columns.
export function Soothsayer() {
  const { data, isLoading, isError } = useSoothsayer();
  const { data: fleetData } = useOracleFleet();
  const now = useNow(60_000);

  if (isLoading) {
    return (
      <div className="flex min-h-[25rem] items-center justify-center">
        <Spinner size="lg" />
      </div>
    );
  }

  if (isError || !data) {
    return <div className="py-12 text-center text-sm text-text-sub">Failed to load the week plan.</div>;
  }

  const legacyAttentionArcIds = fleetData ? legacyNeedsAttentionArcIds(fleetData.machines, now) : new Set<string>();
  const todayDateStr = data.days[0]?.date ?? '';
  const dayDates = data.days.map((d) => d.date);

  return (
    <div className="flex flex-col gap-4" data-testid="soothsayer-page">
      <header>
        <h1 className="text-lg font-bold text-text-main">🌙 The Soothsayer</h1>
        <p className="text-xs text-text-sub">The week plan · {data.timezone}</p>
      </header>

      <div
        className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-4 lg:grid-cols-7"
        data-testid="soothsayer-day-columns"
      >
        {data.days.map((day) => (
          <DayColumn
            key={day.date}
            day={day}
            todayDateStr={todayDateStr}
            legacyAttentionArcIds={legacyAttentionArcIds}
          />
        ))}
      </div>

      <UnplannedSection
        arcs={data.unplanned.arcs}
        sessions={data.unplanned.sessions}
        dayDates={dayDates}
        todayDateStr={todayDateStr}
      />

      <SnoozedRow arcs={data.snoozed.arcs} timezone={data.timezone} />
    </div>
  );
}

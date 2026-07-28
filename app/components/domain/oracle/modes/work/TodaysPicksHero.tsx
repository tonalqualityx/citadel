'use client';

import * as React from 'react';
import { TodayBoard } from '@/components/domain/oracle/today/TodayBoard';
import type { TodayPick } from '@/lib/hooks/use-today';
import type { OracleSessionWithMachine } from '@/lib/types/oracle';
import { HERO_MAX } from './hero-logic';

interface TodaysPicksHeroProps {
  picks: TodayPick[];
  sessions: OracleSessionWithMachine[];
  todayDateStr: string;
}

// Clarity Phase 8 (shakedown, 2026-07-28) — Mike's live shakedown flagged the old hero: a
// bespoke card-row/grid that dropped the board's drag-and-drop, doing/todo/done columns,
// and soft-cap tint entirely, then made him hunt for the SAME board again over in Plan
// mode. The hero region IS the board now — this component is a thin shell around
// TodayBoard (doing-first column order, Done collapsed by default — both already built
// into TodayBoard itself) plus the one thing the board doesn't already say out loud: the
// "N of 3 · sessions count toward the cap" note (DAY-REALITY #1 — a supervised-session pick
// is already inside this count, same as before). Reason chips, cover art, Focus, the todo
// column's Start button, and the Doing column's soft-cap tint all come for free from
// TodayBoard/TodayPickCard — nothing here re-renders them. No second render of picks
// anywhere in Work mode.
export function TodaysPicksHero({ picks, todayDateStr }: TodaysPicksHeroProps) {
  const uncompleted = picks.filter((p) => !p.completed_at);

  return (
    <section className="flex flex-col gap-3" data-testid="todays-picks-hero">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-lg font-semibold text-text-main">Today&apos;s picks</h2>
        <span className="text-xs text-text-sub">
          {uncompleted.length} of {HERO_MAX} · sessions count toward the cap
        </span>
      </div>

      {picks.length === 0 ? (
        <p className="py-2 text-sm text-text-sub" data-testid="todays-picks-hero-empty">
          Nothing picked yet — the ritual (or a door below) builds today&apos;s menu.
        </p>
      ) : (
        <TodayBoard picks={picks} todayDateStr={todayDateStr} />
      )}
    </section>
  );
}

'use client';

import * as React from 'react';
import Link from 'next/link';
import { ExternalLink } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tooltip } from '@/components/ui/tooltip';
import { CoverBand } from '@/components/domain/oracle/CoverBand';
import { ReasonChip } from '@/components/domain/oracle/ReasonChip';
import { reasonChipForPick } from '@/lib/reason-chips';
import { useTaskPeek } from '@/lib/contexts/task-peek-context';
import { useFocusMode } from '@/lib/contexts/focus-mode-context';
import type { TodayPick } from '@/lib/hooks/use-today';
import type { OracleSessionWithMachine } from '@/lib/types/oracle';
import { HERO_MAX, selectHeroPicks, heroSessionStatus } from './hero-logic';

interface TodaysPicksHeroProps {
  picks: TodayPick[];
  sessions: OracleSessionWithMachine[];
  todayDateStr: string;
}

function pickTitle(pick: TodayPick): string {
  if (pick.label) return pick.label;
  if (pick.arc) return pick.arc.name;
  if (pick.task) return pick.task.title;
  if (pick.session) return pick.session.title ?? pick.session.external_id;
  if (pick.charter) return pick.charter.name;
  return 'Untitled pick';
}

function pickDescription(pick: TodayPick): string | null {
  if (pick.session?.goal) return pick.session.goal;
  if (pick.arc) return `arc · ${pick.arc.task_count} task${pick.arc.task_count === 1 ? '' : 's'} · ${pick.arc.status}`;
  return null;
}

// Clarity Phase 8 (composition) — Work mode's hero: "Today's picks", up to 3 visible + an
// "N more" expander. DAY-REALITY #1: sessions count toward the cap (this hero reads
// straight off today's picks, so a supervised-session pick is already inside the count).
export function TodaysPicksHero({ picks, sessions, todayDateStr }: TodaysPicksHeroProps) {
  const [expanded, setExpanded] = React.useState(false);
  const { openTaskPeek } = useTaskPeek();
  const { enterFocus } = useFocusMode();

  const uncompleted = picks.filter((p) => !p.completed_at);
  const heroPicks = selectHeroPicks(picks);
  const overflow = uncompleted.length - heroPicks.length;
  const shown = expanded ? uncompleted : heroPicks;

  return (
    <section className="flex flex-col gap-3" data-testid="todays-picks-hero">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-lg font-semibold text-text-main">Today&apos;s picks</h2>
        <span className="text-xs text-text-sub">
          {uncompleted.length} of {HERO_MAX} · sessions count toward the cap
        </span>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3" data-testid="hero-grid">
        {shown.length === 0 ? (
          <p className="col-span-full py-2 text-sm text-text-sub">
            Nothing picked yet — the ritual (or a door below) builds today&apos;s menu.
          </p>
        ) : (
          shown.map((pick) => {
            const chip = reasonChipForPick(pick, { todayDateStr });
            const sessionStatus = heroSessionStatus(pick, sessions);
            const kind = pick.primary_action?.kind;
            const coverUrl = pick.arc?.cover_url ?? pick.task?.cover_url ?? null;
            const coverItemId = pick.arc_id ?? pick.task_id ?? pick.id;

            return (
              <div
                key={pick.id}
                className="flex min-h-[10.5rem] flex-col gap-3 overflow-hidden rounded-xl border border-border-warm bg-surface p-4"
                data-testid="hero-pick-card"
              >
                <CoverBand coverUrl={coverUrl} itemId={coverItemId} className="-mx-4 -mt-4 mb-1 h-7 rounded-t-[11px]" />
                <ReasonChip chip={chip} />
                <div className="flex flex-col gap-1">
                  <h3 className="text-base font-semibold text-text-main">{pickTitle(pick)}</h3>
                  {pickDescription(pick) && <p className="text-sm text-text-sub">{pickDescription(pick)}</p>}
                </div>

                {sessionStatus && (
                  <div
                    className="mt-auto flex items-center gap-2 border-t border-border-warm pt-2 text-sm"
                    data-testid="hero-session-status"
                    data-status={sessionStatus.status}
                  >
                    <span
                      className={
                        sessionStatus.status === 'needs_you'
                          ? 'text-[color:var(--warning)]'
                          : 'text-text-sub'
                      }
                    >
                      {sessionStatus.status === 'needs_you' ? 'needs you' : sessionStatus.status === 'working' ? 'working' : 'done'}
                    </span>
                    <span className="text-text-sub">{sessionStatus.detail}</span>
                  </div>
                )}

                <div className="flex items-center gap-2">
                  {kind === 'respond' && pick.session?.remote_url && (
                    <Button asChild variant="primary" size="sm">
                      <a href={pick.session.remote_url} target="_blank" rel="noopener noreferrer">
                        <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                        Respond
                      </a>
                    </Button>
                  )}
                  {kind === 'arc' && pick.arc_id && (
                    <Button asChild variant="primary" size="sm">
                      <Link href={`/oracle/arcs/${pick.arc_id}`}>Open arc</Link>
                    </Button>
                  )}
                  {kind === 'quest' && pick.task_id && (
                    <Button variant="primary" size="sm" onClick={() => openTaskPeek(pick.task_id as string)}>
                      Start
                    </Button>
                  )}
                  {kind === 'charter' && pick.charter_id && (
                    <Button asChild variant="primary" size="sm">
                      <Link href={`/charters/${pick.charter_id}`}>Open</Link>
                    </Button>
                  )}
                  <Tooltip content="Opens Focus Mode — a full-view timer on just this pick, with a park option when you step away">
                    <Button variant="secondary" size="sm" onClick={() => enterFocus(pick)}>
                      Focus
                    </Button>
                  </Tooltip>
                </div>
              </div>
            );
          })
        )}
      </div>

      {overflow > 0 && !expanded && (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="self-start text-xs text-text-sub underline decoration-dotted hover:text-text-main"
          data-testid="hero-expand"
        >
          {overflow} more
        </button>
      )}
    </section>
  );
}

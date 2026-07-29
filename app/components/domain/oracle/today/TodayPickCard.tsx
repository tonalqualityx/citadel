'use client';

import Link from 'next/link';
import { Check, ExternalLink, Focus } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Tooltip } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils/cn';
import { useTerminology } from '@/lib/hooks/use-terminology';
import { useNow } from '@/lib/hooks/use-now';
import { useUpdateTodayPick } from '@/lib/hooks/use-today';
import { useTaskPeek } from '@/lib/contexts/task-peek-context';
import { useFocusMode } from '@/lib/contexts/focus-mode-context';
import { SnoozeMenu } from '@/components/domain/oracle/soothsayer/SnoozeMenu';
import { CoverBand } from '@/components/domain/oracle/CoverBand';
import { commandAge } from '@/components/domain/oracle/oracle-logic';
import { ReasonChip } from '@/components/domain/oracle/ReasonChip';
import { reasonChipForPick } from '@/lib/reason-chips';
import type { TodayPick } from '@/lib/hooks/use-today';

interface TodayPickCardProps {
  pick: TodayPick;
  className?: string;
  // Clarity Phase 5 — a quiet attention dot on an arc-type pick's card when a legacy
  // hook-flagged needs_attention session (no declared ask) is linked to that arc. Optional
  // so every existing caller (Today board lens, drag overlay, etc.) that doesn't pass it
  // just renders with no dot, same as before this phase.
  hasAttentionDot?: boolean;
  // Clarity Phase 8 (composition) — YYYY-MM-DD in the requester's resolved timezone, needed
  // to label the reason chip's due date ("today"/"tomorrow"/"this week"/...). Every caller
  // that renders a chip (showReasonChip defaults true) must pass this; a caller rendering
  // FUTURE-day cards (the Soothsayer) passes showReasonChip={false} instead — a future-day
  // card must never claim "in progress" or "due today".
  todayDateStr?: string;
  // Clarity Phase 8 (composition) — the one honest reason chip (see lib/reason-chips.ts).
  // Defaults true: the wireframe puts a chip on every Work hero card AND every Plan kanban/
  // list card. Callers previewing a future day (DayColumn) opt out.
  showReasonChip?: boolean;
  // Clarity Phase 7 (P2) — the Now Strip intentionally renders the SAME pick a second
  // time above the main list ("replacing nothing" per spec). A distinct testid for that
  // copy keeps every existing (and future) unscoped `today-pick-card` query pointed at
  // exactly one element instead of hitting a strict-mode "2 elements" violation.
  testId?: string;
  // Clarity Phase 7 (P2) — Focus Mode's entry button. Defaults to shown (the Today list/
  // board/Now Strip are all "work NOW" surfaces where it belongs); the Soothsayer's day
  // columns opt out — those cards preview FUTURE days' plans, where "focus on this now"
  // doesn't apply, and a 3rd button there was squeezing the title's min-w-0 truncated
  // span down to zero width in that narrower layout (a real rendering regression this
  // caught, not just a semantic nicety).
  showFocusButton?: boolean;
  // Phase 8 shakedown (Mike, 2026-07-29): the board's To Do column passes this so Start
  // lives INSIDE the card's action row, next to the primary action — the two prior
  // attempts (dotted text link, then a pill floating under the card) both read as
  // detached debris between cards.
  onStart?: () => void;
}

function pickDisplayName(pick: TodayPick): string {
  if (pick.label) return pick.label;
  if (pick.arc) return pick.arc.name;
  if (pick.task) return pick.task.title;
  if (pick.session) return pick.session.title ?? pick.session.external_id;
  if (pick.charter) return pick.charter.name;
  return 'Untitled pick';
}

function pickSubline(pick: TodayPick, t: (k: 'task' | 'tasks') => string): string | null {
  if (pick.arc) {
    const progress =
      pick.arc.progress_percent !== undefined ? ` · ${pick.arc.progress_percent}%` : '';
    return `arc · ${pick.arc.task_count} ${pick.arc.task_count === 1 ? t('task') : t('tasks')} · ${pick.arc.status}${progress}`;
  }
  if (pick.task) return `${t('task')} · ${pick.task.status.replace('_', ' ')}`;
  if (pick.session) return `session · ${pick.session.status}`;
  if (pick.charter) return 'lead';
  return null;
}

// Every Today pick card ends in one obvious action, type-adaptive per the spec: session ->
// Respond/resume, arc -> arc board, task -> quest, lead -> charter, note -> done-toggle. A
// quiet complete-toggle (check morph, no modal/confetti/sound) is available on every card
// regardless of type — sub-second, quiet completion per the evidence-bound design rules.
export function TodayPickCard({
  pick,
  className,
  hasAttentionDot,
  todayDateStr,
  showReasonChip = true,
  testId,
  showFocusButton = true,
  onStart,
}: TodayPickCardProps) {
  const { t } = useTerminology();
  const updatePick = useUpdateTodayPick();
  const { openTaskPeek } = useTaskPeek();
  const { enterFocus } = useFocusMode();
  // Clarity Phase 4c — parity fix: a session-type pick's card renders the same quiet
  // "waiting since <time>" line the arc board's session panel does, when its session is
  // flagged needs_attention. Self-contained (like ArcSessionPanel) rather than threaded
  // down from every ancestor (TodaySection -> TodayBoard -> TodayBoardColumn -> ...) —
  // useNow is a cheap, dependency-free ticking clock, same pattern used elsewhere.
  const nowMs = useNow(30_000);
  const isDone = !!pick.completed_at;
  // Clarity Phase 7 — an arc-type pick's cover wins over a task-type pick's (a pick is
  // exactly one of the two, per the XOR the API already enforces, so this is really just
  // "whichever ref this pick actually carries").
  const coverUrl = pick.arc?.cover_url ?? pick.task?.cover_url ?? null;
  const coverItemId = pick.arc_id ?? pick.task_id ?? pick.id;

  function toggleDone() {
    updatePick.mutate({
      id: pick.id,
      data: { completed_at: isDone ? null : new Date().toISOString() },
    });
  }

  const kind = pick.primary_action?.kind;

  return (
    <Card
      className={cn('flex flex-col gap-2 overflow-hidden border-l-[3px] p-3', className)}
      style={{ borderLeftColor: isDone ? 'var(--success)' : 'var(--accent)' }}
      data-testid={testId ?? 'today-pick-card'}
      data-item-type={pick.item_type}
      data-completed={isDone || undefined}
    >
      <CoverBand coverUrl={coverUrl} itemId={coverItemId} className="-mx-3 -mt-3 mb-1 h-7 rounded-t-[7px]" />
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div
            className={cn('flex items-center gap-1.5 truncate text-sm font-semibold text-text-main', isDone && 'line-through opacity-60')}
          >
            <span className="truncate">{pickDisplayName(pick)}</span>
            {pick.item_type === 'arc' && hasAttentionDot && (
              <span
                className="h-1.5 w-1.5 shrink-0 rounded-full"
                style={{ backgroundColor: 'var(--warning)' }}
                data-testid="arc-attention-dot"
                title="session waiting"
              />
            )}
          </div>
          {pickSubline(pick, t) && (
            <div className="truncate text-xs text-text-sub">{pickSubline(pick, t)}</div>
          )}
          {pick.item_type === 'session' && pick.session?.needs_attention && pick.session.last_event_at && (
            <div className="truncate text-xs text-text-sub" data-testid="today-pick-waiting-since">
              waiting since {commandAge(pick.session.last_event_at, nowMs)}
            </div>
          )}
          {showReasonChip && !isDone && (
            <ReasonChip
              chip={reasonChipForPick(pick, { todayDateStr: todayDateStr ?? '' })}
              className="mt-1"
            />
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {pick.item_type === 'arc' && pick.arc_id && (
            <SnoozeMenu arcId={pick.arc_id} snoozedUntil={pick.arc?.snoozed_until ?? null} />
          )}
          {!isDone && showFocusButton && (
            <Tooltip content="Opens Focus Mode — a full-view timer on just this pick, with a park option when you step away">
              <button
                type="button"
                onClick={() => enterFocus(pick)}
                aria-label="Focus on this"
                data-testid="today-pick-focus-button"
                className="flex h-7 w-7 items-center justify-center rounded-full border border-border-warm text-text-sub hover:bg-background-light"
              >
                <Focus className="h-3.5 w-3.5" />
              </button>
            </Tooltip>
          )}
          <Tooltip content={isDone ? 'Marks this pick not done again' : 'Marks this pick done'}>
            <button
              type="button"
              onClick={toggleDone}
              aria-label={isDone ? 'Mark not done' : 'Mark done'}
              aria-pressed={isDone}
              data-testid="today-pick-toggle"
              className={cn(
                'flex h-7 w-7 items-center justify-center rounded-full border transition-colors',
                isDone
                  ? 'border-transparent bg-[var(--success-subtle)] text-[var(--success)]'
                  : 'border-border-warm text-text-sub hover:bg-background-light'
              )}
            >
              <Check className="h-3.5 w-3.5" />
            </button>
          </Tooltip>
        </div>
      </div>

      {!isDone && (
        <div className="flex items-center gap-2">
          {onStart && (
            <Button
              variant="secondary"
              size="sm"
              onClick={onStart}
              data-testid="today-board-start-button"
            >
              <svg viewBox="0 0 12 12" className="h-2.5 w-2.5" fill="currentColor" aria-hidden="true">
                <path d="M3 2l7 4-7 4z" />
              </svg>
              Start
            </Button>
          )}
          {kind === 'respond' && pick.session?.remote_url && (
            <Button asChild variant="primary" size="sm">
              <a href={pick.session.remote_url} target="_blank" rel="noopener noreferrer">
                <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                Respond
              </a>
            </Button>
          )}
          {kind === 'resume' && (
            <span className="text-xs text-text-sub">No live session — resume from your terminal</span>
          )}
          {kind === 'arc' && pick.arc_id && (
            <Button asChild variant="primary" size="sm">
              <Link href={`/oracle/arcs/${pick.arc_id}`}>Arc</Link>
            </Button>
          )}
          {kind === 'quest' && pick.task_id && (
            <Button variant="primary" size="sm" onClick={() => openTaskPeek(pick.task_id as string)}>
              {t('task')}
            </Button>
          )}
          {kind === 'charter' && pick.charter_id && (
            <Button asChild variant="primary" size="sm">
              <Link href={`/charters/${pick.charter_id}`}>Open</Link>
            </Button>
          )}
        </div>
      )}
    </Card>
  );
}

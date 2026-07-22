'use client';

import Link from 'next/link';
import { Check, ExternalLink } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils/cn';
import { useTerminology } from '@/lib/hooks/use-terminology';
import { useUpdateTodayPick } from '@/lib/hooks/use-today';
import { useTaskPeek } from '@/lib/contexts/task-peek-context';
import { SnoozeMenu } from '@/components/domain/oracle/soothsayer/SnoozeMenu';
import type { TodayPick } from '@/lib/hooks/use-today';

interface TodayPickCardProps {
  pick: TodayPick;
  className?: string;
  // Clarity Phase 5 — a quiet attention dot on an arc-type pick's card when a legacy
  // hook-flagged needs_attention session (no declared ask) is linked to that arc. Optional
  // so every existing caller (Today board lens, drag overlay, etc.) that doesn't pass it
  // just renders with no dot, same as before this phase.
  hasAttentionDot?: boolean;
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
export function TodayPickCard({ pick, className, hasAttentionDot }: TodayPickCardProps) {
  const { t } = useTerminology();
  const updatePick = useUpdateTodayPick();
  const { openTaskPeek } = useTaskPeek();
  const isDone = !!pick.completed_at;

  function toggleDone() {
    updatePick.mutate({
      id: pick.id,
      data: { completed_at: isDone ? null : new Date().toISOString() },
    });
  }

  const kind = pick.primary_action?.kind;

  return (
    <Card
      className={cn('flex flex-col gap-2 border-l-[3px] p-3', className)}
      style={{ borderLeftColor: isDone ? 'var(--success)' : 'var(--accent)' }}
      data-testid="today-pick-card"
      data-item-type={pick.item_type}
      data-completed={isDone || undefined}
    >
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
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {pick.item_type === 'arc' && pick.arc_id && (
            <SnoozeMenu arcId={pick.arc_id} snoozedUntil={pick.arc?.snoozed_until ?? null} />
          )}
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
        </div>
      </div>

      {!isDone && (
        <div className="flex items-center gap-2">
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

'use client';

import * as React from 'react';
import Link from 'next/link';
import { ExternalLink, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { RichTextRenderer } from '@/components/ui/rich-text-editor';
import { CrisisStrip } from '@/components/domain/oracle/crisis/CrisisStrip';
import { useNow } from '@/lib/hooks/use-now';
import { useTask } from '@/lib/hooks/use-tasks';
import { useArc } from '@/lib/hooks/use-arcs';
import { useWaitingOnMe } from '@/lib/hooks/use-waiting-on-me';
import { useParkFocusSession } from '@/lib/hooks/use-focus-mode';
import type { TodayPick } from '@/lib/hooks/use-today';
import {
  FOCUS_DURATION_PRESETS_MINUTES,
  formatClock,
  elapsedSeconds,
  remainingSeconds,
  isTimeUp,
  isValidParkNote,
  type FocusDurationChoice,
} from './focus-mode-logic';

interface FocusModeProps {
  pick: TodayPick;
  onExit: () => void;
}

function pickTitle(pick: TodayPick): string {
  if (pick.label) return pick.label;
  if (pick.arc) return pick.arc.name;
  if (pick.task) return pick.task.title;
  if (pick.session) return pick.session.title ?? pick.session.external_id;
  if (pick.charter) return pick.charter.name;
  return 'Untitled';
}

// Clarity Phase 7 (Seeing Stone Reckoning P2) — Focus Mode (spec Q8/G10): a quiet full-view
// of the ONE thing being worked now. Entered from any Today card. On entry: declare a
// duration (25/45/90 presets, custom, or open-ended) before the timer starts — never a
// silent default. Countdown renders small, in a corner, never the loud centerpiece (research
// law: no time-guilt mechanics). At zero: PARK-or-CONTINUE, never a hard stop — Continue
// switches to an open-ended count-up, still parkable at any time. The crisis lane still
// polls through focus (reuses useWaitingOnMe/CrisisStrip verbatim — same component, same
// "Handled" action, zero pixels when calm).
export function FocusMode({ pick, onExit }: FocusModeProps) {
  const [startedAtMs] = React.useState(() => Date.now());
  const [durationChoice, setDurationChoice] = React.useState<FocusDurationChoice | null>(null);
  const [customMinutes, setCustomMinutes] = React.useState('');
  const [parkDialogOpen, setParkDialogOpen] = React.useState(false);
  const [whereLeftOff, setWhereLeftOff] = React.useState('');
  const [nextStep, setNextStep] = React.useState('');
  const nowMs = useNow(1000);

  const { data: waitingOnMeData } = useWaitingOnMe();
  const park = useParkFocusSession();

  const isTaskPick = pick.item_type === 'task' && !!pick.task_id;
  const { data: task } = useTask(pick.task_id ?? '', { enabled: isTaskPick });

  // The arc to show/link: a direct arc-type pick's own arc, or the underlying task's arc
  // (per spec: "its arc link ... if its arc has them" — a task-type pick's card still
  // surfaces its arc's attached emails, not just an arc-type pick's).
  const resolvedArcId = pick.item_type === 'arc' ? pick.arc_id : task?.arc_id ?? null;
  const { data: arc } = useArc(resolvedArcId ?? '', { enabled: !!resolvedArcId });

  const timeUp = durationChoice ? isTimeUp(durationChoice, startedAtMs, nowMs) : false;

  // At-zero auto-opens the Park-or-Continue dialog exactly once per crossing — Continue
  // flips durationChoice to open-ended (see handleContinue), which makes isTimeUp
  // permanently false again, so this never re-fires after that.
  React.useEffect(() => {
    if (timeUp) setParkDialogOpen(true);
  }, [timeUp]);

  React.useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape' && !parkDialogOpen) onExit();
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onExit, parkDialogOpen]);

  function chooseDuration(choice: FocusDurationChoice) {
    setDurationChoice(choice);
  }

  function submitCustom(e: React.FormEvent) {
    e.preventDefault();
    const minutes = Number(customMinutes);
    if (!Number.isFinite(minutes) || minutes <= 0) return;
    chooseDuration({ kind: 'fixed', minutes });
  }

  function handleContinue() {
    setDurationChoice({ kind: 'open-ended' });
    setParkDialogOpen(false);
  }

  function handlePark() {
    const note = { whereLeftOff, nextStep };
    if (!isValidParkNote(note)) return;
    park.mutate(
      {
        pick,
        note,
        nowMs: Date.now(),
        startedAtMs,
        currentTaskDescription: task?.description,
      },
      { onSuccess: onExit }
    );
  }

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col items-center gap-6 overflow-y-auto bg-background p-6"
      data-testid="focus-mode-overlay"
    >
      <button
        type="button"
        onClick={onExit}
        aria-label="Exit focus"
        className="absolute right-4 top-4 flex h-8 w-8 items-center justify-center rounded-full border border-border-warm text-text-sub hover:bg-background-light"
        data-testid="focus-mode-exit"
      >
        <X className="h-4 w-4" />
      </button>

      {waitingOnMeData && waitingOnMeData.crisis.length > 0 && (
        <div className="w-full max-w-2xl" data-testid="focus-mode-crisis-banner">
          <CrisisStrip crisis={waitingOnMeData.crisis} />
        </div>
      )}

      {!durationChoice ? (
        <DurationDeclare
          customMinutes={customMinutes}
          onCustomMinutesChange={setCustomMinutes}
          onChoose={chooseDuration}
          onSubmitCustom={submitCustom}
        />
      ) : (
        <div className="flex w-full max-w-2xl flex-1 flex-col items-center justify-center gap-4">
          <FocusCard pick={pick} task={task} arc={arc} />

          <div className="flex items-center gap-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setParkDialogOpen(true)}
              data-testid="focus-mode-park-button"
            >
              Park
            </Button>
          </div>

          {parkDialogOpen && (
            <ParkDialog
              mode={timeUp ? 'zero' : 'manual'}
              whereLeftOff={whereLeftOff}
              nextStep={nextStep}
              onWhereLeftOffChange={setWhereLeftOff}
              onNextStepChange={setNextStep}
              onPark={handlePark}
              onContinue={timeUp ? handleContinue : undefined}
              onCancel={!timeUp ? () => setParkDialogOpen(false) : undefined}
              isPending={park.isPending}
            />
          )}
        </div>
      )}

      {durationChoice && (
        <div
          className="fixed bottom-4 right-4 rounded-md border border-border-warm bg-surface px-2 py-1 text-xs text-text-sub"
          data-testid="focus-mode-clock"
        >
          {durationChoice.kind === 'fixed'
            ? formatClock(remainingSeconds(durationChoice, startedAtMs, nowMs) ?? 0)
            : formatClock(elapsedSeconds(startedAtMs, nowMs))}
        </div>
      )}
    </div>
  );
}

function DurationDeclare({
  customMinutes,
  onCustomMinutesChange,
  onChoose,
  onSubmitCustom,
}: {
  customMinutes: string;
  onCustomMinutesChange: (v: string) => void;
  onChoose: (choice: FocusDurationChoice) => void;
  onSubmitCustom: (e: React.FormEvent) => void;
}) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4" data-testid="focus-mode-duration-declare">
      <p className="text-sm text-text-sub">How long?</p>
      <div className="flex flex-wrap items-center justify-center gap-2">
        {FOCUS_DURATION_PRESETS_MINUTES.map((minutes) => (
          <Button
            key={minutes}
            variant="secondary"
            onClick={() => onChoose({ kind: 'fixed', minutes })}
            data-testid={`focus-duration-preset-${minutes}`}
          >
            {minutes}m
          </Button>
        ))}
        <Button
          variant="ghost"
          onClick={() => onChoose({ kind: 'open-ended' })}
          data-testid="focus-duration-open-ended"
        >
          Open-ended
        </Button>
      </div>
      <form onSubmit={onSubmitCustom} className="flex items-center gap-1.5">
        <input
          type="number"
          min={1}
          inputMode="numeric"
          placeholder="custom minutes"
          value={customMinutes}
          onChange={(e) => onCustomMinutesChange(e.target.value)}
          className="w-32 rounded border border-border-warm bg-surface px-2 py-1 text-xs text-text-main"
          data-testid="focus-duration-custom-input"
        />
        <Button type="submit" variant="ghost" size="sm">
          Set
        </Button>
      </form>
    </div>
  );
}

function FocusCard({
  pick,
  task,
  arc,
}: {
  pick: TodayPick;
  task?: { description: unknown } | null;
  arc?: { id: string; description: string | null; email_asks: Array<{ id: string; subject: string; deep_link: string }> } | null;
}) {
  return (
    <div className="flex w-full flex-col gap-3 rounded-lg border border-border-warm bg-surface p-6" data-testid="focus-mode-card">
      <h1 className="text-xl font-semibold text-text-main" data-testid="focus-mode-title">
        {pickTitle(pick)}
      </h1>

      {pick.item_type === 'task' && task?.description ? (
        <RichTextRenderer content={task.description} className="text-sm text-text-sub" />
      ) : null}

      {pick.item_type === 'arc' && arc?.description ? (
        <p className="whitespace-pre-wrap text-sm text-text-sub">{arc.description}</p>
      ) : null}

      {arc && (
        <Link
          href={`/oracle/arcs/${arc.id}`}
          className="w-fit text-sm text-primary hover:underline"
          data-testid="focus-mode-arc-link"
        >
          Open arc
        </Link>
      )}

      {arc && arc.email_asks.length > 0 && (
        <div className="flex flex-col gap-1" data-testid="focus-mode-emails">
          <span className="text-xs font-semibold uppercase tracking-wide text-text-sub">Attached email</span>
          {arc.email_asks.map((ask) => (
            <a
              key={ask.id}
              href={ask.deep_link}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1 text-sm text-primary hover:underline"
            >
              <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
              {ask.subject}
            </a>
          ))}
        </div>
      )}
    </div>
  );
}

function ParkDialog({
  mode,
  whereLeftOff,
  nextStep,
  onWhereLeftOffChange,
  onNextStepChange,
  onPark,
  onContinue,
  onCancel,
  isPending,
}: {
  mode: 'zero' | 'manual';
  whereLeftOff: string;
  nextStep: string;
  onWhereLeftOffChange: (v: string) => void;
  onNextStepChange: (v: string) => void;
  onPark: () => void;
  onContinue?: () => void;
  onCancel?: () => void;
  isPending: boolean;
}) {
  const valid = isValidParkNote({ whereLeftOff, nextStep });

  return (
    <div
      className="flex w-full max-w-md flex-col gap-3 rounded-lg border border-border-warm bg-surface p-4"
      data-testid="focus-mode-park-dialog"
    >
      <p className="text-sm text-text-sub">
        {mode === 'zero' ? "Time's up — park it, or keep going?" : 'Where are you leaving this?'}
      </p>
      <Textarea
        label="Where I left off"
        value={whereLeftOff}
        onChange={(e) => onWhereLeftOffChange(e.target.value)}
        data-testid="focus-mode-where-left-off"
      />
      <Textarea
        label="Next step"
        value={nextStep}
        onChange={(e) => onNextStepChange(e.target.value)}
        data-testid="focus-mode-next-step"
      />
      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={onPark} disabled={!valid || isPending} data-testid="focus-mode-park-submit">
          Park
        </Button>
        {onContinue && (
          <Button variant="secondary" onClick={onContinue} data-testid="focus-mode-continue">
            Continue
          </Button>
        )}
        {onCancel && (
          <Button variant="ghost" onClick={onCancel} data-testid="focus-mode-park-cancel">
            Cancel
          </Button>
        )}
      </div>
    </div>
  );
}

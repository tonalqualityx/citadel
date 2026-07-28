'use client';

import * as React from 'react';
import Link from 'next/link';
import { ExternalLink, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Tooltip } from '@/components/ui/tooltip';
import { RichTextRenderer, getBlockNotePlainText } from '@/components/ui/rich-text-editor';
import { CrisisStrip } from '@/components/domain/oracle/crisis/CrisisStrip';
import { useNow } from '@/lib/hooks/use-now';
import { useTask } from '@/lib/hooks/use-tasks';
import { useArc } from '@/lib/hooks/use-arcs';
import { useWaitingOnMe } from '@/lib/hooks/use-waiting-on-me';
import { useParkFocusSession, useSaveFocusNotes } from '@/lib/hooks/use-focus-mode';
import { formatShortDate } from '@/lib/utils/time';
import type { TodayPick } from '@/lib/hooks/use-today';
import {
  FOCUS_DURATION_PRESETS_MINUTES,
  formatClock,
  elapsedSeconds,
  remainingSeconds,
  isTimeUp,
  isValidParkNote,
  extractWorkingNotes,
  type FocusDurationChoice,
} from './focus-mode-logic';

// Clarity Phase 7 (repair, 2026-07-27) — auto-save waits for a pause in typing rather than
// firing on every keystroke; short enough that "close the laptop mid-thought" still gets
// captured, long enough that it isn't hammering the API on every character.
const NOTES_AUTOSAVE_DEBOUNCE_MS = 800;

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
  const saveNotes = useSaveFocusNotes();

  const isTaskPick = pick.item_type === 'task' && !!pick.task_id;
  const { data: task } = useTask(pick.task_id ?? '', { enabled: isTaskPick });

  // The arc to show/link: a direct arc-type pick's own arc, or the underlying task's arc
  // (per spec: "its arc link ... if its arc has them" — a task-type pick's card still
  // surfaces its arc's attached emails, not just an arc-type pick's).
  const resolvedArcId = pick.item_type === 'arc' ? pick.arc_id : task?.arc_id ?? null;
  const { data: arc } = useArc(resolvedArcId ?? '', { enabled: !!resolvedArcId });

  // Clarity Phase 7 (repair, 2026-07-27) — Working notes: always-present, auto-saved,
  // sharing ONE home with Park (task description's dedicated notes paragraph, or the
  // pick's own `label` for everything else — see use-focus-mode.ts).
  //
  // A non-task pick's baseline (its label) is known synchronously at mount, so `notes`
  // and `lastSavedNotesRef` start already equal — the autosave effect below sees no diff
  // and never fires from initialization alone. A task pick's real description arrives
  // async (useTask); `lastSavedNotesRef` starts at the `null` sentinel so the autosave
  // effect stays inert until the load-and-prefill effect below actually has a baseline.
  const [notes, setNotes] = React.useState<string>(() => (isTaskPick ? '' : pick.label ?? ''));
  const lastSavedNotesRef = React.useRef<string | null>(isTaskPick ? null : pick.label ?? '');
  // Flips true the instant a real baseline exists to diff against (immediately for a
  // non-task pick; once the task fetch lands for a task pick) — a plain STATE value
  // (not just the ref) so the autosave effect below is guaranteed to re-run at that exact
  // moment, even if the user already typed something and `notes` itself didn't change.
  const [notesPrimed, setNotesPrimed] = React.useState(!isTaskPick);

  React.useEffect(() => {
    if (!isTaskPick || lastSavedNotesRef.current !== null) return; // non-task, or already primed
    if (task === undefined) return; // still loading the task's real description
    const initial = extractWorkingNotes(task.description);
    lastSavedNotesRef.current = initial;
    // A fast typer can start editing before the task fetch resolves — functional form so
    // we only apply the fetched baseline if the textarea is STILL untouched ('' is the
    // only possible value before this effect ever runs for a task pick); a real edit
    // already in progress is preserved, and the autosave effect below picks it up via
    // `notesPrimed` flipping, not via `notes` itself changing.
    setNotes((current) => (current === '' ? initial : current));
    setNotesPrimed(true);
  }, [isTaskPick, task]);

  React.useEffect(() => {
    // Never fires on initialization itself (lastSavedNotesRef starts equal to `notes`) —
    // only a REAL edit past that point schedules a save.
    if (!notesPrimed || lastSavedNotesRef.current === null || notes === lastSavedNotesRef.current) return;
    const timer = setTimeout(() => {
      lastSavedNotesRef.current = notes;
      saveNotes.mutate({ pick, text: notes, currentTaskDescription: task?.description });
    }, NOTES_AUTOSAVE_DEBOUNCE_MS);
    return () => clearTimeout(timer);
    // `notes`/`notesPrimed` are the only intentional retrigger deps: pick/task/saveNotes
    // are read at fire-time via closure (they don't change mid-session for a given focus
    // entry), and deliberately aren't tracked here — including them would refire the
    // effect (and reset the debounce timer) on every task-data refetch, not just on real
    // edits or the one-time primed transition.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notes, notesPrimed]);

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
      <Tooltip content="Exits Focus Mode and returns to Today — nothing here is lost, just closed">
        <button
          type="button"
          onClick={onExit}
          aria-label="Exit focus"
          className="absolute right-4 top-4 flex h-8 w-8 items-center justify-center rounded-full border border-border-warm text-text-sub hover:bg-background-light"
          data-testid="focus-mode-exit"
        >
          <X className="h-4 w-4" />
        </button>
      </Tooltip>

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
          <FocusCard pick={pick} task={task} arc={arc} notes={notes} onNotesChange={setNotes} />

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

// Clarity Phase 7 (repair, 2026-07-27) — the real fix for Mike's screenshot: focus mode
// was "a bare title floating in a void with a Park button, nothing else." This card now
// always shows whatever real context exists (description, priority/due date, arc + its
// attached emails) and ALWAYS offers an editable, auto-saved Working notes area — never a
// void, even for a card with no description yet (see the empty-state line below).
function FocusCard({
  pick,
  task,
  arc,
  notes,
  onNotesChange,
}: {
  pick: TodayPick;
  task?: { description: unknown; priority?: number | null; due_date?: string | null } | null;
  arc?: {
    id: string;
    name: string;
    description: string | null;
    email_asks: Array<{ id: string; subject: string; deep_link: string }>;
  } | null;
  notes: string;
  onNotesChange: (value: string) => void;
}) {
  const taskDescriptionText =
    pick.item_type === 'task' && task ? getBlockNotePlainText(task.description) : '';
  const hasTaskDescription = taskDescriptionText.trim().length > 0;
  const hasArcDescription = pick.item_type === 'arc' && !!arc?.description?.trim();

  return (
    <div className="flex w-full flex-col gap-3 rounded-lg border border-border-warm bg-surface p-6" data-testid="focus-mode-card">
      <h1 className="text-xl font-semibold text-text-main" data-testid="focus-mode-title">
        {pickTitle(pick)}
      </h1>

      {hasTaskDescription ? (
        <RichTextRenderer content={task!.description} className="text-sm text-text-sub" />
      ) : hasArcDescription ? (
        <p className="whitespace-pre-wrap text-sm text-text-sub">{arc!.description}</p>
      ) : (
        // Clarity Phase 7 (repair) — never a void: a card with nothing on it yet says so
        // quietly, and points at the one thing that will actually give it context.
        <p className="text-sm text-text-sub" data-testid="focus-mode-empty-context">
          No context on this card yet — notes below become its context.
        </p>
      )}

      {pick.item_type === 'task' && task && (task.priority != null || task.due_date) && (
        <p className="text-xs text-text-sub" data-testid="focus-mode-meta-line">
          {task.priority != null ? `P${task.priority}` : null}
          {task.priority != null && task.due_date ? ' · ' : null}
          {task.due_date ? `Due ${formatShortDate(new Date(task.due_date))}` : null}
        </p>
      )}

      {arc && (
        <Link
          href={`/oracle/arcs/${arc.id}`}
          className="flex w-fit items-center gap-1 text-sm text-primary hover:underline"
          data-testid="focus-mode-arc-link"
        >
          {arc.name}
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

      {/* Clarity Phase 7 (repair) — ALWAYS present, regardless of pick type or whether
          there's a description yet: auto-saved (debounced) into the same home Park
          already writes to (see FocusMode's notes effects + use-focus-mode.ts). */}
      <Textarea
        label="Working notes"
        value={notes}
        onChange={(e) => onNotesChange(e.target.value)}
        placeholder="What's the shape of this, right now?"
        data-testid="focus-mode-notes"
      />
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

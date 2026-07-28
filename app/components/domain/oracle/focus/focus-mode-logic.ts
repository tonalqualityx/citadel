// Clarity Phase 7 (Seeing Stone Reckoning P2) — Focus Mode (spec Q8). Pure, dependency-free
// timer/duration/park math — same discipline as time-shape-logic.ts/today-board-logic.ts —
// so the countdown/count-up arithmetic is unit-testable without a clock or React.

export const FOCUS_DURATION_PRESETS_MINUTES = [25, 45, 90] as const;

export type FocusDurationChoice =
  | { kind: 'fixed'; minutes: number }
  | { kind: 'open-ended' };

/** Elapsed whole minutes since the focus session started — always non-negative even if
 *  `nowMs` is (implausibly) before `startedAtMs`, since a negative "-1 min" reading would
 *  be a worse failure mode than clamping to 0. */
export function elapsedMinutes(startedAtMs: number, nowMs: number): number {
  return Math.max(0, Math.round((nowMs - startedAtMs) / 60_000));
}

export function elapsedSeconds(startedAtMs: number, nowMs: number): number {
  return Math.max(0, Math.round((nowMs - startedAtMs) / 1000));
}

/** Seconds remaining for a fixed-duration session; null for open-ended (there is no
 *  "remaining" — it counts up instead, see elapsedSeconds). Never negative — a session
 *  past its declared duration reads as exactly 0 (isTimeUp is what flags "done"). */
export function remainingSeconds(
  choice: FocusDurationChoice,
  startedAtMs: number,
  nowMs: number
): number | null {
  if (choice.kind === 'open-ended') return null;
  const totalSeconds = choice.minutes * 60;
  const elapsed = elapsedSeconds(startedAtMs, nowMs);
  return Math.max(0, totalSeconds - elapsed);
}

export function isTimeUp(choice: FocusDurationChoice, startedAtMs: number, nowMs: number): boolean {
  if (choice.kind === 'open-ended') return false;
  return (remainingSeconds(choice, startedAtMs, nowMs) ?? 0) <= 0;
}

/** mm:ss, always — a countdown reading "0:00" at zero, never negative digits. */
export function formatClock(totalSeconds: number): string {
  const clamped = Math.max(0, Math.round(totalSeconds));
  const minutes = Math.floor(clamped / 60);
  const seconds = clamped % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

export interface ParkNoteInput {
  whereLeftOff: string;
  nextStep: string;
}

/** A park note is only ever recorded on a real, non-empty capture — an empty "where I
 *  left off" with an empty "next step" isn't a park, research law (Leroy): the whole
 *  point of the loop-closing act is that it actually closes something. */
export function isValidParkNote(input: ParkNoteInput): boolean {
  return input.whereLeftOff.trim().length > 0 || input.nextStep.trim().length > 0;
}

/** The plain-text park note appended to wherever it lands (task description or the
 *  pick's own label — see use-focus-mode.ts). Deliberately plain text, not a fabricated
 *  BlockNote structure beyond a single paragraph — this is a quick capture, not an essay. */
export function formatParkNoteText(input: ParkNoteInput, nowMs: number): string {
  const stamp = new Date(nowMs).toISOString();
  const parts: string[] = [`Parked ${stamp}`];
  if (input.whereLeftOff.trim()) parts.push(`Where I left off: ${input.whereLeftOff.trim()}`);
  if (input.nextStep.trim()) parts.push(`Next step: ${input.nextStep.trim()}`);
  return parts.join(' — ');
}

// ============================================
// Working notes (Clarity Phase 7 repair, 2026-07-27) — Focus Mode's always-present,
// auto-saved "Working notes" textarea. Mike's screenshot was a bare title floating in a
// void with a Park button and nothing else; this is the fix. Notes share ONE home with the
// existing Park capture (task description for a task pick, the pick's own `label` field
// for everything else — see use-focus-mode.ts's useParkFocusSession) rather than a second,
// competing storage location.
// ============================================

/** The stable block id the working-notes paragraph is stored under inside a task's
 *  BlockNote description. Fixed (not a fresh crypto.randomUUID() per save) so autosave
 *  updates the SAME paragraph in place across debounce ticks instead of appending a new
 *  one every few keystrokes. */
export const FOCUS_NOTES_BLOCK_ID = 'focus-mode-working-notes';

/** Reads the dedicated working-notes paragraph's plain text back out of a task's stored
 *  BlockNote description, so Focus Mode can pre-fill the textarea with whatever was saved
 *  last time (task picks only — see extractWorkingNotesLabel for non-task picks, which is
 *  just the pick's own label). '' when there's no such block yet — a brand-new pick, or a
 *  description that predates this feature entirely. */
export function extractWorkingNotes(description: unknown): string {
  if (!Array.isArray(description)) return '';
  const block = description.find(
    (b): b is { id: string; content?: Array<{ text?: string }> } =>
      !!b && typeof b === 'object' && (b as { id?: unknown }).id === FOCUS_NOTES_BLOCK_ID
  );
  if (!block || !Array.isArray(block.content)) return '';
  return block.content.map((c) => (typeof c?.text === 'string' ? c.text : '')).join('');
}

// ============================================
// Type-aware focus actions (scope addition, live-usage report mid-build) — Focus Mode
// offered ONLY Park; every pick type also gets Complete, task picks get "Mark quest done",
// arc picks get "Add quest" + a quiet "Close this arc?" offer once its open tasks hit zero.
// ============================================

/** An arc has open work remaining when at least one of its tasks is neither done nor
 *  abandoned — the same "not finished, not given up on" test used elsewhere (e.g. the
 *  plate rule's own notIn set). An arc with ZERO tasks at all also has no open tasks
 *  (nothing left to block a close offer), which is the correct behavior for a
 *  shapeless arc that never grew any. */
export function arcHasOpenTasks(taskStatuses: string[]): boolean {
  return taskStatuses.some((s) => s !== 'done' && s !== 'abandoned');
}

/** Returns a new BlockNote block array with the dedicated working-notes paragraph created
 *  (if this is the first save) or updated in place (every save after that) — the
 *  "appending/updating a dedicated notes paragraph" the spec calls for, never a fresh
 *  paragraph piling up on every debounce tick. Every other existing block is left
 *  untouched, in its original position. */
export function upsertWorkingNotesBlock(description: unknown, text: string): unknown[] {
  const blocks = Array.isArray(description) ? [...description] : [];
  const notesBlock = {
    id: FOCUS_NOTES_BLOCK_ID,
    type: 'paragraph',
    content: [{ type: 'text', text, styles: {} }],
  };
  const idx = blocks.findIndex(
    (b) => !!b && typeof b === 'object' && (b as { id?: unknown }).id === FOCUS_NOTES_BLOCK_ID
  );
  if (idx >= 0) {
    blocks[idx] = notesBlock;
  } else {
    blocks.push(notesBlock);
  }
  return blocks;
}

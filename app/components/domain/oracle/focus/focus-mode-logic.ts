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

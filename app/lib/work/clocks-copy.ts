/**
 * Work stage F: the words on the owner's screen for the two clocks. Plain words, no em or en dash, never the banned words. Pure.
 * An estimate is always worded as an estimate and says what it was inferred from. The copy guard scans this folder.
 */

import { displayText } from '@/lib/home/copy';

/** The minutes the "Log it?" tap offers (and a typed number); the estimate is preselected. */
export const LOG_CHOICES = [15, 30, 60, 90, 120] as const;
export const LOG_STEP_MIN = 5;

/** `45 m`, `1 h 05 m`, `2 h`. */
export function formatMinutes(total: number): string {
  const m = Math.max(0, Math.round(total));
  const h = Math.floor(m / 60);
  const r = m % 60;
  if (h === 0) return `${r} m`;
  if (r === 0) return `${h} h`;
  return `${h} h ${String(r).padStart(2, '0')} m`;
}

/** An estimate is shown in steps of five minutes ("about 2 h 10 m"). */
export const roundToStep = (minutes: number): number => Math.max(0, Math.round(minutes / LOG_STEP_MIN) * LOG_STEP_MIN);

/** What an estimate was inferred from: `3 of your sessions on 2 days`. */
export function inferredFrom(sessions: number, days: number): string {
  const s = sessions === 1 ? '1 of your sessions' : `${sessions} of your sessions`;
  const d = days === 1 ? '1 day' : `${days} days`;
  return sessions > 0 ? `${s} on ${d}` : `Bast's own guess when you tracked it`;
}

/** `Your time: about 2 h 10 m this month (Bast's estimate from 3 of your sessions on 2 days). Log it?` */
export function mikeLine(unloggedMinutes: number, loggedMinutes: number, from: string): string {
  const basis = `(Bast's estimate from ${from})`;
  if (unloggedMinutes > 0) return `Your time: about ${formatMinutes(roundToStep(unloggedMinutes + loggedMinutes))} this month ${basis}. Log it?`;
  return `Your time: about ${formatMinutes(roundToStep(loggedMinutes))} this month ${basis}. Logged.`;
}

/** `Bast worked: 1 h 05 m, $3.40.` The dollars are real ledger cost for unattended runs; an interactive turn shows minutes only. */
export function bastLine(minutes: number, cost: number | null, allCosted: boolean): string {
  const base = `Bast worked: ${formatMinutes(minutes)}`;
  if (cost === null) return `${base}.`;
  return `${base}, $${cost.toFixed(2)}${allCosted ? '' : ' on unattended runs'}.`;
}

export const CLOCK_MESSAGES = {
  logged: (minutes: number) => `Logged ${formatMinutes(minutes)}.`,
  noEstimate: 'There is no estimate to log on this one.',
  notFound: 'That project or task does not exist.',
  basisDefault: 'Estimated from your session before it was tracked.',
  entryDescription: (from: string) => `Estimated by Bast from ${displayText(from)}, logged by your tap.`,
} as const;

export const trackedEstimateBasis = (basis: string | null | undefined): string => {
  const b = displayText(basis ?? '');
  return b ? `Bast's estimate when you tracked it: ${b}` : CLOCK_MESSAGES.basisDefault;
};

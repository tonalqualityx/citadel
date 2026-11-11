/** Home Slice 9a: the time estimate the match model gives is rounded and bounded by code. Pure. */

export const MINUTES_MIN = 15;
export const MINUTES_MAX = 480;
export const SESSION_SPAN_MAX = 180;
export const MINUTES_FALLBACK = 30;
export const FALLBACK_BASIS = 'no detail in the mail';

/** The choices a card offers (minutes). */
export const TIME_CHOICES: readonly number[] = [15, 30, 60, 90, 120];

/** Rounded to 15, clamped to 15 to 480. A missing or zero estimate gives the 30 minute fallback. */
export function clampMinutes(raw: number | null | undefined): number {
  if (raw === null || raw === undefined || !Number.isFinite(raw) || raw <= 0) return MINUTES_FALLBACK;
  const rounded = Math.round(raw / 15) * 15;
  return Math.min(MINUTES_MAX, Math.max(MINUTES_MIN, rounded));
}

/** The basis words: the model's own line, or the fixed words when it gave none. */
export function basisWords(minutes: number | null | undefined, basis: string | null | undefined): string {
  const b = (basis ?? '').replace(/\s+/g, ' ').trim();
  if (!minutes || minutes <= 0 || b === '') return FALLBACK_BASIS;
  return b.length > 240 ? b.slice(0, 240) : b;
}

/** A session's span counts at most 180 minutes. */
export function sessionSpanMinutes(startedAt: Date | null, lastEventAt: Date | null): number {
  if (!startedAt || !lastEventAt) return 0;
  const m = Math.round((lastEventAt.getTime() - startedAt.getTime()) / 60000);
  return Math.min(SESSION_SPAN_MAX, Math.max(0, m));
}

/** "30 minutes", "1 hour", "1 hour 30 minutes". */
export function minutesWords(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  const hs = h === 1 ? '1 hour' : `${h} hours`;
  if (h === 0) return `${m} minutes`;
  if (m === 0) return hs;
  return `${hs} ${m} minutes`;
}

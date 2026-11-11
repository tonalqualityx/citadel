/**
 * Home screen Slice 8b: a project's next step as a row. Pure: the loader's RawProjectStep and the item state in, whether the
 * row shows, its words, and which steps survive the one-row-per-project rule out. select.ts builds the candidate from this.
 * Nothing here reads or writes the database, and nothing carries a score.
 */

import { displayText } from '../copy';
import { businessDaysElapsed } from '../rules';
import type { RawItemState, RawProjectStep } from '../types';
import { calendarDays, daysText, stripMikePrefix } from './copy';

/** How many business days "I did this" hides the row when Bast has not rewritten the step. */
export const STEP_HIDE_BUSINESS_DAYS = 2;

export const STEP_REFRESH_TOAST = 'Bast will read the project again in a few minutes.';
export const STEP_DONE_MESSAGE = STEP_REFRESH_TOAST;
export const STEP_STILL_LINE = 'Bast still reads this as the next step.';
export const STEP_IF_IGNORED = 'Stays here. Bast reads the project again tonight and rewrites this step.';

/** The footer reason: "The next step on {project} is yours." */
export function stepReason(project: string): string {
  return `The next step on ${displayText(project) || 'this project'} is yours.`;
}

/** The row's title: the step text with the leading "Mike, " removed. */
export function stepTitle(text: string): string {
  return stripMikePrefix(text) || 'Next step';
}

/** The text compared across a rewrite: shown words, collapsed. */
export function stepComparable(text: string | null | undefined): string {
  return displayText(text).replace(/\s+/g, ' ').trim().toLowerCase();
}

/** "quiet 21 days", "quiet 1 day", or "moved today" when a task of the project changed today. */
export function quietWords(lastActivity: Date, now: Date, timeZone: string): string {
  const n = calendarDays(lastActivity, now, timeZone);
  return n === 0 ? 'moved today' : `quiet ${daysText(n)}`;
}

/** "Jack Gaughan Artist Site · quiet 21 days", plus the still line when it applies. */
export function stepWhyNow(project: string, lastActivity: Date, now: Date, timeZone: string, still: boolean): string {
  const base = `${displayText(project) || 'This project'} · ${quietWords(lastActivity, now, timeZone)}`;
  return still ? `${base}. ${STEP_STILL_LINE}` : base;
}

export type StepVisibility = 'show' | 'hidden' | 'still';

/**
 * After "I did this": hidden until Bast rewrites the step (Project.next_step_at moves past the tap) or two business days pass.
 * Once back, the same text reads as "still"; different text is a new step and shows plainly.
 */
export function stepVisibility(step: Pick<RawProjectStep, 'text' | 'step_at'>, state: Pick<RawItemState, 'step_done_at' | 'step_done_text'> | undefined | null, now: Date): StepVisibility {
  const doneAt = state?.step_done_at ?? null;
  if (!doneAt) return 'show';
  const rewritten = step.step_at !== null && step.step_at.getTime() > doneAt.getTime();
  if (!rewritten && businessDaysElapsed(doneAt, now) < STEP_HIDE_BUSINESS_DAYS) return 'hidden';
  return stepComparable(step.text) === stepComparable(state?.step_done_text) ? 'still' : 'show';
}

/**
 * One row per project, and only when nothing else of his for that project is in view. `inViewProjects` is the set of project ids
 * that already have an item in view; the first step per project wins.
 */
export function dedupeSteps<T extends { project_id: string }>(steps: readonly T[], inViewProjects: ReadonlySet<string>): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const s of steps) {
    if (inViewProjects.has(s.project_id) || seen.has(s.project_id)) continue;
    seen.add(s.project_id);
    out.push(s);
  }
  return out;
}

/** The text the step_done tap stores: what is on the project now. */
export function stepTextToStore(text: string | null | undefined): string {
  return (text ?? '').trim();
}

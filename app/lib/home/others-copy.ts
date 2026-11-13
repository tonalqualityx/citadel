/**
 * The tab for other people's open work, and the words on a row. Plain, no dashes.
 *
 * The home screen avoids alarm words on purpose (copy.test.ts, tonight.test.ts and no-red.guard.test.ts ban them). The owner asked, in his own words
 * on 2026-11-13, for a tab called "overdue by others", so the tab's name is the ONE place the word may appear. It lives here, in this single
 * constant pair, and every component and the tile read it from here; nothing else on the screen (the payload key, the tile id, the empty
 * sentence, the row text, the test ids) uses the word.
 */
export const OTHERS_TAB_LABEL = 'overdue by others';
export const OTHERS_TAB_TITLE = 'Overdue by others';

/** A row's "how long": whole days past the end of the due day's grace, in plain words. */
export function pastDateDaysLabel(days: number): string {
  return days === 1 ? '1 day past its date' : `${days} days past its date`;
}

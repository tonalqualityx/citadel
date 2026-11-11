/**
 * Work stage G: the words on the owner's screen for the looks-finished card. Plain words, no em or en dash, and a stored title goes
 * through displayText. The home dash guard scans this folder.
 */

import { displayText } from '@/lib/home/copy';

const tasks = (n: number) => (n === 1 ? '1 task' : `${n} tasks`);

export const FINISHED_CARD = {
  /** `23 tasks look finished. Close them?` */
  title: (n: number) => (n === 1 ? '1 task looks finished. Close it?' : `${n} tasks look finished. Close them?`),
  whyNow: 'Each one has proof of its own that the work happened. Nothing closes until you tap.',
  ifIgnored: 'Stays here. Nothing closes on its own.',
  reason: 'A one-time look at your open tasks found proof the work is done.',
  closeTicked: 'Close the ticked ones',
  notNow: 'Not now',
  closeThis: 'Close this one',
  notFinished: 'Not finished',
  open: 'Open',
  securityHead: (n: number) => `Security tasks (${n}). Each needs its own tap.`,
  portalHead: (n: number) => `Shows in the client's portal (${n}). Closing shows it as done to them.`,
  untickedHead: (n: number) => `Done except for unticked items (${n}).`,
  orphanHead: (n: number) => `Filed by the old session sweep (${n}). Close them?`,
  closeOrphans: 'Close these',
  others: (n: number, name: string) => `${n} of ${displayText(name) || 'another person'}'s look finished. They were not asked.`,
} as const;

export const FINISHED_MESSAGES = {
  nothingClosed: 'Those tasks changed since the list was made, so nothing was closed.',
  notBatch: 'That one needs its own tap.',
  notOneTap: 'That one is closed from its own task page.',
  gone: 'That row is no longer on the list.',
  kept: 'Kept open. It will not be offered again for 90 days.',
  oneClosed: 'Closed it.',
} as const;

/** The Handled line for a batch: `Closed 23 tasks that looked finished.` */
export function closedLine(n: number): string {
  return `Closed ${tasks(n)} that looked finished.`;
}

/** The Handled line for one tap: `Closed "Title", which looked finished.` */
export function closedOneLine(title: string): string {
  return `Closed "${displayText(title) || 'a task'}", which looked finished.`;
}

/** The internal comment on a closed task. */
export function closeComment(evidenceLine: string): string {
  return `Closed from the looks-finished list: ${displayText(evidenceLine).replace(/[.]+$/, '')}.`;
}

export function skippedLine(n: number): string {
  return `${tasks(n)} changed since the list was made and stayed open.`;
}

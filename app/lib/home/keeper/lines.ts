/**
 * Slice 2a keeper, part 3: the plain sentences it writes into "Handled for you", one per kind with changes. Pure.
 * No dashes, and none of the words the screen never uses (copy-guard covers lib/home).
 */

import { KEEPER } from '../rules';
import { displayText } from '../copy';
import type { KeeperPlan, KeeperPlanLine } from '../types';
import { longDay, weekdayName } from './stagger';

/** Detail lines kept per action (the rest are summed in one last line). */
export const DETAIL_CAP = 60;

function capped(lines: string[]): string[] {
  if (lines.length <= DETAIL_CAP) return lines;
  const more = lines.length - DETAIL_CAP;
  return [...lines.slice(0, DETAIL_CAP), `and ${more} more`];
}

const noun = (n: number) => (n === 1 ? '1 task' : `${n} tasks`);
const waitingNoun = (n: number) => (n === 1 ? '1 waiting task' : `${n} waiting tasks`);

export function keeperLines(plan: Pick<KeeperPlan, 'date' | 'stagger' | 'dates'>): KeeperPlanLine[] {
  const lines: KeeperPlanLine[] = [];

  if (plan.stagger.length > 0) {
    const first = plan.stagger.reduce((a, b) => (a.day <= b.day ? a : b)).day;
    const start = first === plan.date ? 'today' : weekdayName(first);
    lines.push({
      action: 'keeper_stagger',
      text: `Gave ${waitingNoun(plan.stagger.length)} a day to come back, at most ${KEEPER.perDay} a day, starting ${start}.`,
      details: capped(plan.stagger.map((s) => `${displayText(s.title)}: back ${longDay(s.day)}`)),
    });
  }

  if (plan.dates.length > 0) {
    const read = plan.dates.filter((d) => d.outcome === 'read');
    const aside = plan.dates.filter((d) => d.outcome === 'set_aside');
    const details = [
      ...read.map((d) => `${displayText(d.title)}: now shows as a real date, ${longDay(d.due_date)}`),
      ...aside.filter((d) => d.client_facing).map((d) => `${displayText(d.title)}: set aside, client work, date was ${longDay(d.due_date)}`),
    ];
    lines.push({
      action: 'keeper_dates',
      text: `Read the dates on ${noun(plan.dates.length)}: ${read.length} now show as real dates, ${aside.length} ${aside.length === 1 ? 'was' : 'were'} set aside.`,
      details: capped(details),
    });
  }

  return lines;
}

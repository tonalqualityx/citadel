/**
 * Home screen Slice 8a: the one status sentence at the top of the project drawer. Pure; the
 * browser imports it. Checked in the plan's order, first match wins:
 *   1. Any of his items here is in Needs you now.
 *   2. The project waits on him (non-stale blockers he owns, folded by kind).
 *   3. The project waits on someone else (an open wait, a blocker, or the next step's owner).
 *   4. Moving (or quiet), from the last change.
 * Days are calendar days in words, dates are written out, no number from scoring.
 */

import { displayText } from '../copy';
import type { StatusInput } from './types';
import {
  BLOCKER_PHRASE_ORDER,
  blockerPhrase,
  calendarDays,
  daysText,
  joinPhrases,
  needsNowSentence,
  sinceWithDays,
} from './copy';

export function projectStatus(input: StatusInput): string | null {
  const { now, timeZone, userId, needsNow, card, waits } = input;

  // 1. Needs you now.
  if (needsNow > 0) return needsNowSentence(needsNow);

  // 2. Waiting on him.
  if (card) {
    const mine = card.blockers.filter((b) => b.kind !== 'stale' && b.owner.is_mike && blockerPhrase(b.kind, 1) !== null);
    if (mine.length > 0) {
      const counts = new Map<string, number>();
      let earliest = new Date(mine[0].since);
      for (const b of mine) {
        counts.set(b.kind, (counts.get(b.kind) ?? 0) + 1);
        const s = new Date(b.since);
        if (s.getTime() < earliest.getTime()) earliest = s;
      }
      const parts: string[] = [];
      for (const kind of BLOCKER_PHRASE_ORDER) {
        const n = counts.get(kind);
        if (n) parts.push(blockerPhrase(kind, n) as string);
      }
      return `Waiting on you since ${sinceWithDays(earliest, now, timeZone)}: ${joinPhrases(parts)}.`;
    }
  }

  // 3. Waiting on someone else: the earliest clock among open waits and blockers they hold.
  const others: Array<{ who: string; since: Date }> = [];
  for (const w of waits) others.push({ who: displayText(w.who), since: new Date(w.since) });
  if (card) {
    for (const b of card.blockers) {
      if (b.kind === 'stale' || b.owner.is_mike) continue;
      others.push({ who: displayText(b.owner.name), since: new Date(b.since) });
    }
  }
  if (others.length > 0) {
    const first = others.reduce((a, b) => (b.since.getTime() < a.since.getTime() ? b : a));
    return `Waiting on ${first.who} since ${sinceWithDays(first.since, now, timeZone)}.`;
  }
  if (card) {
    const step = card.next_step;
    const label = step.owner_label ?? (step.owner && step.owner.id !== userId ? step.owner.name : null);
    if (label) return `Waiting on ${displayText(label)}.`;
  }

  // 4. Moving, or quiet.
  if (card?.last_movement) {
    const n = calendarDays(new Date(card.last_movement.at), now, timeZone);
    const when = n === 0 ? 'today' : `${daysText(n)} ago`;
    return `${card.stale ? 'Quiet' : 'Moving'}. Last change ${when} by ${displayText(card.last_movement.who)}.`;
  }
  return null;
}

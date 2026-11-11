/**
 * Home screen Slice 8a: which of his items belong in a project's drawer, and where each one
 * sits. Pure over the Candidates selectHome already built, so nothing here scores anything or
 * reads another person's rows (loadHomeInputs only ever loads the signed-in owner's).
 */

import type { Candidate, SectionName } from '../select';
import { rankCompare } from '../select';
import { backOnText } from '../copy';
import type { HomeProjectItem } from './types';

const SECTION_RANK: Record<SectionName, number> = {
  needs_you_now: 0,
  working_on: 1,
  leads: 2,
  mail: 3,
  next: 4,
  rest: 5,
};

const SECTION_WORDS: Record<Exclude<SectionName, 'rest'>, string> = {
  needs_you_now: 'Needs you now',
  working_on: 'In progress',
  leads: 'A lead waiting',
  mail: 'A client email waiting',
  next: 'Ready for you',
};

const REST_WORDS: Record<string, string> = {
  waiting_turn: 'Waiting its turn',
  new_mail: 'Shows after one business day',
  older_threads: 'An older email',
  ventures: 'Another venture',
  bast_stopped: 'Bast stopped here',
  hands: 'In the Monday hands row',
};

export function whereOf(c: Candidate, timeZone: string): string {
  if (c.section !== 'rest') return SECTION_WORDS[c.section];
  if (c.parked && c.state?.view_at) return backOnText(c.state.view_at, timeZone);
  return REST_WORDS[c.restGroup ?? 'waiting_turn'] ?? 'Waiting its turn';
}

/** Parked ones sit last, soonest return first; every other order is the main list's own. */
export function drawerCompare(a: Candidate, b: Candidate): number {
  const ar = a.section === 'rest' && a.parked ? 6 : SECTION_RANK[a.section];
  const br = b.section === 'rest' && b.parked ? 6 : SECTION_RANK[b.section];
  if (ar !== br) return ar - br;
  if (ar === 6) {
    const at = a.state?.view_at?.getTime() ?? 0;
    const bt = b.state?.view_at?.getTime() ?? 0;
    if (at !== bt) return at - bt;
  }
  return rankCompare(a, b);
}

export function projectDrawerItems(candidates: Candidate[], projectId: string, timeZone: string): HomeProjectItem[] {
  return candidates
    .filter((c) => c.item.project?.id === projectId)
    // A done task folded under the sign-off is part of the sign-off row; a crisis or site row marked "not an emergency" is counted, not listed.
    // The project's own next step row is the drawer's "Next step" line, not one of his items.
    .filter((c) => c.kind !== 'step' && c.kind !== 'proposal')
    .filter((c) => c.restGroup !== 'review_pieces' && !(c.section === 'rest' && (c.kind === 'crisis' || c.kind === 'site')))
    .sort(drawerCompare)
    .map((c) => ({ item: c.item, where: whereOf(c, timeZone) }));
}

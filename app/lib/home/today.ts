/**
 * Home screen Slice 1: the Today proposal (plan 1.3 "Today", design 2C, task H4).
 *
 * Flow for GET /api/home (H6):
 *   1. sel = selectHome({ raw, states, now })
 *   2. day = the stored home_day for the zoned date, or, on the first load of the day,
 *      proposeDay(sel, raw.calendar_events, now), which H6 writes to home_day once
 *   3. assembleHomeResponse({ sel, day, ... }) builds the response; it renders the stored day
 *      with buildToday() (a new emergency lands at the top of Quick through
 *      applyEmergencyInsert, steps never reshuffle)
 *
 * The proposal:
 * - Quick (at most 3): emergencies outside the arc first, then in-view items of about 10
 *   minutes or less that have a person waiting or a hard date.
 * - The arc: the group of the highest-ranked item in view (its open arc, else its client,
 *   else its project, else "Indelible"), at most 4 proposed open steps. Steps Mike added
 *   never count against the 4 and are never dropped; a step he removed stays out of that
 *   group for 7 days.
 * - The size of the day against free time between 10:00 and 17:00 (New York), less 30
 *   minutes after each timed meeting. Proposed steps are cut from the end to fit, never below
 *   one step and never a step he added.
 * - Swap: the next two groups. Lighter: the group with the fewest minutes whose consequence
 *   class is no higher (no less consequential) than the proposed group's.
 */

import { zonedParts, zonedTimeToUtc } from '@/lib/waits/business-days';
import { asArcStepActions, withoutAddToArc } from './actions-for';
import {
  effortWords,
  emptySentences,
  reasonArcStep,
  screenDateLine,
  sizeLine,
  whyChoice,
  whyThisArc,
  zonedDateString,
} from './copy';
import { CAPS, DAY_WINDOW, ARC_REMOVED_SUPPRESS_DAYS, QUICK_MAX_MINUTES } from './rules';
import {
  emergencyCompare,
  rankCompare,
  type Candidate,
  type GroupInfo,
  type SelectResult,
} from './select';
import type {
  HomeArcChoice,
  HomeItem,
  HomeResponse,
  HomeSections,
  HomeToday,
  RawCalendarEvent,
  RawHomeDay,
} from './types';

/** What a stored home_day needs to be rendered. */
export type DayLike = Pick<RawHomeDay, 'group_key' | 'group_label' | 'arc_id' | 'quick_item_keys' | 'step_item_keys'>;

/** What proposeDay returns; H6 writes it to home_day. */
export interface ProposedDay extends DayLike {
  sized_minutes: number;
}

// ============================================================================
// Free time
// ============================================================================

/**
 * Free minutes today between 10:00 and 17:00 New York, less 30 minutes after each timed
 * meeting. All-day events are ignored. Overlapping meetings and recoveries are merged.
 */
export function freeMinutes(events: readonly RawCalendarEvent[], now: Date): number {
  const p = zonedParts(now);
  const start = zonedTimeToUtc(p.year, p.month, p.day, DAY_WINDOW.startHour, 0).getTime();
  const end = zonedTimeToUtc(p.year, p.month, p.day, DAY_WINDOW.endHour, 0).getTime();
  const recovery = DAY_WINDOW.recoveryMinutes * 60_000;
  const spans: [number, number][] = [];
  for (const e of events) {
    if (e.all_day) continue;
    const s = Math.max(start, e.starts_at.getTime());
    const f = Math.min(end, e.ends_at.getTime() + recovery);
    if (f > s) spans.push([s, f]);
  }
  spans.sort((a, b) => a[0] - b[0]);
  let busy = 0;
  let curS = -1;
  let curE = -1;
  for (const [s, f] of spans) {
    if (curE < 0 || s > curE) {
      if (curE >= 0) busy += curE - curS;
      curS = s;
      curE = f;
    } else {
      curE = Math.max(curE, f);
    }
  }
  if (curE >= 0) busy += curE - curS;
  return Math.max(0, Math.round((end - start - busy) / 60_000));
}

// ============================================================================
// Groups
// ============================================================================

const DAY_MS = 86_400_000;

function addedHere(c: Candidate, groupKey: string): boolean {
  const s = c.state;
  return !!s && !!s.arc_added_at && s.arc_added_group === groupKey;
}

function removedHere(c: Candidate, groupKey: string, now: Date): boolean {
  const s = c.state;
  return (
    !!s &&
    !!s.arc_removed_at &&
    s.arc_removed_group === groupKey &&
    now.getTime() - s.arc_removed_at.getTime() < ARC_REMOVED_SUPPRESS_DAYS * DAY_MS
  );
}

/**
 * The items a group proposes as steps, best first, before the cap of 4. An arc group takes
 * every open arc task of his (shown or not) plus in-view items of the same client; a client,
 * project or own-work group takes the in-view items filed under it. Parked items and steps he
 * removed in the last 7 days are left out, and so are steps he added (they are appended later).
 */
function proposedMembers(
  sel: SelectResult,
  group: GroupInfo,
  now: Date,
  exclude?: ReadonlySet<string>,
): Candidate[] {
  const clientKey = group.client ? `client:${group.client.id}` : null;
  return sel.candidates
    .filter((c) => {
      if (c.parked || addedHere(c, group.key) || removedHere(c, group.key, now)) return false;
      if (exclude && exclude.has(c.key)) return false;
      if (c.group.key === group.key) return group.arc ? c.arcId === group.arc.id || c.inView : c.inView;
      return group.arc !== null && clientKey !== null && c.inView && c.group.key === clientKey;
    })
    .sort(rankCompare);
}

/** Steps Mike added to this group that are still open, in the order he added them. */
function addedMembers(sel: SelectResult, group: GroupInfo): Candidate[] {
  return sel.candidates
    .filter((c) => !c.parked && addedHere(c, group.key))
    .sort((a, b) => (a.state?.arc_added_at?.getTime() ?? 0) - (b.state?.arc_added_at?.getTime() ?? 0));
}

function sumMinutes(cs: readonly Candidate[]): number {
  return cs.reduce((n, c) => n + c.minutes, 0);
}

function groupInfoFor(sel: SelectResult, key: string, label: string): GroupInfo {
  const found = sel.candidates.find((c) => c.group.key === key);
  if (found) return found.group;
  return { key, name: label, client: null, project: null, arc: null };
}

// ============================================================================
// Proposal
// ============================================================================

function chooseQuick(sel: SelectResult, excludeKeys: ReadonlySet<string>): Candidate[] {
  const pool = sel.candidates.filter((c) => c.inView && !excludeKeys.has(c.key));
  const emergencies = pool.filter((c) => c.rule !== null).sort(emergencyCompare);
  const short = pool
    .filter((c) => c.rule === null && c.minutes <= QUICK_MAX_MINUTES && (c.personWaiting || c.hardDate !== null))
    .sort(rankCompare);
  return [...emergencies, ...short].slice(0, CAPS.quick);
}

/**
 * The steps for a group: up to 4 proposed, then the ones Mike added (never counted against the
 * 4, never cut), cut from the end of the proposed ones until the day fits, never below one.
 * `exclude` keeps items out (Quick's rows, when a day is swapped).
 */
function composeSteps(
  sel: SelectResult,
  group: GroupInfo,
  fixedMinutes: number,
  free: number,
  now: Date,
  exclude?: ReadonlySet<string>,
): { all: Candidate[]; fit: Candidate[] } {
  const proposed = proposedMembers(sel, group, now, exclude).slice(0, CAPS.arcSteps);
  const added = addedMembers(sel, group).filter((a) => !exclude || !exclude.has(a.key));
  const all = [...proposed, ...added.filter((a) => !proposed.some((p) => p.key === a.key))];
  const addedKeys = new Set(added.map((a) => a.key));
  let fit = all;
  while (fit.length > 1 && fixedMinutes + sumMinutes(fit) > free) {
    let cut = -1;
    for (let i = fit.length - 1; i >= 0; i--) {
      if (!addedKeys.has(fit[i].key)) {
        cut = i;
        break;
      }
    }
    if (cut < 0) break;
    fit = fit.filter((_, i) => i !== cut);
  }
  return { all, fit };
}

/**
 * Propose the day: null when nothing is in view. Pure; H6 stores the result in home_day.
 * `now` fixes "today" for free time and for the 7-day removal window.
 */
export function proposeDay(
  sel: SelectResult,
  calendar: readonly RawCalendarEvent[],
  now: Date,
): ProposedDay | null {
  const top = sel.candidates.filter((c) => c.inView && !c.parked).sort(rankCompare)[0];
  if (!top) return null;
  const group = top.group;
  const free = freeMinutes(calendar, now);

  // Quick is chosen against the steps before the cut, then the steps are cut to fit around it.
  const pre = composeSteps(sel, group, 0, Number.POSITIVE_INFINITY, now);
  const quick = chooseQuick(sel, new Set(pre.all.map((s) => s.key)));
  const quickMinutes = sumMinutes(quick);
  const { fit: steps } = composeSteps(sel, group, quickMinutes, free, now);

  if (quick.length === 0 && steps.length === 0) return null;
  return {
    group_key: group.key,
    group_label: group.name,
    arc_id: group.arc?.id ?? null,
    quick_item_keys: quick.map((c) => c.key),
    step_item_keys: steps.map((c) => c.key),
    sized_minutes: quickMinutes + sumMinutes(steps),
  };
}

/**
 * Swap arc and Lighter today: the day rewritten to another group. Quick stays as it is; the
 * steps are the target group's proposal (his added steps for that group included, Quick's rows
 * left out), cut to fit. Returns null when the group has no items in view (H7 answers
 * unknown_group).
 */
export function dayForGroup(
  sel: SelectResult,
  toGroupKey: string,
  current: DayLike,
  calendar: readonly RawCalendarEvent[],
  now: Date,
): ProposedDay | null {
  const group = sel.candidates.find((c) => !c.parked && c.group.key === toGroupKey)?.group;
  if (!group) return null;
  const quickKeys = current.quick_item_keys.filter((k) => sel.byKey.has(k));
  const quickSet = new Set(quickKeys);
  const quickMinutes = sumMinutes(quickKeys.map((k) => sel.byKey.get(k) as Candidate));
  const { fit } = composeSteps(sel, group, quickMinutes, freeMinutes(calendar, now), now, quickSet);
  if (fit.length === 0) return null;
  return {
    group_key: group.key,
    group_label: group.name,
    arc_id: group.arc?.id ?? null,
    quick_item_keys: quickKeys,
    step_item_keys: fit.map((c) => c.key),
    sized_minutes: quickMinutes + sumMinutes(fit),
  };
}

/**
 * A new emergency on a later load: placed at the top of Quick, existing Quick rows keep their
 * order behind it, steps are not touched. An emergency already in Quick or a step is not added
 * twice. An item he removed from this day's arc in the last 7 days is not put into Quick. An
 * existing Quick row is never dropped to make room, so Quick can grow past 3 for a new emergency.
 */
export function applyEmergencyInsert(
  quickKeys: readonly string[],
  stepKeys: readonly string[],
  candidates: readonly Candidate[],
  groupKey: string,
  now: Date,
): string[] {
  const have = new Set([...quickKeys, ...stepKeys]);
  const fresh = candidates
    .filter((c) => c.rule !== null && !c.pinned && c.inView && !have.has(c.key) && !removedHere(c, groupKey, now))
    .sort(emergencyCompare)
    .map((c) => c.key);
  return fresh.length === 0 ? [...quickKeys] : [...fresh, ...quickKeys];
}

// ============================================================================
// Swap and Lighter
// ============================================================================

interface GroupOption {
  group: GroupInfo;
  steps: Candidate[];
  top: Candidate;
  klass: number;
  minutes: number;
}

function groupOptions(
  sel: SelectResult,
  currentKey: string,
  now: Date,
  quickKeys: ReadonlySet<string>,
): GroupOption[] {
  const current = sel.candidates.find((c) => c.group.key === currentKey)?.group;
  const currentClient = current?.client?.id ?? null;
  const seen = new Map<string, GroupInfo>();
  for (const c of sel.candidates) {
    if (c.parked || c.group.key === currentKey || !(c.inView || c.arcId !== null)) continue;
    seen.set(c.group.key, c.group);
  }
  const options: GroupOption[] = [];
  const clientsTaken = new Set<string>();
  const ordered: GroupOption[] = [];
  for (const group of seen.values()) {
    if (currentClient && group.client?.id === currentClient) continue;
    const steps = proposedMembers(sel, group, now, quickKeys).slice(0, CAPS.arcSteps);
    if (steps.length === 0) continue;
    ordered.push({
      group,
      steps,
      top: steps[0],
      klass: Math.min(...steps.map((s) => s.score.klass)),
      minutes: sumMinutes(steps),
    });
  }
  ordered.sort((a, b) => rankCompare(a.top, b.top));
  for (const o of ordered) {
    const cid = o.group.client?.id;
    if (cid) {
      if (clientsTaken.has(cid)) continue;
      clientsTaken.add(cid);
    }
    options.push(o);
  }
  return options;
}

function toChoice(o: GroupOption): HomeArcChoice {
  return {
    group_key: o.group.key,
    name: o.group.name,
    why: whyChoice(o.top.item.why_now),
    minutes: o.minutes,
    effort: effortWords(o.minutes),
  };
}

// ============================================================================
// Render a stored day
// ============================================================================

function asStep(c: Candidate, groupName: string): HomeItem {
  return {
    ...c.item,
    more_actions: asArcStepActions(c.item.more_actions),
    reason: c.shown ? c.item.reason : reasonArcStep(groupName),
  };
}

/**
 * HomeToday for a stored (or just proposed) day. Items that are done, gone or parked since the
 * day was written drop out; nothing is added to steps and the order is the stored order. A new
 * emergency is placed at the top of Quick. Returns null when nothing is left to show.
 */
export function buildToday(
  sel: SelectResult,
  day: DayLike,
  calendar: readonly RawCalendarEvent[],
  now: Date,
): HomeToday | null {
  const stepCands = day.step_item_keys
    .map((k) => sel.byKey.get(k))
    .filter((c): c is Candidate => !!c && !c.parked);
  const stepKeySet = new Set(stepCands.map((c) => c.key));
  const quickKeys = applyEmergencyInsert(day.quick_item_keys, day.step_item_keys, sel.candidates, day.group_key, now);
  const quickCands = quickKeys
    .map((k) => sel.byKey.get(k))
    .filter((c): c is Candidate => !!c && !c.parked && !stepKeySet.has(c.key));
  if (quickCands.length === 0 && stepCands.length === 0) return null;

  const group = groupInfoFor(sel, day.group_key, day.group_label);
  const name = day.group_label || group.name;
  const minutesTotal = sumMinutes(quickCands) + sumMinutes(stepCands);
  const free = freeMinutes(calendar, now);

  const topWhy = (stepCands[0] ?? quickCands[0]).item.why_now;
  const options = groupOptions(sel, day.group_key, now, new Set(quickCands.map((c) => c.key)));
  const currentClass = stepCands.length > 0 ? Math.min(...stepCands.map((c) => c.score.klass)) : 4;
  const currentMinutes = sumMinutes(stepCands);
  const lighter = options
    .filter((o) => o.klass <= currentClass && o.minutes < currentMinutes)
    .sort((a, b) => a.minutes - b.minutes || rankCompare(a.top, b.top))[0];

  return {
    group_key: day.group_key,
    arc_id: day.arc_id,
    arc_name: name,
    client: group.client,
    project: group.project,
    why: whyThisArc(topWhy, Math.max(0, stepCands.length - 1), group.client?.name ?? name),
    size_line: sizeLine(minutesTotal, free),
    minutes_total: minutesTotal,
    minutes_free: free,
    quick: quickCands.map((c) => c.item),
    steps: stepCands.map((c) => asStep(c, name)),
    added_keys: stepCands.filter((c) => addedHere(c, day.group_key)).map((c) => c.key),
    swap: options.slice(0, 2).map(toChoice),
    lighter: lighter ? toChoice(lighter) : null,
  };
}

/** Items that are already steps do not offer "Add to today's arc" again anywhere on the screen. */
export function applyArcMembership(sections: HomeSections, today: HomeToday | null): HomeSections {
  if (!today || today.steps.length === 0) return sections;
  const inArc = new Set(today.steps.map((s) => s.key));
  const fix = (items: HomeItem[]): HomeItem[] =>
    items.map((i) => (inArc.has(i.key) ? { ...i, more_actions: withoutAddToArc(i.more_actions) } : i));
  return {
    ...sections,
    needs_you_now: fix(sections.needs_you_now),
    working_on: fix(sections.working_on),
    leads: fix(sections.leads),
    mail: fix(sections.mail),
    next: fix(sections.next),
  };
}

// ============================================================================
// The response
// ============================================================================

export interface AssembleInput {
  sel: SelectResult;
  /** The stored home_day (or the ProposedDay H6 just stored), or null when nothing is in view. */
  day: DayLike | null;
  calendar: readonly RawCalendarEvent[];
  now: Date;
  /** His IANA zone from resolveUserTimezone. */
  timezone: string;
  user_id: string;
}

export function assembleHomeResponse(input: AssembleInput): HomeResponse {
  const { sel, day, calendar, now, timezone, user_id } = input;
  const today = day ? buildToday(sel, day, calendar, now) : null;
  return {
    generated_at: now.toISOString(),
    date: zonedDateString(now, timezone),
    timezone,
    screen_date_line: screenDateLine(now, timezone),
    user_id,
    today,
    sections: applyArcMembership(sel.sections, today),
    everything_else: sel.everything_else,
    empty: emptySentences(),
  };
}

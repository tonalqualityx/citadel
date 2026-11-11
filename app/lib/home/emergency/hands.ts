/**
 * Home screen Slice 6a: the Monday "This week's hands" row, the pure part.
 *
 * Mike's open tasks tagged `hands` or `credential-rotation` that have no hard date never sit in Next one by one. They
 * make one row, Monday 00:05 to Friday 23:59 his time, until they are done or he parks the row ("Not this week") to
 * next Monday 00:05.
 *
 * Pure: no I/O, no Prisma.
 */

import { roundMinutes } from '../copy';
import { HANDS_NO_SOP_LABEL, handsTitle } from './copy';

export const HANDS_TAGS: readonly string[] = ['hands', 'credential-rotation'];
export const HANDS_ITEM_KEY = 'hands:week';
/** The rest group a hands task gets, so the keeper (which only gives waiting items a day) never stages one. */
export const HANDS_REST_GROUP = 'hands';
/** A job with no estimate counts as this many minutes. */
export const HANDS_DEFAULT_MINUTES = 10;
/** The row starts at this minute after midnight on Monday. */
export const HANDS_START_MINUTE = 5;

export interface HandsTask {
  id: string;
  title: string;
  tags: string[];
  status: string;
  /** True when the task has a hard date (a real outside date). Those keep their own row. */
  has_hard_date: boolean;
  estimated_minutes: number | null;
  sop: { id: string; title: string } | null;
}

export function isHandsTask(t: Pick<HandsTask, 'tags' | 'status' | 'has_hard_date'>): boolean {
  if (t.status === 'done' || t.status === 'abandoned') return false;
  if (t.has_hard_date) return false;
  return t.tags.some((tag) => HANDS_TAGS.includes(tag));
}

/** The UTC instant of y-m-d h:mi on the wall clock of the zone (kept here so this pure module does not import act.ts). */
function zonedToUtc(y: number, m: number, d: number, h: number, mi: number, timeZone: string): Date {
  const wallAsUtcMs = (date: Date): number => {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    }).formatToParts(date);
    const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
    return Date.UTC(get('year'), get('month') - 1, get('day'), get('hour') === 24 ? 0 : get('hour'), get('minute'), get('second'));
  };
  const nominal = Date.UTC(y, m - 1, d, h, mi);
  let guess = nominal;
  for (let i = 0; i < 3; i++) guess = nominal - (wallAsUtcMs(new Date(guess)) - guess);
  return new Date(guess);
}

/** Day of week (0 Sunday to 6 Saturday) and minutes since midnight on his wall clock. */
function wall(now: Date, timeZone: string): { dow: number; minute: number; y: number; m: number; d: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    hourCycle: 'h23',
    weekday: 'short',
  }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  const y = Number(get('year'));
  const m = Number(get('month'));
  const d = Number(get('day'));
  return {
    dow: new Date(Date.UTC(y, m - 1, d)).getUTCDay(),
    minute: Number(get('hour')) * 60 + Number(get('minute')),
    y,
    m,
    d,
  };
}

/** Monday 00:05 through Friday 23:59 on his wall clock. */
export function inHandsWindow(now: Date, timeZone: string): boolean {
  const w = wall(now, timeZone);
  if (w.dow === 0 || w.dow === 6) return false;
  if (w.dow === 1 && w.minute < HANDS_START_MINUTE) return false;
  return true;
}

/** The next Monday 00:05 strictly after today on his wall clock (what "Not this week" parks to). */
export function nextHandsMonday(now: Date, timeZone: string): Date {
  const w = wall(now, timeZone);
  const ahead = ((8 - w.dow) % 7) || 7;
  const day = new Date(Date.UTC(w.y, w.m - 1, w.d + ahead));
  return zonedToUtc(day.getUTCFullYear(), day.getUTCMonth() + 1, day.getUTCDate(), 0, HANDS_START_MINUTE, timeZone);
}

export interface HandsJob {
  task_id: string;
  title: string;
  minutes: number;
}
export interface HandsGroup {
  /** The SOP id, or null for "No written steps". */
  sop_id: string | null;
  label: string;
  jobs: HandsJob[];
}
export interface HandsRow {
  key: typeof HANDS_ITEM_KEY;
  title: string;
  count: number;
  /** Minutes rounded for display. */
  minutes: number;
  groups: HandsGroup[];
}

export const jobMinutes = (t: Pick<HandsTask, 'estimated_minutes'>): number =>
  t.estimated_minutes && t.estimated_minutes > 0 ? t.estimated_minutes : HANDS_DEFAULT_MINUTES;

/** Groups by SOP (title order), "No written steps" last; jobs inside a group by title. */
export function groupHands(tasks: readonly HandsTask[]): HandsGroup[] {
  const by = new Map<string, HandsGroup>();
  for (const t of tasks) {
    const id = t.sop?.id ?? null;
    const k = id ?? '';
    let g = by.get(k);
    if (!g) {
      g = { sop_id: id, label: t.sop?.title ?? HANDS_NO_SOP_LABEL, jobs: [] };
      by.set(k, g);
    }
    g.jobs.push({ task_id: t.id, title: t.title, minutes: jobMinutes(t) });
  }
  const groups = Array.from(by.values());
  for (const g of groups) g.jobs.sort((a, b) => a.title.localeCompare(b.title));
  return groups.sort((a, b) => {
    if ((a.sop_id === null) !== (b.sop_id === null)) return a.sop_id === null ? 1 : -1;
    return a.label.localeCompare(b.label);
  });
}

/**
 * The row, or null: outside the window, parked (parkedUntil still ahead), or no jobs. Tasks that are not hands tasks
 * are ignored, so the caller may pass any of Mike's open tasks.
 */
export function handsRow(
  tasks: readonly HandsTask[],
  now: Date,
  timeZone: string,
  parkedUntil: Date | null = null
): HandsRow | null {
  if (!inHandsWindow(now, timeZone)) return null;
  if (parkedUntil && parkedUntil.getTime() > now.getTime()) return null;
  const mine = tasks.filter(isHandsTask);
  if (mine.length === 0) return null;
  const total = mine.reduce((s, t) => s + jobMinutes(t), 0);
  const minutes = roundMinutes(total);
  return { key: HANDS_ITEM_KEY, title: handsTitle(mine.length, minutes), count: mine.length, minutes, groups: groupHands(mine) };
}

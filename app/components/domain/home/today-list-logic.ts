/**
 * Pure helpers for the Today list (H9c): row meta lines, the add box's ranking and merging,
 * and arc reordering. No React, no network.
 */
import type { HomeItem } from '@/lib/home/types';

export const QUICK_HEADING = 'Quick, before you start';

export function arcHeading(arcName: string): string {
  return `Today's arc: ${arcName}`;
}

/** The muted second line of a Today row: effort, then the hard date or the age (as the preview). */
export function rowMeta(item: HomeItem): string {
  return [item.effort, item.hard_date || item.age].filter((part) => Boolean(part)).join('  ·  ');
}

/** "Why this arc: a security flag..." with the first letter lowered, as the preview does. */
export function whyLine(why: string): string {
  const text = why.trim().replace(/[.]+$/, '');
  if (!text) return '';
  return `Why this arc: ${text.charAt(0).toLowerCase()}${text.slice(1)}`;
}

/** True when the day's minutes exceed the free minutes (the size line already says so in words). */
export function dayOverflows(minutesTotal: number, minutesFree: number): boolean {
  return minutesTotal > minutesFree;
}

/** The item key the server uses for a task id. */
export function taskKey(taskId: string): string {
  return `task:${taskId.toLowerCase()}`;
}

function words(text: string): string[] {
  return text.toLowerCase().split(/\s+/).filter(Boolean);
}

function haystack(item: HomeItem): string {
  return [item.title, item.who ?? '', item.client?.name ?? '', item.project?.name ?? ''].join(' ').toLowerCase();
}

export const ADD_LOCAL_LIMIT = 5;

/**
 * Candidates from the payload for the add box: not excluded, every typed word found in the
 * title, who, client or project; same client first, then the payload's own order. An empty
 * query offers the first few (same client first) so the box is useful on focus.
 */
export function rankCandidates(
  candidates: HomeItem[],
  query: string,
  groupClientId: string | null,
  excludeKeys: readonly string[],
  limit: number = ADD_LOCAL_LIMIT,
): HomeItem[] {
  const excluded = new Set(excludeKeys);
  const needles = words(query);
  const seen = new Set<string>();
  const hits: { item: HomeItem; index: number }[] = [];
  candidates.forEach((item, index) => {
    if (excluded.has(item.key) || seen.has(item.key)) return;
    seen.add(item.key);
    const hay = haystack(item);
    if (needles.every((needle) => hay.includes(needle))) hits.push({ item, index });
  });
  const sameClient = (item: HomeItem) => (groupClientId && item.client?.id === groupClientId ? 0 : 1);
  hits.sort((a, b) => sameClient(a.item) - sameClient(b.item) || a.index - b.index);
  return hits.slice(0, limit).map((hit) => hit.item);
}

export interface AddOption {
  key: string;
  title: string;
  /** Muted second line, or ''. */
  meta: string;
  origin: 'in_view' | 'search';
}

export interface TaskHit {
  id: string;
  title: string;
}

/** Local matches first, then open tasks from the search that are not already offered or excluded. */
export function buildAddOptions(
  local: HomeItem[],
  remote: TaskHit[],
  excludeKeys: readonly string[],
  limit: number = 8,
): AddOption[] {
  const options: AddOption[] = local.map((item) => ({
    key: item.key,
    title: item.title,
    meta: [item.who, item.effort].filter(Boolean).join('  ·  '),
    origin: 'in_view' as const,
  }));
  const taken = new Set<string>([...excludeKeys, ...options.map((option) => option.key)]);
  for (const task of remote) {
    const key = taskKey(task.id);
    if (taken.has(key)) continue;
    taken.add(key);
    options.push({ key, title: task.title, meta: '', origin: 'search' });
  }
  return options.slice(0, limit);
}

/** Enter on text creates a task only when there is text and no option is offered. */
export function shouldCreate(query: string, options: AddOption[]): boolean {
  return query.trim().length > 0 && options.length === 0;
}

/** Move the entry at `from` to `to`; out-of-range indexes return the order unchanged. */
export function moveIndex<T>(list: readonly T[], from: number, to: number): T[] {
  const next = list.slice();
  if (from === to || from < 0 || to < 0 || from >= next.length || to >= next.length) return next;
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}

/** Move one key a step up (-1) or down (+1). */
export function moveKey(keys: readonly string[], key: string, direction: -1 | 1): string[] {
  const from = keys.indexOf(key);
  return moveIndex(keys, from, from + direction);
}

/** Steps in the given key order; keys not in `steps` are skipped, steps not in `keys` follow. */
export function orderSteps(steps: HomeItem[], keys: readonly string[]): HomeItem[] {
  const byKey = new Map(steps.map((step) => [step.key, step]));
  const ordered: HomeItem[] = [];
  for (const key of keys) {
    const step = byKey.get(key);
    if (step) {
      ordered.push(step);
      byKey.delete(key);
    }
  }
  return ordered.concat(Array.from(byKey.values()));
}

export function sameOrder(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((key, i) => key === b[i]);
}

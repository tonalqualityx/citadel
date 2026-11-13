/**
 * How far each requirement line of a project's plan has got, worked out from the tasks whose plan_item_ids include the line (Dox slice 2c).
 * Pure. Abandoned tasks do not count. A line with no live task is not started; every task done is done; some started or done is in progress.
 * Shown only when at least one task on the project carries plan_item_ids at all (otherwise the project predates the links and the plan says nothing).
 */
export type RequirementProgress = 'not_started' | 'in_progress' | 'done';

export interface LinkedTask {
  status: string;
  plan_item_ids: string[];
}

export const REQUIREMENT_PROGRESS_LABELS: Record<RequirementProgress, string> = {
  not_started: 'Not started',
  in_progress: 'In progress',
  done: 'Done',
};

/** True when at least one task carries a plan link: only then do the requirement lines show progress. */
export function projectHasPlanLinks(tasks: readonly LinkedTask[]): boolean {
  return tasks.some((t) => t.plan_item_ids.length > 0);
}

export function requirementProgress(tasks: readonly LinkedTask[], lineId: string): { progress: RequirementProgress; done: number; total: number } {
  const mine = tasks.filter((t) => t.status !== 'abandoned' && t.plan_item_ids.includes(lineId));
  const done = mine.filter((t) => t.status === 'done').length;
  if (mine.length === 0) return { progress: 'not_started', done: 0, total: 0 };
  if (done === mine.length) return { progress: 'done', done, total: mine.length };
  const started = mine.some((t) => t.status !== 'not_started' && t.status !== 'triage' && t.status !== 'blocked');
  return { progress: done > 0 || started ? 'in_progress' : 'not_started', done, total: mine.length };
}

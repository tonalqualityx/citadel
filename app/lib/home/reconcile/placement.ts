/**
 * Home Slice 9a: where Track it puts the work. Pure.
 *
 * The owner's rule (2026-11-11): anything that is a multi-step item is made into a project. Adding tasks to an existing live
 * project is fine; reusing a finished project is not. When in doubt, ask "add to X project or create a new one?".
 *  - "Live" means status ready, in_progress or review. A project with status done, cancelled, quote, queue or suspended is never offered.
 *  - More than one step (a next step, or later steps) always lands in a project.
 *  - 'add':   exactly one live project clearly fits (placement rules 1 to 3: the model named it, or the client has only that one, and its
 *             name or open tasks overlap the work). Buttons: Add to {name}, Start a new project.
 *  - 'ask':   the fit is not clear (more than one live candidate, a weak name overlap, or only a generic retainer project). The card
 *             asks "Add to {name} or start a new project?" with both buttons and no default.
 *  - 'new':   no live project. The only filing button is Start a project for it.
 *  - 'loose': a single finished one-off with no next step. Track it files the tasks to the client with no project.
 */
import { tokens } from './match';

export const LIVE_PROJECT_STATUSES: readonly string[] = ['ready', 'in_progress', 'review'];

export interface PlacementProject {
  id: string;
  name: string;
  status: string;
  type: string;
  is_retainer: boolean;
  /** Titles of its open tasks (a few). */
  open_task_titles: string[];
}

export interface PlacementInput {
  client_name: string;
  projects: PlacementProject[];
  /** The project id the model named, or null. */
  named_project_id: string | null;
  work: { title: string; done_title: string; next_step: string; later: string[] };
}

export type Placement =
  | { kind: 'add'; project: { id: string; name: string } }
  | { kind: 'ask'; project: { id: string; name: string } }
  | { kind: 'new' }
  | { kind: 'loose' };

const NO_STEP = /^(?:none|nothing|nothing more|nothing else|n\/a|no next step|no further steps?|done|all done)\.?$/i;

/** True when the tracked work has a next step or later steps (so it is a multi-step item). */
export function hasMoreSteps(work: PlacementInput['work']): boolean {
  const next = work.next_step.trim();
  return (next !== '' && !NO_STEP.test(next)) || work.later.some((l) => l.trim() !== '');
}

export const isLive = (p: Pick<PlacementProject, 'status'>): boolean => LIVE_PROJECT_STATUSES.includes(p.status);
export const isRetainerProject = (p: Pick<PlacementProject, 'type' | 'is_retainer'>): boolean => p.type === 'retainer' || p.is_retainer;

/** Whether the project's name (apart from the client's own name) or its open tasks overlap the work. */
export function overlapsWork(p: PlacementProject, clientName: string, work: PlacementInput['work']): boolean {
  const workText = [work.title, work.done_title, work.next_step, ...work.later].join(' ');
  const wt = new Set(tokens(workText));
  const skip = new Set([...tokens(clientName), 'retainer', 'project', 'maintenance', 'support', 'ongoing', 'general']);
  const nameHit = tokens(p.name).some((t) => !skip.has(t) && wt.has(t));
  if (nameHit) return true;
  const taskHits = new Set<string>();
  for (const title of p.open_task_titles) for (const t of tokens(title)) if (wt.has(t)) taskHits.add(t);
  return taskHits.size >= 2;
}

export function place(input: PlacementInput): Placement {
  const live = input.projects.filter(isLive);
  const multi = hasMoreSteps(input.work);
  if (live.length === 0) return multi ? { kind: 'new' } : { kind: 'loose' };

  const named = input.named_project_id ? live.find((p) => p.id === input.named_project_id) ?? null : null;
  const ref = (p: PlacementProject) => ({ id: p.id, name: p.name });
  const overlaps = (p: PlacementProject) => overlapsWork(p, input.client_name, input.work);

  // Rule 1: the model named a live project and its name or open tasks overlap the work.
  if (named && live.length === 1 && overlaps(named) && !isRetainerProject(named)) return { kind: 'add', project: ref(named) };
  // Rule 3: the client has exactly one live project, and it is not a generic retainer, and it overlaps the work.
  if (live.length === 1 && !isRetainerProject(live[0]) && overlaps(live[0])) return { kind: 'add', project: ref(live[0]) };
  // Rule 1 with more than one live project: the named one clearly fits only when no other live project overlaps as well.
  if (named && overlaps(named) && !isRetainerProject(named) && live.filter((p) => p !== named && overlaps(p)).length === 0) {
    return { kind: 'add', project: ref(named) };
  }
  // Not clear: ask. The one named is the one offered; else the best overlap; else the first by name.
  const best = named ?? live.find(overlaps) ?? [...live].sort((a, b) => a.name.localeCompare(b.name))[0];
  return { kind: 'ask', project: ref(best) };
}

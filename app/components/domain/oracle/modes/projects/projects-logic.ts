// Oracle Projects Tab Phase 4 — pure, dependency-free adapters (no React) for the
// Projects tab's two lenses (cards by project; grouped rows by kind) and its pick flow.
// Mirrors the needs-reshi-logic.ts pattern: this module only ever answers "given this
// data, what should render / what API calls does a pick need," never touches fetch,
// React state, or the clock.

import type { OracleProjectCard, OracleProjectMovement } from '@/lib/hooks/use-oracle-projects';
import type { Blocker, BlockerKind } from '@/lib/oracle/projects/blockers';

// ----------------------------------------------------------------------------------
// Card sort (also mirrors the route's own sort — see app/api/oracle/projects/route.ts.
// Duplicated here, not imported from the route, because this is client-side pure logic
// with its own test surface; the route sorts server-side before this ever runs, so in
// practice this is a no-op re-sort that keeps the UI correct even if a future caller
// hands it an unsorted list, e.g. after a local cache patch.)
// ----------------------------------------------------------------------------------

/**
 * Stalled-on-Mike projects first; within each bucket, quietest (highest days_quiet)
 * first. A project with no recorded movement EVER (days_quiet: null) is the maximally
 * quiet case — it sorts to the TOP of its bucket, not the bottom.
 */
export function sortProjectCards(cards: OracleProjectCard[]): OracleProjectCard[] {
  return [...cards].sort((a, b) => {
    if (a.stalled_on_mike !== b.stalled_on_mike) return a.stalled_on_mike ? -1 : 1;
    const aQuiet = a.days_quiet ?? Infinity;
    const bQuiet = b.days_quiet ?? Infinity;
    if (aQuiet === bQuiet) return 0;
    return bQuiet - aQuiet;
  });
}

/** Count of cards where stalled_on_mike is true. */
export function stalledCount(cards: OracleProjectCard[]): number {
  return cards.filter((c) => c.stalled_on_mike).length;
}

// ----------------------------------------------------------------------------------
// Kind lens grouping
// ----------------------------------------------------------------------------------

// Stable heading order and label per the spec. A kind with zero rows this fetch simply
// produces no group (see groupByKind below) rather than an empty heading.
export const KIND_HEADINGS: Record<BlockerKind, string> = {
  review: 'Reviews',
  decision: 'Decisions',
  clarification: 'Clarifications',
  client_approval: 'Client approvals',
  client_email: 'Client emails',
  mention: 'Mentions',
  session_ask: 'Session asks',
  someone_else: 'Nudges',
  meeting_risk: 'Meeting risk',
  stale: 'Stale',
};

export const KIND_ORDER: BlockerKind[] = [
  'review',
  'decision',
  'clarification',
  'client_approval',
  'client_email',
  'mention',
  'session_ask',
  'someone_else',
  'meeting_risk',
  'stale',
];

export interface KindLensRow {
  blocker: Blocker;
  project: { id: string; name: string };
}

export interface KindLensGroup {
  kind: BlockerKind;
  heading: string;
  rows: KindLensRow[];
}

/**
 * Turns GET /api/oracle/projects?lens=kind's `by_kind` map into ordered, labeled
 * groups. Kinds with no rows are omitted entirely (no empty headings).
 */
export function groupByKind(byKind: Record<string, KindLensRow[]>): KindLensGroup[] {
  const groups: KindLensGroup[] = [];
  for (const kind of KIND_ORDER) {
    const rows = byKind[kind];
    if (!rows || rows.length === 0) continue;
    groups.push({ kind, heading: KIND_HEADINGS[kind], rows });
  }
  return groups;
}

/** True once a group (or any single list) is dense enough to collapse to plain rows
 * instead of a spread-out card layout. */
export function shouldCollapseToRows(count: number): boolean {
  return count > 20;
}

// ----------------------------------------------------------------------------------
// Last-movement sentence
// ----------------------------------------------------------------------------------

/** "Mike commented 3 days ago." / "No recorded movement yet." — the card face and
 * drawer's one-line movement summary. `daysQuiet` is passed in (rather than recomputed)
 * because the API already derives it consistently with `movement.at`. */
export function lastMovementSentence(
  movement: OracleProjectMovement | null,
  daysQuiet: number | null
): string {
  if (!movement) return 'No recorded movement yet.';
  let when: string;
  if (daysQuiet === null) when = '';
  else if (daysQuiet <= 0) when = 'today';
  else if (daysQuiet === 1) when = 'yesterday';
  else when = `${daysQuiet} days ago`;
  return when ? `${movement.who} ${movement.what} ${when}.` : `${movement.who} ${movement.what}.`;
}

// ----------------------------------------------------------------------------------
// Pick-to-arc payload building
// ----------------------------------------------------------------------------------

/** A blocker whose source IS a task can be picked directly. Anything else (email,
 * session ask, mention, meeting risk, stale) has no task to attach/pick — one must be
 * created first, titled from the blocker and described from its detail text. */
export function isTaskBlocker(blocker: Pick<Blocker, 'source'>): boolean {
  return blocker.source.type === 'task';
}

export interface CreateTaskFromBlockerInput {
  title: string;
  description: string;
  project_id: string;
  assignee_id: string;
}

/** Builds the POST /api/tasks body for a non-task blocker being picked. Title/description
 * come straight from the blocker's own text — never invented — and it's always assigned
 * to Mike, since a non-task blocker (an email, a session ask, a mention, a meeting risk,
 * a stale project) is definitionally something only Mike can act on. */
export function createTaskPayloadFromBlocker(
  blocker: Pick<Blocker, 'title' | 'detail'>,
  projectId: string,
  mikeUserId: string
): CreateTaskFromBlockerInput {
  return {
    title: blocker.title,
    description: blocker.detail,
    project_id: projectId,
    assignee_id: mikeUserId,
  };
}

export interface SinglePickPlan {
  // True when this blocker has no backing task and one must be created first.
  needsTaskCreation: boolean;
  createTaskInput: CreateTaskFromBlockerInput | null;
  // Present only when needsTaskCreation is false — the task to attach/pick directly.
  existingTaskId: string | null;
  // Optional arc to attach the (existing or newly created) task to before picking.
  arcId: string | null;
}

/**
 * Single-blocker pick (BlockerRow's "pick" action / a single card's pick flow): the
 * caller executes this plan in order —
 *   1. if needsTaskCreation, POST /api/tasks with createTaskInput to get a task id
 *      (otherwise use existingTaskId)
 *   2. if arcId is set, PATCH /api/tasks/:id {arc_id: arcId}
 *   3. POST /api/today {item_type: 'task', task_id: <that id>}
 * This function only decides WHAT the plan is, never performs it — no fetch here.
 */
export function buildSinglePickPlan(
  blocker: Blocker,
  projectId: string,
  mikeUserId: string,
  arcId: string | null = null
): SinglePickPlan {
  if (isTaskBlocker(blocker)) {
    return {
      needsTaskCreation: false,
      createTaskInput: null,
      existingTaskId: blocker.source.id,
      arcId,
    };
  }
  return {
    needsTaskCreation: true,
    createTaskInput: createTaskPayloadFromBlocker(blocker, projectId, mikeUserId),
    existingTaskId: null,
    arcId,
  };
}

export interface MultiPickSelection {
  blocker: Blocker;
  project: { id: string; name: string };
}

export interface MultiPickTaskToCreate {
  blockerId: string;
  input: CreateTaskFromBlockerInput;
}

export interface MultiPickPlan {
  arcName: string;
  // Set only when every selected blocker belongs to the SAME project — an arc spanning
  // multiple projects is created with no project_id, never guessed at one of them.
  projectId: string | null;
  // Blockers that already have a task — attached to the new arc as-is.
  existingTaskIds: string[];
  // Non-task blockers — a task is created for each (see createTaskPayloadFromBlocker),
  // then attached exactly like an existing one.
  tasksToCreate: MultiPickTaskToCreate[];
}

/**
 * Multi-select pick (KindLens's "New arc…" action): the caller executes this plan —
 *   1. POST /api/arcs {name: arcName, project_id: projectId} -> new arc id
 *   2. POST /api/tasks for each entry in tasksToCreate -> resolves each blockerId to a
 *      real task id
 *   3. PATCH /api/tasks/:id {arc_id: <new arc id>} for every id in existingTaskIds PLUS
 *      every task id created in step 2
 *   4. ONE POST /api/today {item_type: 'arc', arc_id: <new arc id>}
 */
export function buildMultiPickPlan(selection: MultiPickSelection[], arcName: string, mikeUserId: string): MultiPickPlan {
  const projectIds = new Set(selection.map((s) => s.project.id));
  const projectId = projectIds.size === 1 ? [...projectIds][0] : null;

  const existingTaskIds: string[] = [];
  const tasksToCreate: MultiPickTaskToCreate[] = [];
  for (const { blocker, project } of selection) {
    if (isTaskBlocker(blocker)) {
      existingTaskIds.push(blocker.source.id);
    } else {
      tasksToCreate.push({
        blockerId: blocker.id,
        input: createTaskPayloadFromBlocker(blocker, project.id, mikeUserId),
      });
    }
  }

  return { arcName, projectId, existingTaskIds, tasksToCreate };
}

/** KindLens's "New arc…" default name: heading name + today's date, e.g. "Reviews —
 * Sep 4, 2026". `now` is passed in (never read from the clock here) to keep this pure. */
export function defaultArcNameForHeading(heading: string, now: Date): string {
  const date = now.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  return `${heading} — ${date}`;
}

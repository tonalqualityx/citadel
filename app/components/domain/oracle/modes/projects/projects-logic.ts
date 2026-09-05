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

// Spec polish (2026-09-04) — heading order per the spec: Decisions, Clarifications,
// Reviews, Client approvals, Client emails, Mentions, Session asks, Nudges, Meeting
// risk, Stale. Previously 'review' sorted first (Reviews, Decisions, Clarifications, ...)
// — fixed to match the spec's exact sequence.
export const KIND_ORDER: BlockerKind[] = [
  'decision',
  'clarification',
  'review',
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
 * LOW-12: builds the SAME `by_kind` shape the `?lens=kind` route param returns, purely
 * client-side, from the project-lens response's own `projects` array — each project
 * already carries its full `blockers` list regardless of which lens fetched it (the
 * route's own by_kind branch does exactly this same regroup server-side; see
 * app/api/oracle/projects/route.ts). Deriving it here means the tab never needs a
 * SECOND network round-trip (and second query-cache entry) just to switch lenses — the
 * by-kind view renders from data already in hand, so toggling lenses never blanks the
 * screen waiting on a fresh fetch.
 */
export function deriveByKind(
  projects: Array<Pick<OracleProjectCard, 'id' | 'name' | 'blockers'>>
): Record<string, KindLensRow[]> {
  const byKind: Record<string, KindLensRow[]> = {};
  for (const project of projects) {
    for (const blocker of project.blockers) {
      const list = byKind[blocker.kind] ?? [];
      list.push({ blocker, project: { id: project.id, name: project.name } });
      byKind[blocker.kind] = list;
    }
  }
  return byKind;
}

/**
 * Turns GET /api/oracle/projects?lens=kind's `by_kind` map (or deriveByKind's own
 * client-side equivalent) into ordered, labeled groups. Kinds with no rows are omitted
 * entirely (no empty headings).
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
// Next-step source sentence (drawer only — card anatomy fix)
// ----------------------------------------------------------------------------------

/** The next step's source stamp, as a full plain sentence. Card anatomy fix: this used
 * to render on the card face as a dash-joined fragment ("— Bast, 3:45 PM"), making a
 * 7th face element out of what the spec calls a six-element card. It now lives only in
 * the drawer's next-step section (see ProjectDrawer.tsx), and reads as a sentence — no
 * dash, per the writing standard's dash law. */
export function nextStepSourceSentence(nextStep: {
  source: 'graph' | 'bast' | 'mike' | 'none';
  at: string | null;
}): string | null {
  if (nextStep.source === 'mike') return "Mike set this next step himself.";
  if (nextStep.source === 'bast') {
    if (!nextStep.at) return 'Bast suggested this next step.';
    const time = new Date(nextStep.at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
    return `Bast suggested this next step at ${time}.`;
  }
  if (nextStep.source === 'graph') return 'This next step came from the task graph.';
  return null;
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

// ----------------------------------------------------------------------------------
// Approval loop (Phase 5) — deriving the task an ApprovalPanel should target
// ----------------------------------------------------------------------------------

/**
 * The task ApprovalPanel should attach a new/edited approval request to. Task-sourced
 * blockers (review, decision, clarification, mention, someone_else) carry the task id
 * directly on `source.id`. `client_approval`'s source is the ApprovalRequest itself
 * (`source.type === 'approval_request'`) — its `source.url` is always `/tasks/{task_id}`
 * (see lib/oracle/projects/blockers.ts's classifyClientApprovals), so the task id is
 * the URL's last path segment. Every other kind (email, session ask, meeting risk,
 * stale) has no task to approve anything against — null.
 */
export function getBlockerTaskId(blocker: Pick<Blocker, 'kind' | 'source'>): string | null {
  if (blocker.source.type === 'task') return blocker.source.id;
  if (blocker.source.type === 'approval_request') {
    const segments = blocker.source.url.split('/').filter(Boolean);
    return segments[segments.length - 1] ?? null;
  }
  return null;
}

/** ApprovalPanel renders for client_approval blockers (the loop's own kind) and review
 * blockers (a done task waiting on Mike's review may ALSO need the client's sign-off) —
 * never the other eight kinds, which have no client-approval angle at all. */
export function showsApprovalPanel(blocker: Pick<Blocker, 'kind'>): boolean {
  return blocker.kind === 'client_approval' || blocker.kind === 'review';
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
  // Optional arc to attach the (existing or newly created) task to before picking. Null
  // when the task is ALREADY in a different arc and the caller didn't opt to move it
  // (see alreadyInArc below) — the pick still goes through, just without the re-home.
  arcId: string | null;
  // MEDIUM-3: set when the blocker's task is already attached to a DIFFERENT arc than
  // the one this pick targets, and the caller did NOT opt to move it. The dialog shows
  // "Already in arc X" and the attach step is skipped (arcId above comes back null) —
  // never silently re-homed.
  alreadyInArc: { id: string; name: string } | null;
}

/**
 * Single-blocker pick (BlockerRow's "pick" action / a single card's pick flow): the
 * caller executes this plan in order —
 *   1. if needsTaskCreation, POST /api/tasks with createTaskInput to get a task id
 *      (otherwise use existingTaskId)
 *   2. if arcId is set, PATCH /api/tasks/:id {arc_id: arcId}
 *   3. POST /api/today {item_type: 'task', task_id: <that id>}
 * This function only decides WHAT the plan is, never performs it — no fetch here.
 *
 * `moveIfAlreadyInArc` (default false) is the dialog's "move it here instead" checkbox:
 * when the task already belongs to a DIFFERENT arc than `arcId` and this is false, the
 * re-home is skipped (arcId comes back null, alreadyInArc reports what was skipped) but
 * the pick itself still proceeds. A brand-new task (needsTaskCreation) can never already
 * be in an arc, so alreadyInArc is always null on that branch.
 */
export function buildSinglePickPlan(
  blocker: Blocker,
  projectId: string,
  mikeUserId: string,
  arcId: string | null = null,
  moveIfAlreadyInArc: boolean = false
): SinglePickPlan {
  if (isTaskBlocker(blocker)) {
    const currentArc = blocker.arc;
    const conflicts = !!(arcId && currentArc && currentArc.id !== arcId);
    const skippedAsAlreadyInArc = conflicts && !moveIfAlreadyInArc;
    const alreadyInArc = skippedAsAlreadyInArc ? currentArc : null;
    const effectiveArcId = skippedAsAlreadyInArc ? null : arcId;
    return {
      needsTaskCreation: false,
      createTaskInput: null,
      existingTaskId: blocker.source.id,
      arcId: effectiveArcId,
      alreadyInArc,
    };
  }
  return {
    needsTaskCreation: true,
    createTaskInput: createTaskPayloadFromBlocker(blocker, projectId, mikeUserId),
    existingTaskId: null,
    arcId,
    alreadyInArc: null,
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

export interface MultiPickSkippedAlreadyInArc {
  blockerId: string;
  title: string;
  arc: { id: string; name: string };
}

export interface MultiPickPlan {
  arcName: string;
  // Set only when every selected blocker belongs to the SAME project — an arc spanning
  // multiple projects is created with no project_id, never guessed at one of them.
  projectId: string | null;
  // Blockers that already have a task and are safe to attach to the new arc as-is (never
  // already in a DIFFERENT arc, or moveAlreadyArced was true).
  existingTaskIds: string[];
  // Non-task blockers — a task is created for each (see createTaskPayloadFromBlocker),
  // then attached exactly like an existing one.
  tasksToCreate: MultiPickTaskToCreate[];
  // MEDIUM-3: task-sourced blockers already attached to a DIFFERENT arc, left out of
  // existingTaskIds because moveAlreadyArced was false. The caller reports these as
  // "Already in arc X, skipped" rather than silently re-homing them.
  skippedAlreadyInArc: MultiPickSkippedAlreadyInArc[];
}

/**
 * Multi-select pick (KindLens's "New arc…" action): the caller executes this plan —
 *   1. POST /api/arcs {name: arcName, project_id: projectId} -> new arc id
 *   2. POST /api/tasks for each entry in tasksToCreate -> resolves each blockerId to a
 *      real task id
 *   3. PATCH /api/tasks/:id {arc_id: <new arc id>} for every id in existingTaskIds PLUS
 *      every task id created in step 2
 *   4. ONE POST /api/today {item_type: 'arc', arc_id: <new arc id>}
 *
 * `moveAlreadyArced` (default false) mirrors the single-pick dialog's "move it here
 * instead" checkbox, applied to the whole selection: a task-sourced blocker already
 * attached to a DIFFERENT arc is left out of existingTaskIds (and out of the new arc
 * entirely) unless this is true.
 */
export function buildMultiPickPlan(
  selection: MultiPickSelection[],
  arcName: string,
  mikeUserId: string,
  moveAlreadyArced: boolean = false
): MultiPickPlan {
  const projectIds = new Set(selection.map((s) => s.project.id));
  const projectId = projectIds.size === 1 ? [...projectIds][0] : null;

  const existingTaskIds: string[] = [];
  const tasksToCreate: MultiPickTaskToCreate[] = [];
  const skippedAlreadyInArc: MultiPickSkippedAlreadyInArc[] = [];
  for (const { blocker, project } of selection) {
    if (isTaskBlocker(blocker)) {
      if (blocker.arc && !moveAlreadyArced) {
        skippedAlreadyInArc.push({ blockerId: blocker.id, title: blocker.title, arc: blocker.arc });
        continue;
      }
      existingTaskIds.push(blocker.source.id);
    } else {
      tasksToCreate.push({
        blockerId: blocker.id,
        input: createTaskPayloadFromBlocker(blocker, project.id, mikeUserId),
      });
    }
  }

  return { arcName, projectId, existingTaskIds, tasksToCreate, skippedAlreadyInArc };
}

/** KindLens's "New arc…" default name: heading name + today's date, e.g. "Reviews, Sep
 * 4 2026". `now` is passed in (never read from the clock here) to keep this pure. This
 * string is persisted verbatim as the new Arc's name, so the dash law applies here same
 * as any reader-facing copy — a comma joins the heading and date, never a dash. */
export function defaultArcNameForHeading(heading: string, now: Date): string {
  const month = now.toLocaleDateString('en-US', { month: 'short' });
  const day = now.getDate();
  const year = now.getFullYear();
  return `${heading}, ${month} ${day} ${year}`;
}

// Oracle Projects Tab Phase 2 — the hybrid next-step line's two pure halves: the
// task-graph candidate (findNextStepCandidate) and the merge that picks which of
// mike/bast/graph actually wins for display (mergeNextStep). No Prisma, no clock reads.

export interface NextStepCandidateTask {
  id: string;
  title: string;
  status: string;
  blocked_by_ids: string[];
  phase_sort: number;
  sort_order: number;
  created_at: string; // ISO
  assignee_id: string | null;
  assignee_name: string | null;
}

export interface NextStepCandidateResult {
  task: NextStepCandidateTask;
  assignee: { id: string; name: string } | null;
}

// Judgment call: the spec's status filter is "(not_started, ready)". This schema's
// TaskStatus enum has no 'ready' value (not_started / in_progress / review / done /
// blocked / abandoned) — a task whose blockers are all done is auto-unblocked back to
// not_started by lib/services/dependencies.ts's healBlockedTasks/unblockEligibleDependents
// already, so in practice this filters to not_started tasks whose blockers are (also,
// redundantly) confirmed done here. 'ready' is kept in the literal set anyway: it costs
// nothing, matches the spec text exactly, and means this keeps working with no code
// change if a future TaskStatus value named 'ready' is ever added.
const CANDIDATE_STATUSES = new Set(['not_started', 'ready']);

/**
 * First task, in phase-sort / sort_order / created_at order, whose status is a
 * candidate status AND whose blocked_by tasks are ALL status `done` (a lighter bar than
 * the real dependency-gate's approval-aware isBlockerSatisfied — this is a display
 * suggestion, not the thing that actually unblocks a task). A blocked_by id that isn't
 * present in `tasks` at all is treated as NOT done (fail safe, never surfaces a task
 * whose blocker status can't be confirmed).
 */
export function findNextStepCandidate(tasks: NextStepCandidateTask[]): NextStepCandidateResult | null {
  const doneIds = new Set(tasks.filter((t) => t.status === 'done').map((t) => t.id));

  const eligible = tasks.filter(
    (t) => CANDIDATE_STATUSES.has(t.status) && t.blocked_by_ids.every((id) => doneIds.has(id))
  );
  if (eligible.length === 0) return null;

  eligible.sort((a, b) => {
    if (a.phase_sort !== b.phase_sort) return a.phase_sort - b.phase_sort;
    if (a.sort_order !== b.sort_order) return a.sort_order - b.sort_order;
    return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
  });

  const task = eligible[0];
  return {
    task,
    assignee: task.assignee_id ? { id: task.assignee_id, name: task.assignee_name ?? 'Unassigned' } : null,
  };
}

export type NextStepSource = 'graph' | 'bast' | 'mike';

export interface ProjectNextStepFields {
  next_step_text: string | null;
  next_step_owner: { id: string; name: string } | null;
  next_step_source: NextStepSource | null;
  next_step_at: string | null; // ISO
}

export interface NextStepLine {
  text: string;
  owner: { id: string; name: string } | null;
  source: NextStepSource | 'none';
  at: string | null; // ISO
}

/**
 * Which next-step line actually wins, in order: Mike's explicit override (sticky until
 * changed) beats Bast's nightly/on-demand inference, which beats the live graph
 * candidate computed just now, which beats "no ready task" when nothing is eligible.
 * Mike's/Bast's stored lines are read as-is (whatever was written when that source last
 * ran) — the graph branch is always computed FRESH from `candidate`, never from a
 * possibly-stale stored next_step_text with source='graph'.
 */
export function mergeNextStep(
  project: ProjectNextStepFields,
  candidate: NextStepCandidateResult | null
): NextStepLine {
  if (project.next_step_source === 'mike' && project.next_step_text) {
    return { text: project.next_step_text, owner: project.next_step_owner, source: 'mike', at: project.next_step_at };
  }

  if (project.next_step_source === 'bast' && project.next_step_text) {
    return { text: project.next_step_text, owner: project.next_step_owner, source: 'bast', at: project.next_step_at };
  }

  if (candidate) {
    const assigneeText = candidate.assignee ? ` (${candidate.assignee.name})` : ' (unassigned)';
    return {
      text: `Next: ${candidate.task.title}${assigneeText}`,
      owner: candidate.assignee,
      source: 'graph',
      at: candidate.task.created_at,
    };
  }

  return {
    text: 'No ready task: everything is blocked, done, or already in progress',
    owner: null,
    source: 'none',
    at: null,
  };
}

/**
 * A review Mike (or any person) has done counts for everything it covered (Mike, 2026-11-24: "Reviewing the preview is
 * basically reviewing them all at once. They shouldn't all have a pending review. The review is the task itself that I've
 * already done.").
 *
 * A REVIEW STEP is a review card (lib/tasks/review-card.ts) or the person's final step task Dox files with the
 * `finalize-step` tag. The tasks it COVERS are found by walking its blocked_by edges transitively, staying inside the
 * review step's own project and never walking through another review step (that one already covered its own pieces).
 * When the review step has no project, only its direct blockers count.
 *
 * Pure: the graph is read through an injected loader, so this file touches no database. The walk keeps a visited set
 * (cycle safe) and has no cap on how many tasks it returns. The database loader lives in review-coverage-db.ts.
 */

import { isReviewCard } from '@/lib/tasks/review-card';

export const FINALIZE_STEP_TAG = 'finalize-step';

/** A review step: a review card, or the person's final step task (tag `finalize-step`). */
export function isReviewStep(tags: readonly string[] | null | undefined): boolean {
  return isReviewCard(tags) || (tags ?? []).includes(FINALIZE_STEP_TAG);
}

/** One task in the graph. `edges` are the ids on the side being walked (blocked_by going back, blocking going forward). */
export interface CoverageNode {
  id: string;
  project_id: string | null;
  tags: string[];
  status: string;
  is_deleted: boolean;
  edges: string[];
}

/** Loads the nodes for the given ids; ids that do not exist are simply absent from the result. */
export type NodeLoader = (ids: string[]) => Promise<Map<string, CoverageNode>>;

/**
 * Every task the review step covers (the review step itself is not in the result). `loadBack` returns nodes whose edges
 * are blocked_by ids. Level by level so a loader can batch.
 */
export async function coveredByReviewStep(reviewId: string, loadBack: NodeLoader): Promise<CoverageNode[]> {
  const root = (await loadBack([reviewId])).get(reviewId);
  if (!root || root.is_deleted) return [];
  const visited = new Set<string>([reviewId]);
  const covered: CoverageNode[] = [];
  let frontier = root.edges.filter((id) => !visited.has(id));
  frontier.forEach((id) => visited.add(id));
  let direct = true;
  while (frontier.length > 0) {
    const nodes = await loadBack(frontier);
    const next: string[] = [];
    for (const id of frontier) {
      const n = nodes.get(id);
      if (!n || n.is_deleted) continue;
      if (isReviewStep(n.tags)) continue; // an earlier review step covered its own pieces
      if (root.project_id === null) {
        if (direct) covered.push(n); // no project: direct blockers only, never walked further
        continue;
      }
      if (n.project_id !== root.project_id) continue;
      covered.push(n);
      for (const e of n.edges) {
        if (!visited.has(e)) {
          visited.add(e);
          next.push(e);
        }
      }
    }
    frontier = next;
    direct = false;
  }
  return covered;
}

/**
 * Whether some review step (not abandoned, not deleted) covers the task: walking blocking edges forward within the
 * task's project, never through another review step, reaches one. `loadForward` returns nodes whose edges are blocking ids.
 * Equivalent to asking coveredByReviewStep for every review step, without enumerating them.
 */
export async function isCoveredByReviewStep(taskId: string, loadForward: NodeLoader): Promise<boolean> {
  const root = (await loadForward([taskId])).get(taskId);
  if (!root || root.is_deleted) return false;
  const visited = new Set<string>([taskId]);
  let frontier = root.edges.filter((id) => !visited.has(id));
  frontier.forEach((id) => visited.add(id));
  let direct = true;
  while (frontier.length > 0) {
    const nodes = await loadForward(frontier);
    const next: string[] = [];
    for (const id of frontier) {
      const n = nodes.get(id);
      if (!n || n.is_deleted) continue;
      if (isReviewStep(n.tags)) {
        if (n.status === 'abandoned') continue;
        if (n.project_id !== null && n.project_id === root.project_id) return true;
        if (n.project_id === null && direct) return true;
        continue; // never walk through a review step
      }
      if (root.project_id === null || n.project_id !== root.project_id) continue;
      for (const e of n.edges) {
        if (!visited.has(e)) {
          visited.add(e);
          next.push(e);
        }
      }
    }
    frontier = next;
    direct = false;
  }
  return false;
}

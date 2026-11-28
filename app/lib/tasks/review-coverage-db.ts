/**
 * Database side of review coverage (the pure walk is in review-coverage.ts).
 *
 * - approveCoveredByReview: a person finished a review step, so everything it covered that is done and not yet approved is
 *   approved at that moment, then its dependents are released the same way an approval releases them.
 * - isCoveredByReviewStep / loaders: used to drop the per-piece needs_review stamp when a review step is the review.
 * Every function here is a side step: callers catch and log, a failure never fails the write that triggered it.
 */

import { prisma } from '@/lib/db/prisma';
import { BOT_USER_IDS, MIKE_USER_ID } from '@/lib/oracle/projects/gate-constants';
import { logUpdate } from '@/lib/services/activity';
import { unblockEligibleDependents } from '@/lib/services/dependencies';
import { looksLikeSecurity } from '@/lib/home/keeper/approve-sweep';
import {
  coveredByReviewStep,
  isCoveredByReviewStep,
  isReviewStep,
  type CoverageNode,
  type NodeLoader,
} from '@/lib/tasks/review-coverage';

export const REVIEW_COVERED_SOURCE = 'review-step-covered';

type Direction = 'blocked_by' | 'blocking';

function loader(direction: Direction): NodeLoader {
  return async (ids) => {
    const rows = (await prisma.task.findMany({
      where: { id: { in: ids } },
      select: {
        id: true,
        project_id: true,
        tags: true,
        status: true,
        is_deleted: true,
        [direction]: { select: { id: true } },
      },
    })) as unknown as Array<Omit<CoverageNode, 'edges'> & Record<Direction, { id: string }[]>>;
    const map = new Map<string, CoverageNode>();
    for (const r of rows ?? []) {
      map.set(r.id, { id: r.id, project_id: r.project_id, tags: r.tags ?? [], status: r.status, is_deleted: r.is_deleted, edges: (r[direction] ?? []).map((e) => e.id) });
    }
    return map;
  };
}

/** The tasks the review step covers, with the fields the callers need. */
export async function loadCovered(reviewId: string) {
  const covered = await coveredByReviewStep(reviewId, loader('blocked_by'));
  if (covered.length === 0) return [];
  const rows = await prisma.task.findMany({
    where: { id: { in: covered.map((c) => c.id) }, is_deleted: false },
    select: { id: true, title: true, tags: true, status: true, approved: true, needs_review: true },
  });
  return rows ?? [];
}

/** True when some review step covers this task. A failed lookup reads as not covered (the stamp is kept). */
export async function isCovered(taskId: string): Promise<boolean> {
  try {
    return await isCoveredByReviewStep(taskId, loader('blocking'));
  } catch (e) {
    console.error('review coverage lookup failed', taskId, e);
    return false;
  }
}

/**
 * A person finished review step `review`: approve every covered task that is done and unapproved. A security-looking task
 * is approved only when the person is Mike (a security flag always reaches him). Returns the ids approved. Bots never trigger this.
 */
export async function approveCoveredByReview(
  review: { id: string; tags: string[] | null | undefined },
  actorId: string,
): Promise<string[]> {
  if (BOT_USER_IDS.includes(actorId) || !isReviewStep(review.tags)) return [];
  const covered = await loadCovered(review.id);
  const approved: string[] = [];
  const now = new Date();
  for (const t of covered) {
    if (t.status !== 'done' || t.approved) continue;
    // A security flag always reaches Mike (handbook section 3 item 8): only his own finished review approves one.
    if (actorId !== MIKE_USER_ID && looksLikeSecurity(t.title, t.tags ?? [])) continue;
    const res = await prisma.task.updateMany({
      where: { id: t.id, approved: false, status: 'done', is_deleted: false },
      data: { approved: true, approved_at: now, approved_by_id: actorId },
    });
    if (res.count !== 1) continue;
    approved.push(t.id);
    await logUpdate(actorId, 'task', t.id, t.title, {
      approved: { from: false, to: true },
      approval_source: { from: null, to: REVIEW_COVERED_SOURCE },
      review_task_id: { from: null, to: review.id },
    });
    // Same release an approval gets in the PATCH route: dependents held on this task's review become workable.
    await unblockEligibleDependents(t.id);
  }
  return approved;
}

/**
 * A review step was just made the dependent of new blockers: covered tasks that are done, not approved and still
 * stamped lose the stamp (the review step is the review). Security-looking tasks keep it. No approvals are invented.
 */
export async function dropStampsCoveredBy(reviewId: string): Promise<string[]> {
  const covered = await loadCovered(reviewId);
  const cleared: string[] = [];
  for (const t of covered) {
    if (t.status !== 'done' || t.approved || !t.needs_review) continue;
    if (looksLikeSecurity(t.title, t.tags ?? [])) continue;
    await prisma.task.update({ where: { id: t.id }, data: { needs_review: false } });
    cleared.push(t.id);
    await unblockEligibleDependents(t.id);
  }
  return cleared;
}

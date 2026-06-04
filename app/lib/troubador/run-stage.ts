import { prisma } from '@/lib/db/prisma';

// Article statuses that mean an article is still being written or reviewed.
const WRITING_STATUSES = [
  'pending_research',
  'researched',
  'drafting',
  'in_review',
  'needs_revision',
];

/**
 * Keep a run's production-phase stage in sync with its articles:
 *  - in_production : any live article is still being written/reviewed
 *  - publishing    : all live articles are approved/scheduled (nothing left to write)
 *  - done          : every live article is published or postponed
 *
 * "Live" = not dropped. Only acts while the run is already in the production phase
 * (in_production | publishing | done) — it never pulls a run back past the interview.
 */
export async function recomputeProductionStage(runId: string): Promise<void> {
  const run = await prisma.troubadorRun.findUnique({
    where: { id: runId },
    select: { stage: true },
  });
  if (!run || !['in_production', 'publishing', 'done'].includes(run.stage)) return;

  const articles = await prisma.article.findMany({
    where: { run_id: runId, is_deleted: false, status: { not: 'dropped' } },
    select: { status: true },
  });
  if (articles.length === 0) return;

  let target: 'in_production' | 'publishing' | 'done';
  if (articles.every((a) => a.status === 'published' || a.status === 'postponed')) {
    target = 'done';
  } else if (articles.some((a) => WRITING_STATUSES.includes(a.status))) {
    target = 'in_production';
  } else {
    // All remaining live articles are approved/scheduled — ready to publish.
    target = 'publishing';
  }

  if (target !== run.stage) {
    await prisma.troubadorRun.update({ where: { id: runId }, data: { stage: target } });
  }
}

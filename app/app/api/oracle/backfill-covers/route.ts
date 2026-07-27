import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { requireAuth, requireRole } from '@/lib/auth/middleware';
import { handleApiError } from '@/lib/api/errors';
import { resolveCoverUrl } from '@/lib/services/cover-assignment';

// Clarity Phase 7 (Seeing Stone Reckoning) — the card-covers backfill. Assigns cover_url
// (client og:image where resolvable, else a deterministic pool pick — see
// lib/services/cover-assignment.ts) to every existing arc and every OPEN task that doesn't
// already have one. Run once against production after the covers deploy lands (bearer
// ~/.citadel-token); safe to re-run any time after — it only ever touches rows where
// cover_url IS NULL, so a second run is a fast no-op. Admin-only (same gate as the rest of
// the Oracle surface).
//
// "Open" task = not done, not abandoned, not soft-deleted — a done/abandoned task never
// surfaces on a kanban card again, so backfilling its cover would be pure waste. Arcs have
// no such distinction (an arc's own card can still render after close, e.g. in a closed
// list), so every arc missing a cover gets one, regardless of status.
const OPEN_TASK_STATUSES = ['not_started', 'in_progress', 'review', 'blocked'] as const;

// Bounded concurrency: each item may attempt a real network fetch (client og:image), so
// this never fires hundreds of requests at once against arbitrary client sites.
const BATCH_SIZE = 8;

async function backfillInBatches<T extends { id: string; client_id: string | null }>(
  items: T[],
  apply: (item: T, coverUrl: string) => Promise<void>
): Promise<number> {
  let done = 0;
  for (let i = 0; i < items.length; i += BATCH_SIZE) {
    const batch = items.slice(i, i + BATCH_SIZE);
    await Promise.all(
      batch.map(async (item) => {
        const coverUrl = await resolveCoverUrl({ itemId: item.id, clientId: item.client_id });
        await apply(item, coverUrl);
        done += 1;
      })
    );
  }
  return done;
}

export async function POST(request: NextRequest) {
  try {
    const auth = await requireAuth();
    requireRole(auth, ['admin']);

    const { searchParams } = new URL(request.url);
    const dryRun = searchParams.get('dry_run') === 'true';

    const arcsMissing = await prisma.arc.findMany({
      where: { cover_url: null },
      select: { id: true, client_id: true },
    });
    const tasksMissing = await prisma.task.findMany({
      where: { cover_url: null, is_deleted: false, status: { in: [...OPEN_TASK_STATUSES] } },
      select: { id: true, client_id: true },
    });

    let arcsBackfilled = 0;
    let tasksBackfilled = 0;

    if (!dryRun) {
      arcsBackfilled = await backfillInBatches(arcsMissing, (arc, coverUrl) =>
        prisma.arc.update({ where: { id: arc.id }, data: { cover_url: coverUrl } }).then(() => undefined)
      );
      tasksBackfilled = await backfillInBatches(tasksMissing, (task, coverUrl) =>
        prisma.task.update({ where: { id: task.id }, data: { cover_url: coverUrl } }).then(() => undefined)
      );
    }

    const [arcsRemainingNull, tasksRemainingNull] = dryRun
      ? [arcsMissing.length, tasksMissing.length]
      : await Promise.all([
          prisma.arc.count({ where: { cover_url: null } }),
          prisma.task.count({
            where: { cover_url: null, is_deleted: false, status: { in: [...OPEN_TASK_STATUSES] } },
          }),
        ]);

    return NextResponse.json({
      dry_run: dryRun,
      arcs_found_missing: arcsMissing.length,
      tasks_found_missing: tasksMissing.length,
      arcs_backfilled: arcsBackfilled,
      tasks_backfilled: tasksBackfilled,
      // The acceptance criterion (Seeing Stone Reckoning, Phase 7): zero cover-less cards.
      arcs_remaining_null: arcsRemainingNull,
      tasks_remaining_null: tasksRemainingNull,
    });
  } catch (error) {
    return handleApiError(error);
  }
}

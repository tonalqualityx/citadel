import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { requireAuth } from '@/lib/auth/middleware';
import { handleApiError } from '@/lib/api/errors';

// Oracle Projects Tab Phase 3 — read by the machine-side job's `--requested` poll
// (~/.claude/tools/citadel-projects/next-step-refresh.py, every 2 minutes during
// business hours) to find projects with a queued on-demand refresh. Bearer auth, any
// authenticated user — a cheap GET, not a Mike-only action. Oldest request first, so a
// backlog (if the poll ever falls behind) drains in request order.
export async function GET() {
  try {
    await requireAuth();

    const projects = await prisma.project.findMany({
      where: { next_step_refresh_requested_at: { not: null }, is_deleted: false },
      select: { id: true, next_step_refresh_requested_at: true },
      orderBy: { next_step_refresh_requested_at: 'asc' },
    });

    return NextResponse.json({
      ids: projects.map((p) => p.id),
      requests: projects.map((p) => ({
        id: p.id,
        requested_at: p.next_step_refresh_requested_at?.toISOString() ?? null,
      })),
    });
  } catch (error) {
    return handleApiError(error);
  }
}

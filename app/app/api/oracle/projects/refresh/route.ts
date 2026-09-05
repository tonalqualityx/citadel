import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { requireAuth, requireRole } from '@/lib/auth/middleware';
import { handleApiError } from '@/lib/api/errors';

// Oracle Projects Tab Phase 3 — queues an on-demand next-step refresh for EVERY
// in-progress, contracted (type=project) project at once. Same queue/poll contract as
// the single-project route: stamps next_step_refresh_requested_at, the machine-side
// job's --requested poll does the actual work.
export async function POST() {
  try {
    const auth = await requireAuth();
    requireRole(auth, ['pm', 'admin']);

    const now = new Date();
    const result = await prisma.project.updateMany({
      where: { type: 'project', status: 'in_progress', is_deleted: false },
      data: { next_step_refresh_requested_at: now },
    });

    return NextResponse.json({ requested_at: now.toISOString(), count: result.count }, { status: 202 });
  } catch (error) {
    return handleApiError(error);
  }
}

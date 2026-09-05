import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { requireAuth, requireRole } from '@/lib/auth/middleware';
import { handleApiError, ApiError } from '@/lib/api/errors';

// Oracle Projects Tab Phase 3 — queues an on-demand next-step refresh for one project.
// Stamps next_step_refresh_requested_at; the machine-side job
// (~/.claude/tools/citadel-projects/next-step-refresh.sh --requested, polling every 2
// minutes during business hours) picks it up, infers a fresh line, and clears the stamp
// via PUT .../next-step/write. This route does NOT itself run the inference — 202 means
// "queued," not "done."
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireAuth();
    requireRole(auth, ['pm', 'admin']);
    const { id: projectId } = await params;

    const project = await prisma.project.findUnique({
      where: { id: projectId, is_deleted: false },
      select: { id: true },
    });
    if (!project) {
      throw new ApiError('Project not found', 404);
    }

    const now = new Date();
    await prisma.project.update({
      where: { id: projectId },
      data: { next_step_refresh_requested_at: now },
    });

    return NextResponse.json({ requested_at: now.toISOString() }, { status: 202 });
  } catch (error) {
    return handleApiError(error);
  }
}

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { requireAuth, requireRole } from '@/lib/auth/middleware';
import { handleApiError, ApiError } from '@/lib/api/errors';

// GET /api/tasks/:id/receipts - the trail of a staged change: staged, approved, approval_voided, live, send.
// Staff only (pm, admin). Oldest first.
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireAuth();
    requireRole(auth, ['pm', 'admin']);
    const { id } = await params;
    const task = await prisma.task.findUnique({
      where: { id },
      select: { id: true, is_deleted: true, staging_preview_url: true, staging_commit_sha: true, approved_preview_url: true, approved_commit_sha: true },
    });
    if (!task || task.is_deleted) throw new ApiError('Task not found', 404);
    const receipts = await prisma.taskReceipt.findMany({ where: { task_id: id }, orderBy: { created_at: 'asc' } });
    return NextResponse.json({
      task_id: id,
      staging: { preview_url: task.staging_preview_url, commit_sha: task.staging_commit_sha },
      approved: { preview_url: task.approved_preview_url, commit_sha: task.approved_commit_sha },
      receipts,
    });
  } catch (error) {
    return handleApiError(error);
  }
}

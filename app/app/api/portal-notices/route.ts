import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { requireAuth, requireRole } from '@/lib/auth/middleware';
import { handleApiError, ApiError } from '@/lib/api/errors';
import { cancelStaleNotices, NOTICE_HOLD_SECONDS } from '@/lib/portal/notices';
import type { PortalNoticeStatus } from '@prisma/client';

// GET /api/portal-notices?status=queued&older_than=120 (portal phase B slice 2)
// The outbox the machine-side sender (approval-sender.py, process_portal_notices) drains. pm and
// admin only, like the approval-requests routes the sender already uses.
//
// For status=queued two things happen before anything is returned:
//  1. Stale notices are cancelled: a notice whose reply was unflagged, made internal or deleted
//     during the hold is cancelled, and one that still carries other replies is rebuilt without it.
//  2. The hold: only notices that have been quiet for at least `older_than` seconds are returned
//     (default and minimum useful value 120). A newer reply to the same task and contact is
//     absorbed into the still-queued notice and restarts the quiet period, so one burst is one email.
const VALID = new Set<PortalNoticeStatus>(['queued', 'sending', 'sent', 'failed', 'cancelled']);
const LIMIT = 50;

export async function GET(request: NextRequest) {
  try {
    const auth = await requireAuth();
    requireRole(auth, ['pm', 'admin']);
    const sp = new URL(request.url).searchParams;
    const status = sp.get('status') ?? 'queued';
    if (!VALID.has(status as PortalNoticeStatus)) throw new ApiError(`Invalid status: ${status}`, 400);
    const olderParam = sp.get('older_than');
    const olderThan = olderParam === null ? NOTICE_HOLD_SECONDS : z.coerce.number().int().min(0).max(86400).parse(olderParam);
    const taskId = sp.get('task_id');
    if (taskId && !z.string().uuid().safeParse(taskId).success) throw new ApiError(`Invalid task_id: ${taskId}`, 400);

    if (status === 'queued') await cancelStaleNotices();

    const cutoff = new Date(Date.now() - olderThan * 1000);
    const rows = await prisma.portalNotice.findMany({
      where: {
        status: status as PortalNoticeStatus,
        ...(taskId ? { task_id: taskId } : {}),
        ...(status === 'queued' ? { updated_at: { lte: cutoff } } : {}),
      },
      orderBy: { created_at: 'asc' },
      take: LIMIT,
    });
    return NextResponse.json({ notices: rows });
  } catch (error) {
    return handleApiError(error);
  }
}

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { requireAuth } from '@/lib/auth/middleware';
import { handleApiError } from '@/lib/api/errors';
import { formatTaskResponse } from '@/lib/api/formatters';
import { TaskStatus } from '@prisma/client';

/**
 * GET /api/review-tasks?assignee_id={id}&for_user_id={id}&limit={number}
 *
 * Returns tasks awaiting review, matching the dashboard's "awaiting review" view exactly.
 * Supports OR filter: reviewer_id = userId OR reviewer_id = null
 *
 * Query parameters:
 * - assignee_id: UUID of the user who completed the task (optional for PM/Admin, ignored for Tech)
 * - for_user_id: UUID of the user whose review queue to show (optional, default: self)
 *                Tech users can only query for themselves
 *                PM/Admin can query for any user
 * - limit: Number of tasks to return (default: 50, max: 100)
 */
export async function GET(request: NextRequest) {
  try {
    const auth = await requireAuth();
    const { searchParams } = new URL(request.url);

    // Parse query parameters
    const assigneeIdParam = searchParams.get('assignee_id');
    const forUserIdParam = searchParams.get('for_user_id');
    const limit = parseInt(searchParams.get('limit') || '50', 10);

    // Determine which user's review queue to fetch
    // - Tech users can only see their own review queue
    // - PM/Admin can view any user's review queue via for_user_id param
    let targetUserId: string;

    if (auth.role === 'tech') {
      // Tech users are restricted to their own review queue
      if (forUserIdParam && forUserIdParam !== auth.userId) {
        return NextResponse.json(
          { error: 'Tech users can only view their own review queue' },
          { status: 403 }
        );
      }
      targetUserId = auth.userId;
    } else {
      // PM/Admin can query any user's review queue
      targetUserId = forUserIdParam || auth.userId;
    }

    // Validate limit
    const validatedLimit = Math.min(Math.max(limit, 1), 100);

    // Awaiting review where clause - EXACTLY matches dashboard logic
    const awaitingReviewWhere = {
      is_deleted: false,
      status: TaskStatus.done,
      needs_review: true,
      approved: false,
      OR: [
        { reviewer_id: null },           // Unassigned - visible to all PM/Admin
        { reviewer_id: targetUserId },   // Assigned to target user
      ],
      // Optional: filter by who completed the work (assignee)
      ...(assigneeIdParam && { assignee_id: assigneeIdParam }),
    };

    // Fetch awaiting review tasks with the same includes as dashboard
    const [awaitingReview, total] = await Promise.all([
      prisma.task.findMany({
        where: awaitingReviewWhere,
        include: {
          assignee: {
            select: { id: true, name: true, email: true, avatar_url: true },
          },
          client: { select: { id: true, name: true } },
          site: { select: { id: true, name: true } },
          project: {
            select: {
              id: true,
              name: true,
              client: { select: { id: true, name: true } },
              site: { select: { id: true, name: true } },
            },
          },
          reviewer: {
            select: { id: true, name: true, email: true, avatar_url: true },
          },
          approved_by: { select: { id: true, name: true } },
          function: { select: { id: true, name: true } },
          sop: { select: { id: true, title: true } },
          created_by: { select: { id: true, name: true } },
          blocked_by: {
            select: { id: true, title: true, status: true, assignee_id: true, assignee: { select: { id: true, name: true } } },
          },
          blocking: {
            select: { id: true, title: true, status: true, assignee_id: true, assignee: { select: { id: true, name: true } } },
          },
          time_entries: {
            where: { is_deleted: false },
            select: { duration: true },
          },
        },
        // Same orderBy as dashboard (updated_at asc - oldest first)
        orderBy: { updated_at: 'asc' },
        take: validatedLimit,
      }),
      prisma.task.count({ where: awaitingReviewWhere }),
    ]);

    // Format tasks using the same formatter as other endpoints
    const formattedTasks = awaitingReview.map(formatTaskResponse);

    return NextResponse.json({
      tasks: formattedTasks,
      total,
      limit: validatedLimit,
      for_user_id: targetUserId,
    });
  } catch (error) {
    return handleApiError(error);
  }
}

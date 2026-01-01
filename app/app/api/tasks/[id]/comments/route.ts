import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { requireAuth } from '@/lib/auth/middleware';
import { handleApiError, ApiError } from '@/lib/api/errors';
import { createNotification } from '@/lib/services/notifications';

const createCommentSchema = z.object({
  content: z.string().min(1, 'Comment cannot be empty').max(10000),
});

// Format comment for response
function formatComment(comment: any) {
  return {
    id: comment.id,
    task_id: comment.task_id,
    user_id: comment.user_id,
    user: comment.user
      ? {
          id: comment.user.id,
          name: comment.user.name,
          email: comment.user.email,
          avatar_url: comment.user.avatar_url,
        }
      : null,
    content: comment.content,
    created_at: comment.created_at,
    updated_at: comment.updated_at,
  };
}

// GET /api/tasks/[id]/comments - List comments for a task
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireAuth();
    const { id: taskId } = await params;

    // Verify task exists and user has access
    const task = await prisma.task.findUnique({
      where: { id: taskId, is_deleted: false },
      include: {
        project: { select: { id: true, status: true } },
      },
    });

    if (!task) {
      throw new ApiError('Task not found', 404);
    }

    // Tech users can only see comments on tasks they have access to
    if (auth.role === 'tech') {
      let hasAccess = false;

      // Ad-hoc tasks assigned to the user
      if (!task.project_id && task.assignee_id === auth.userId) {
        hasAccess = true;
      }
      // Tasks in projects where user is a team member
      else if (task.project_id) {
        const isTeamMember = await prisma.projectTeamAssignment.findFirst({
          where: {
            project_id: task.project_id,
            user_id: auth.userId,
          },
        });
        if (isTeamMember) {
          hasAccess = true;
        }
      }

      if (!hasAccess) {
        throw new ApiError('Task not found', 404);
      }
    }

    // Fetch comments
    const comments = await prisma.comment.findMany({
      where: {
        task_id: taskId,
        is_deleted: false,
      },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true,
            avatar_url: true,
          },
        },
      },
      orderBy: { created_at: 'asc' },
    });

    return NextResponse.json({
      comments: comments.map(formatComment),
      count: comments.length,
    });
  } catch (error) {
    return handleApiError(error);
  }
}

// POST /api/tasks/[id]/comments - Create a comment
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireAuth();
    const { id: taskId } = await params;
    const body = await request.json();

    const data = createCommentSchema.parse(body);

    // Verify task exists and user has access
    const task = await prisma.task.findUnique({
      where: { id: taskId, is_deleted: false },
      include: {
        project: { select: { id: true, status: true, name: true } },
        assignee: { select: { id: true } },
      },
    });

    if (!task) {
      throw new ApiError('Task not found', 404);
    }

    // Tech users can only comment on tasks they have access to
    if (auth.role === 'tech') {
      let hasAccess = false;

      if (!task.project_id && task.assignee_id === auth.userId) {
        hasAccess = true;
      } else if (task.project_id) {
        const isTeamMember = await prisma.projectTeamAssignment.findFirst({
          where: {
            project_id: task.project_id,
            user_id: auth.userId,
          },
        });
        if (isTeamMember) {
          hasAccess = true;
        }
      }

      if (!hasAccess) {
        throw new ApiError('Task not found', 404);
      }
    }

    // Create the comment
    const comment = await prisma.comment.create({
      data: {
        task_id: taskId,
        user_id: auth.userId,
        content: data.content,
      },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true,
            avatar_url: true,
          },
        },
      },
    });

    // Get the commenter's name for notification
    const commenter = await prisma.user.findUnique({
      where: { id: auth.userId },
      select: { name: true },
    });

    // Send notification to task assignee if different from commenter
    if (task.assignee_id && task.assignee_id !== auth.userId) {
      await createNotification({
        userId: task.assignee_id,
        type: 'comment_added',
        title: `New comment on "${task.title}"`,
        message: `${commenter?.name || 'Someone'} commented: "${data.content.substring(0, 100)}${data.content.length > 100 ? '...' : ''}"`,
        entityType: 'task',
        entityId: taskId,
      });
    }

    return NextResponse.json(formatComment(comment), { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}

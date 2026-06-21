import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { requireAuth } from '@/lib/auth/middleware';
import { handleApiError, ApiError } from '@/lib/api/errors';
import { createNotification } from '@/lib/services/notifications';
import { clientVisibleCommentWhere } from '@/lib/comments/visibility';

const createCommentSchema = z.object({
  content: z.string().min(1, 'Comment cannot be empty').max(10000),
  mentioned_user_ids: z.array(z.string().uuid()).max(50).optional(),
  // Team/Bast-only: mark a comment as an internal note hidden from clients.
  // Defaults to client-visible (false). Client questions must stay false.
  is_internal: z.boolean().optional(),
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
    mentioned_user_ids: comment.mentioned_user_ids ?? [],
    is_internal: comment.is_internal ?? false,
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

    // Client-facing surfaces (audience=client) never see internal/team notes.
    const audience = request.nextUrl.searchParams.get('audience');
    const baseWhere = { task_id: taskId, is_deleted: false };
    const where =
      audience === 'client' ? clientVisibleCommentWhere(baseWhere) : baseWhere;

    // Fetch comments
    const comments = await prisma.comment.findMany({
      where,
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

    // Resolve mentioned users: keep only real, active users, and never the author.
    // Mentions are team-only by construction — this route is team-auth (requireAuth), so a
    // client-portal session never reaches here. Clients can comment but cannot tag. Mention
    // suggestions are scoped per task via GET /api/tasks/[id]/mention-suggestions.
    const requestedMentionIds = [...new Set(data.mentioned_user_ids ?? [])].filter(
      (uid) => uid !== auth.userId
    );
    const mentionedUsers =
      requestedMentionIds.length > 0
        ? await prisma.user.findMany({
            where: { id: { in: requestedMentionIds }, is_active: true },
            select: { id: true },
          })
        : [];
    const mentionedUserIds = mentionedUsers.map((u) => u.id);

    // Create the comment
    const comment = await prisma.comment.create({
      data: {
        task_id: taskId,
        user_id: auth.userId,
        content: data.content,
        mentioned_user_ids: mentionedUserIds,
        is_internal: data.is_internal ?? false,
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

    const snippet = `${data.content.substring(0, 100)}${data.content.length > 100 ? '...' : ''}`;

    // Notify each mentioned user.
    for (const mentionedId of mentionedUserIds) {
      await createNotification({
        userId: mentionedId,
        type: 'task_mentioned',
        title: `${commenter?.name || 'Someone'} mentioned you on "${task.title}"`,
        message: `"${snippet}"`,
        entityType: 'task',
        entityId: taskId,
      });
    }

    // Send notification to task assignee if different from commenter — but skip if they
    // were already notified via a mention above (no double notification).
    if (
      task.assignee_id &&
      task.assignee_id !== auth.userId &&
      !mentionedUserIds.includes(task.assignee_id)
    ) {
      await createNotification({
        userId: task.assignee_id,
        type: 'comment_added',
        title: `New comment on "${task.title}"`,
        message: `${commenter?.name || 'Someone'} commented: "${snippet}"`,
        entityType: 'task',
        entityId: taskId,
      });
    }

    return NextResponse.json(formatComment(comment), { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}

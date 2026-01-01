import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { requireAuth } from '@/lib/auth/middleware';
import { handleApiError, ApiError } from '@/lib/api/errors';

const updateCommentSchema = z.object({
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

// GET /api/comments/[id] - Get a single comment
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireAuth();
    const { id } = await params;

    const comment = await prisma.comment.findUnique({
      where: { id, is_deleted: false },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true,
            avatar_url: true,
          },
        },
        task: {
          select: {
            id: true,
            project_id: true,
            assignee_id: true,
          },
        },
      },
    });

    if (!comment) {
      throw new ApiError('Comment not found', 404);
    }

    // Tech users can only see comments on tasks they have access to
    if (auth.role === 'tech') {
      let hasAccess = false;

      if (!comment.task.project_id && comment.task.assignee_id === auth.userId) {
        hasAccess = true;
      } else if (comment.task.project_id) {
        const isTeamMember = await prisma.projectTeamAssignment.findFirst({
          where: {
            project_id: comment.task.project_id,
            user_id: auth.userId,
          },
        });
        if (isTeamMember) {
          hasAccess = true;
        }
      }

      if (!hasAccess) {
        throw new ApiError('Comment not found', 404);
      }
    }

    return NextResponse.json(formatComment(comment));
  } catch (error) {
    return handleApiError(error);
  }
}

// PATCH /api/comments/[id] - Update a comment
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireAuth();
    const { id } = await params;
    const body = await request.json();

    const data = updateCommentSchema.parse(body);

    // Find the comment
    const existingComment = await prisma.comment.findUnique({
      where: { id, is_deleted: false },
      include: {
        task: {
          select: {
            id: true,
            project_id: true,
            assignee_id: true,
          },
        },
      },
    });

    if (!existingComment) {
      throw new ApiError('Comment not found', 404);
    }

    // Only the comment author can edit their own comment
    // PM/Admin can also edit any comment
    if (existingComment.user_id !== auth.userId && auth.role === 'tech') {
      throw new ApiError('You can only edit your own comments', 403);
    }

    // Update the comment
    const comment = await prisma.comment.update({
      where: { id },
      data: { content: data.content },
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

    return NextResponse.json(formatComment(comment));
  } catch (error) {
    return handleApiError(error);
  }
}

// DELETE /api/comments/[id] - Soft delete a comment
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireAuth();
    const { id } = await params;

    // Find the comment
    const existingComment = await prisma.comment.findUnique({
      where: { id, is_deleted: false },
    });

    if (!existingComment) {
      throw new ApiError('Comment not found', 404);
    }

    // Only the comment author can delete their own comment
    // PM/Admin can also delete any comment
    if (existingComment.user_id !== auth.userId && auth.role === 'tech') {
      throw new ApiError('You can only delete your own comments', 403);
    }

    // Soft delete
    await prisma.comment.update({
      where: { id },
      data: { is_deleted: true },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    return handleApiError(error);
  }
}

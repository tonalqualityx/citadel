import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { requireAuth } from '@/lib/auth/middleware';
import { handleApiError, ApiError } from '@/lib/api/errors';
import { createNotification } from '@/lib/services/notifications';
import { findMentionedUserIds } from '@/lib/utils/mentions';
import { afterReplyRetracted, afterReplyShared, assertShareable } from '@/lib/portal/share-reply';

const updateCommentSchema = z
  .object({
    content: z.string().min(1, 'Comment cannot be empty').max(10000).optional(),
    // Team toggle: hide/show a comment from clients. Client-authored comments
    // must always remain client-visible (enforced where clients author).
    is_internal: z.boolean().optional(),
    // Portal phase B slice 2: show or hide this comment in the client's thread. Staff pm/admin
    // and the Bast token only. Showing a comment that names Bast returns 400.
    client_visible: z.boolean().optional(),
  })
  .refine((d) => d.content !== undefined || d.is_internal !== undefined || d.client_visible !== undefined, {
    message: 'Provide content, is_internal or client_visible to update',
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
    is_internal: comment.is_internal ?? false,
    client_visible: comment.client_visible ?? false,
    client_question: comment.client_question ?? false,
    author_contact_id: comment.author_contact_id ?? null,
    author_contact: comment.author_contact ? { name: comment.author_contact.name } : null,
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
        author_contact: { select: { name: true } },
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
            title: true,
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

    // The client-visible flag (portal thread). Showing a comment needs the share permission, is
    // refused for an internal note, and refuses a body that names Bast. A client's own message
    // cannot be hidden from the client who wrote it.
    const finalContent = data.content ?? existingComment.content;
    const finalInternal = data.is_internal ?? existingComment.is_internal;
    const nextVisible = data.client_visible ?? (finalInternal ? false : existingComment.client_visible);
    if (data.client_visible !== undefined && existingComment.author_contact_id && data.client_visible === false) {
      throw new ApiError('A message the client wrote always stays in their thread.', 400, 'client_message');
    }
    if (data.client_visible === true) {
      assertShareable(auth, { content: finalContent, is_internal: finalInternal });
    } else if (data.content !== undefined && existingComment.client_visible && nextVisible) {
      // Editing a comment the client already sees: the new wording is checked the same way.
      assertShareable(auth, { content: finalContent, is_internal: finalInternal });
    }

    // When the body changes, re-resolve @-mentions server-side (the edit payload carries only
    // content). Notify users newly mentioned by this edit — never the editor, and never anyone
    // already mentioned before — then persist the recomputed set so a later edit won't re-notify.
    const updateData: {
      content?: string;
      is_internal?: boolean;
      client_visible?: boolean;
      mentioned_user_ids?: string[];
    } = {};
    let newlyMentionedIds: string[] = [];
    if (data.content !== undefined) {
      updateData.content = data.content;
      const activeUsers = await prisma.user.findMany({
        where: { is_active: true },
        select: { id: true, name: true },
      });
      const mentionedUserIds = findMentionedUserIds(data.content, activeUsers).filter(
        (uid) => uid !== auth.userId
      );
      updateData.mentioned_user_ids = mentionedUserIds;
      const alreadyMentioned = new Set(existingComment.mentioned_user_ids ?? []);
      newlyMentionedIds = mentionedUserIds.filter((uid) => !alreadyMentioned.has(uid));
    }
    if (data.is_internal !== undefined) updateData.is_internal = data.is_internal;
    if (data.client_visible !== undefined) updateData.client_visible = data.client_visible;
    // Making a comment internal takes it out of the client's thread.
    if (data.is_internal === true && existingComment.client_visible && data.client_visible === undefined && !existingComment.author_contact_id) {
      updateData.client_visible = false;
    }

    const comment = await prisma.comment.update({
      where: { id },
      data: updateData,
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true,
            avatar_url: true,
          },
        },
        author_contact: { select: { name: true } },
      },
    });

    // Newly shown: clocks resolve and the email notice is queued. Newly hidden, edited or made
    // internal while queued: the outbox is brought back in line (a notice with nothing left to
    // show is cancelled).
    if (!existingComment.client_visible && comment.client_visible && !comment.is_internal) {
      await afterReplyShared({ id: comment.id, task_id: comment.task_id, client_question: comment.client_question });
    } else if (existingComment.client_visible && (!comment.client_visible || comment.is_internal || data.content !== undefined)) {
      await afterReplyRetracted();
    }

    // Notify users who became mentioned via this edit (after a successful update).
    if (newlyMentionedIds.length > 0) {
      const editorName = comment.user?.name || 'Someone';
      const taskTitle = existingComment.task.title;
      const content = updateData.content ?? '';
      const snippet = `${content.substring(0, 100)}${content.length > 100 ? '...' : ''}`;
      for (const mentionedId of newlyMentionedIds) {
        await createNotification({
          userId: mentionedId,
          type: 'task_mentioned',
          title: `${editorName} mentioned you on "${taskTitle}"`,
          message: `"${snippet}"`,
          entityType: 'task',
          entityId: existingComment.task.id,
        });
      }
    }

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
    // A deleted reply must not go out in a queued notice.
    if (existingComment.client_visible) await afterReplyRetracted();

    return NextResponse.json({ success: true });
  } catch (error) {
    return handleApiError(error);
  }
}

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { requireAuth } from '@/lib/auth/middleware';
import { handleApiError, ApiError } from '@/lib/api/errors';
import { createNotification } from '@/lib/services/notifications';
import { clientVisibleCommentWhere } from '@/lib/comments/visibility';
import { afterReplyShared, assertShareable } from '@/lib/portal/share-reply';

const createCommentSchema = z.object({
  content: z.string().min(1, 'Comment cannot be empty').max(10000),
  mentioned_user_ids: z.array(z.string().uuid()).max(50).optional(),
  // Team/Bast-only: mark a comment as an internal note hidden from clients.
  // Defaults to client-visible (false). Client questions must stay false.
  is_internal: z.boolean().optional(),
  // Portal phase B slice 2: show this comment to the client in the thread on their work page.
  // Staff pm/admin roles and the Bast token only; internal notes cannot be shared; a comment
  // that names Bast is refused (400). Queues the client's email notice.
  client_visible: z.boolean().optional(),
  // A question for the client (needs client_visible). Opens an "awaiting the client" clock.
  client_question: z.boolean().optional(),
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
    client_visible: comment.client_visible ?? false,
    client_question: comment.client_question ?? false,
    // Set when the client wrote it (portal thread); the badge in the Citadel UI reads this.
    author_contact_id: comment.author_contact_id ?? null,
    author_contact: comment.author_contact ? { name: comment.author_contact.name } : null,
    // Portal phase C: `assistant` for the chat assistant's messages and notes, `portal`/`email` for the client's.
    source: comment.source ?? null,
    chat_meta: staffChatMeta(comment.chat_meta),
    created_at: comment.created_at,
    updated_at: comment.updated_at,
  };
}

// The few chat_meta flags staff see on a comment (never raw_email or job internals).
function staffChatMeta(meta: unknown): { handoff?: boolean; handback?: boolean; injection?: boolean; fixed?: boolean } | null {
  if (!meta || typeof meta !== 'object' || Array.isArray(meta)) return null;
  const m = meta as Record<string, unknown>;
  const out: { handoff?: boolean; handback?: boolean; injection?: boolean; fixed?: boolean } = {};
  if (m.handoff === true) out.handoff = true;
  if (m.handback === true) out.handback = true;
  if (m.injection === true) out.injection = true;
  if (m.fixed === true) out.fixed = true;
  return Object.keys(out).length ? out : null;
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
        author_contact: { select: { name: true } },
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
    if (data.client_question && !data.client_visible) {
      throw new ApiError('A question for the client must also be client_visible.', 400, 'question_not_visible');
    }
    if (data.client_visible) {
      assertShareable(auth, { content: data.content, is_internal: data.is_internal ?? false });
    }

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
        client_visible: data.client_visible ?? false,
        client_question: data.client_question ?? false,
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
        author_contact: { select: { name: true } },
      },
    });

    // Shared with the client: clocks resolve, the email notice is queued (it waits two minutes in
    // the outbox before the sender takes it). The comment is already saved either way.
    if (comment.client_visible) {
      await afterReplyShared({ id: comment.id, task_id: taskId, client_question: comment.client_question });
    }

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

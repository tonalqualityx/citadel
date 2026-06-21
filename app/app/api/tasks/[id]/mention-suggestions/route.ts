import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { requireAuth } from '@/lib/auth/middleware';
import { handleApiError, ApiError } from '@/lib/api/errors';

/**
 * GET /api/tasks/[id]/mention-suggestions
 *
 * Mention candidates for a task's comment composer, intelligently scoped:
 *   - ALL active Indelible team members, PLUS
 *   - only the client-contacts of THIS task's client (the "13 Nicoles → only the relevant
 *     Nicole" problem — we never surface another client's contacts).
 *
 * Team-only (requireAuth). Clients commenting from the portal can comment but cannot tag, which
 * is enforced structurally: the comment POST route is also team-auth, so a client session never
 * reaches a mention flow. Tech users only get suggestions for tasks they can access (mirrors the
 * comments-GET access guard).
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireAuth();
    const { id: taskId } = await params;

    const task = await prisma.task.findUnique({
      where: { id: taskId, is_deleted: false },
      select: { id: true, project_id: true, assignee_id: true, client_id: true },
    });

    if (!task) {
      throw new ApiError('Task not found', 404);
    }

    // Tech users can only see suggestions for tasks they have access to.
    if (auth.role === 'tech') {
      let hasAccess = false;

      if (!task.project_id && task.assignee_id === auth.userId) {
        hasAccess = true;
      } else if (task.project_id) {
        const isTeamMember = await prisma.projectTeamAssignment.findFirst({
          where: { project_id: task.project_id, user_id: auth.userId },
        });
        if (isTeamMember) hasAccess = true;
      }

      if (!hasAccess) {
        throw new ApiError('Task not found', 404);
      }
    }

    // All active team members.
    const users = await prisma.user.findMany({
      where: { is_active: true },
      select: { id: true, name: true, email: true, role: true, avatar_url: true },
      orderBy: { name: 'asc' },
    });

    // Only this task's client's contacts (none for ad-hoc tasks without a client).
    const contactRows = task.client_id
      ? await prisma.clientContact.findMany({
          where: { client_id: task.client_id, is_deleted: false },
          select: { id: true, name: true, email: true, role: true, is_primary: true },
          orderBy: [{ is_primary: 'desc' }, { created_at: 'asc' }],
        })
      : [];

    // Contacts may have no name; fall back to email so they are always mentionable.
    const contacts = contactRows.map((c) => ({
      id: c.id,
      name: c.name || c.email,
      email: c.email,
      role: c.role,
      is_primary: c.is_primary,
    }));

    return NextResponse.json({ users, contacts });
  } catch (error) {
    return handleApiError(error);
  }
}

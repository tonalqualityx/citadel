import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { requireAuth, requireRole } from '@/lib/auth/middleware';
import { handleApiError, ApiError } from '@/lib/api/errors';
import { logCreate, logDelete } from '@/lib/services/activity';

// Oracle Projects Tab Phase 5 — dismissing a blocker. POST creates a BlockerDismissal
// row; the classifier (lib/oracle/projects/blockers.ts's isDismissed) hides that exact
// blocker from the Projects tab until NEW activity supersedes source_marker (a newer
// comment id, a newer email's received_at, etc.) — the underlying mention/email/ask/task
// is never touched, never hard-deleted. DELETE undoes one dismissal by its OWN id
// (`?dismissal_id=`, distinct from this route's [id] path param, which is the PROJECT
// id) — the blocker reappears on the very next fetch, since isDismissed simply stops
// finding a matching row.
const dismissKindValues = ['mention', 'email', 'session_ask', 'task', 'meeting_risk', 'stale'] as const;

const createSchema = z.object({
  kind: z.enum(dismissKindValues),
  source_id: z.string().min(1).max(255),
  source_marker: z.string().max(255).optional().nullable(),
  note: z.string().max(2000).optional().nullable(),
});

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireAuth();
    requireRole(auth, ['pm', 'admin']);
    const { id: projectId } = await params;

    const project = await prisma.project.findUnique({
      where: { id: projectId, is_deleted: false },
      select: { id: true, name: true },
    });
    if (!project) {
      throw new ApiError('Project not found', 404);
    }

    const body = await request.json();
    const data = createSchema.parse(body);

    const created = await prisma.blockerDismissal.create({
      data: {
        project_id: projectId,
        kind: data.kind,
        source_id: data.source_id,
        source_marker: data.source_marker ?? null,
        note: data.note ?? null,
        dismissed_by_id: auth.userId,
      },
      include: { dismissed_by: { select: { id: true, name: true } } },
    });

    await logCreate(auth.userId, 'blocker_dismissal', created.id, `${data.kind}: ${project.name}`);

    return NextResponse.json(
      {
        id: created.id,
        project_id: created.project_id,
        kind: created.kind,
        source_id: created.source_id,
        source_marker: created.source_marker,
        note: created.note,
        dismissed_at: created.dismissed_at,
        dismissed_by: created.dismissed_by ? { id: created.dismissed_by.id, name: created.dismissed_by.name } : null,
      },
      { status: 201 }
    );
  } catch (error) {
    return handleApiError(error);
  }
}

const undoQuerySchema = z.object({
  dismissal_id: z.string().uuid(),
});

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireAuth();
    requireRole(auth, ['pm', 'admin']);
    const { id: projectId } = await params;

    const { searchParams } = new URL(request.url);
    const { dismissal_id: dismissalId } = undoQuerySchema.parse({
      dismissal_id: searchParams.get('dismissal_id'),
    });

    const dismissal = await prisma.blockerDismissal.findUnique({
      where: { id: dismissalId },
      select: { id: true, project_id: true, kind: true },
    });
    if (!dismissal || dismissal.project_id !== projectId) {
      throw new ApiError('Dismissal not found', 404);
    }

    await prisma.blockerDismissal.delete({ where: { id: dismissalId } });

    await logDelete(auth.userId, 'blocker_dismissal', dismissalId, dismissal.kind);

    return NextResponse.json({ success: true });
  } catch (error) {
    return handleApiError(error);
  }
}

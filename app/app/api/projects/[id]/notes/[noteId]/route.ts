import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { requireAuth, requireRole } from '@/lib/auth/middleware';
import { handleApiError, ApiError } from '@/lib/api/errors';
import { logDelete } from '@/lib/services/activity';
import { recomputeStaleMutedUntil } from '@/lib/services/project-notes';

// DELETE /api/projects/[id]/notes/[noteId] — soft delete. Project.stale_muted_until is
// always recomputed as MAX(until_date) over the project's remaining live parked_until
// notes (inside the same transaction as the soft-delete) — never keyed on whether THIS
// note's until_date happens to equal the current mute. That equality check silently
// broke whenever two parked_until notes shared a date, or failed to fall back to an
// older still-live park after the newest one was deleted. See
// lib/services/project-notes.ts for the full rationale.
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; noteId: string }> }
) {
  try {
    const auth = await requireAuth();
    requireRole(auth, ['pm', 'admin']);
    const { id: projectId, noteId } = await params;

    const note = await prisma.projectNote.findUnique({
      where: { id: noteId },
    });
    if (!note || note.project_id !== projectId || note.is_deleted) {
      throw new ApiError('Note not found', 404);
    }

    const project = await prisma.project.findUnique({
      where: { id: projectId },
      select: { id: true, name: true },
    });
    if (!project) {
      throw new ApiError('Project not found', 404);
    }

    await prisma.$transaction(async (tx) => {
      await tx.projectNote.update({
        where: { id: noteId },
        data: { is_deleted: true },
      });

      await recomputeStaleMutedUntil(tx, projectId);
    });

    await logDelete(auth.userId, 'project_note', noteId, project.name);

    return NextResponse.json({ success: true });
  } catch (error) {
    return handleApiError(error);
  }
}

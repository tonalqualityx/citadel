import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { requireAuth, requireRole } from '@/lib/auth/middleware';
import { handleApiError, ApiError } from '@/lib/api/errors';
import { logDelete } from '@/lib/services/activity';

// DELETE /api/projects/[id]/notes/[noteId] — soft delete. If the deleted note is the
// ACTIVE parked_until note (its until_date is the one currently driving
// Project.stale_muted_until), clear that mute too — a different, already-superseded
// parked_until note being deleted never touches the live mute.
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
      select: { id: true, name: true, stale_muted_until: true },
    });
    if (!project) {
      throw new ApiError('Project not found', 404);
    }

    await prisma.projectNote.update({
      where: { id: noteId },
      data: { is_deleted: true },
    });

    const isActiveParkedUntil =
      note.kind === 'parked_until' &&
      note.until_date &&
      project.stale_muted_until &&
      note.until_date.getTime() === project.stale_muted_until.getTime();

    if (isActiveParkedUntil) {
      await prisma.project.update({
        where: { id: projectId },
        data: { stale_muted_until: null },
      });
    }

    await logDelete(auth.userId, 'project_note', noteId, project.name);

    return NextResponse.json({ success: true });
  } catch (error) {
    return handleApiError(error);
  }
}

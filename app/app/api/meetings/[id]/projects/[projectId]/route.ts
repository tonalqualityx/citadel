import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { requireAuth, requireRole } from '@/lib/auth/middleware';
import { handleApiError } from '@/lib/api/errors';

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; projectId: string }> }
) {
  try {
    const auth = await requireAuth();
    requireRole(auth, ['pm', 'admin']);
    const { id, projectId } = await params;

    await prisma.meetingProject.deleteMany({
      where: {
        meeting_id: id,
        project_id: projectId,
      },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    return handleApiError(error);
  }
}

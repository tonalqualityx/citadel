import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { requireAuth, requireRole } from '@/lib/auth/middleware';
import { handleApiError, ApiError } from '@/lib/api/errors';
import { loadProjectCommunication } from '@/lib/projects/communication';

// GET /api/projects/[id]/communication: the project's emails, logged questions and meetings on one timeline, newest first.
// pm/admin only: it carries client mail and questions for Mike, which a tech-role key must not read.
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireAuth();
    requireRole(auth, ['pm', 'admin']);
    const { id: projectId } = await params;

    const project = await prisma.project.findUnique({ where: { id: projectId, is_deleted: false }, select: { id: true } });
    if (!project) throw new ApiError('Project not found', 404);

    return NextResponse.json(await loadProjectCommunication(projectId));
  } catch (error) {
    return handleApiError(error);
  }
}

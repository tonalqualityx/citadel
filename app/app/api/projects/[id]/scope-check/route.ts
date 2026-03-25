import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { requireAuth } from '@/lib/auth/middleware';
import { handleApiError, ApiError } from '@/lib/api/errors';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireAuth();
    const { id } = await params;

    const project = await prisma.project.findUnique({
      where: { id },
      select: {
        scope_locked: true,
        scope_locked_at: true,
        accord_id: true,
      },
    });

    if (!project) {
      throw new ApiError('Project not found', 404);
    }

    return NextResponse.json({
      scope_locked: project.scope_locked,
      scope_locked_at: project.scope_locked_at?.toISOString() ?? null,
      accord_id: project.accord_id ?? null,
    });
  } catch (error) {
    return handleApiError(error);
  }
}

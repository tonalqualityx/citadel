import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { requireAuth, requireRole } from '@/lib/auth/middleware';
import { handleApiError, ApiError } from '@/lib/api/errors';
import { formatMeetingProjectResponse } from '@/lib/api/formatters';

const linkProjectSchema = z.object({
  project_id: z.string().uuid(),
});

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireAuth();
    requireRole(auth, ['pm', 'admin']);
    const { id } = await params;

    const body = await request.json();
    const data = linkProjectSchema.parse(body);

    try {
      const meetingProject = await prisma.meetingProject.create({
        data: {
          meeting_id: id,
          project_id: data.project_id,
        },
        include: {
          project: { select: { id: true, name: true } },
        },
      });

      return NextResponse.json(formatMeetingProjectResponse(meetingProject), { status: 201 });
    } catch (error: any) {
      if (error.code === 'P2002') {
        throw new ApiError('Project is already linked to this meeting', 409);
      }
      throw error;
    }
  } catch (error) {
    return handleApiError(error);
  }
}

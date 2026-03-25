import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { requireAuth, requireRole } from '@/lib/auth/middleware';
import { handleApiError, ApiError } from '@/lib/api/errors';
import { formatMeetingCharterResponse } from '@/lib/api/formatters';

const linkCharterSchema = z.object({
  charter_id: z.string().uuid(),
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
    const data = linkCharterSchema.parse(body);

    try {
      const meetingCharter = await prisma.meetingCharter.create({
        data: {
          meeting_id: id,
          charter_id: data.charter_id,
        },
        include: {
          charter: { select: { id: true, name: true } },
        },
      });

      return NextResponse.json(formatMeetingCharterResponse(meetingCharter), { status: 201 });
    } catch (error: any) {
      if (error.code === 'P2002') {
        throw new ApiError('Charter is already linked to this meeting', 409);
      }
      throw error;
    }
  } catch (error) {
    return handleApiError(error);
  }
}

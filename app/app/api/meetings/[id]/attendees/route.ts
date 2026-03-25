import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { requireAuth, requireRole } from '@/lib/auth/middleware';
import { handleApiError, ApiError } from '@/lib/api/errors';
import { formatMeetingAttendeeResponse } from '@/lib/api/formatters';

const addAttendeeSchema = z.object({
  user_id: z.string().uuid(),
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
    const data = addAttendeeSchema.parse(body);

    // Validate meeting exists and is not deleted
    const meeting = await prisma.meeting.findUnique({
      where: { id, is_deleted: false },
    });
    if (!meeting) {
      throw new ApiError('Meeting not found', 404);
    }

    // Validate user exists
    const user = await prisma.user.findUnique({
      where: { id: data.user_id },
    });
    if (!user) {
      throw new ApiError('User not found', 404);
    }

    try {
      const attendee = await prisma.meetingAttendee.create({
        data: {
          meeting_id: id,
          user_id: data.user_id,
        },
        include: {
          user: { select: { id: true, name: true, email: true } },
        },
      });

      return NextResponse.json(formatMeetingAttendeeResponse(attendee), { status: 201 });
    } catch (error: any) {
      if (error.code === 'P2002') {
        throw new ApiError('User is already an attendee of this meeting', 409);
      }
      throw error;
    }
  } catch (error) {
    return handleApiError(error);
  }
}

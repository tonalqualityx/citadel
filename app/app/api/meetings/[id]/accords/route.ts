import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { requireAuth, requireRole } from '@/lib/auth/middleware';
import { handleApiError, ApiError } from '@/lib/api/errors';
import { formatMeetingAccordResponse } from '@/lib/api/formatters';
import { logStatusChange } from '@/lib/services/activity';

const linkAccordSchema = z.object({
  accord_id: z.string().uuid(),
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
    const data = linkAccordSchema.parse(body);

    // Validate meeting exists
    const meeting = await prisma.meeting.findUnique({
      where: { id, is_deleted: false },
    });
    if (!meeting) {
      throw new ApiError('Meeting not found', 404);
    }

    // Validate accord exists
    const accord = await prisma.accord.findUnique({
      where: { id: data.accord_id },
    });
    if (!accord) {
      throw new ApiError('Accord not found', 404);
    }

    try {
      const meetingAccord = await prisma.meetingAccord.create({
        data: {
          meeting_id: id,
          accord_id: data.accord_id,
        },
        include: {
          accord: { select: { id: true, name: true, status: true } },
        },
      });

      // Pipeline automation: auto-advance accord from 'lead' to 'meeting'
      if (accord.status === 'lead') {
        await prisma.accord.update({
          where: { id: accord.id },
          data: {
            status: 'meeting',
            entered_current_status_at: new Date(),
          },
        });
        await logStatusChange(auth.userId, 'meeting', meeting.id, meeting.title, 'lead', 'meeting');
      }

      return NextResponse.json(formatMeetingAccordResponse(meetingAccord), { status: 201 });
    } catch (error: any) {
      if (error.code === 'P2002') {
        throw new ApiError('Accord is already linked to this meeting', 409);
      }
      throw error;
    }
  } catch (error) {
    return handleApiError(error);
  }
}

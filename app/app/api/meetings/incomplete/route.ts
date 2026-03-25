import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { requireAuth } from '@/lib/auth/middleware';
import { handleApiError } from '@/lib/api/errors';

export async function GET(request: NextRequest) {
  try {
    const auth = await requireAuth();

    const meetings = await prisma.meeting.findMany({
      where: {
        is_deleted: false,
        meeting_date: { lt: new Date() },
        attendees: { some: { user_id: auth.userId } },
        OR: [
          {
            transcript_url: null,
            transcript_not_available: false,
          },
          {
            recording_url: null,
            recording_not_available: false,
          },
        ],
      },
      include: {
        client: { select: { id: true, name: true, status: true } },
      },
      orderBy: { meeting_date: 'desc' },
    });

    return NextResponse.json({ meetings });
  } catch (error) {
    return handleApiError(error);
  }
}

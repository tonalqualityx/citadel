import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { requireAuth, requireRole } from '@/lib/auth/middleware';
import { handleApiError } from '@/lib/api/errors';

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; attendeeId: string }> }
) {
  try {
    const auth = await requireAuth();
    requireRole(auth, ['pm', 'admin']);
    const { id, attendeeId } = await params;

    await prisma.meetingAttendee.delete({
      where: {
        id: attendeeId,
        meeting_id: id,
      },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    return handleApiError(error);
  }
}

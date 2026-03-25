import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { requireAuth, requireRole } from '@/lib/auth/middleware';
import { handleApiError } from '@/lib/api/errors';

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; charterId: string }> }
) {
  try {
    const auth = await requireAuth();
    requireRole(auth, ['pm', 'admin']);
    const { id, charterId } = await params;

    await prisma.meetingCharter.deleteMany({
      where: {
        meeting_id: id,
        charter_id: charterId,
      },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    return handleApiError(error);
  }
}

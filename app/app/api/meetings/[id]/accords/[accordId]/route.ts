import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { requireAuth, requireRole } from '@/lib/auth/middleware';
import { handleApiError } from '@/lib/api/errors';

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; accordId: string }> }
) {
  try {
    const auth = await requireAuth();
    requireRole(auth, ['pm', 'admin']);
    const { id, accordId } = await params;

    await prisma.meetingAccord.deleteMany({
      where: {
        meeting_id: id,
        accord_id: accordId,
      },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    return handleApiError(error);
  }
}

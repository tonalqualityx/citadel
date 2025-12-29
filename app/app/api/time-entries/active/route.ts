import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { requireAuth } from '@/lib/auth/middleware';
import { handleApiError } from '@/lib/api/errors';

export async function GET(request: NextRequest) {
  try {
    const auth = await requireAuth();

    // Find the user's currently running timer
    const timer = await prisma.timeEntry.findFirst({
      where: {
        user_id: auth.userId,
        is_running: true,
        is_deleted: false,
      },
      include: {
        task: { select: { id: true, title: true } },
        project: { select: { id: true, name: true } },
      },
    });

    return NextResponse.json({ timer });
  } catch (error) {
    return handleApiError(error);
  }
}

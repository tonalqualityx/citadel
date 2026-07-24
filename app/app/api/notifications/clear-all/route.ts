import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { requireAuth } from '@/lib/auth/middleware';
import { handleApiError } from '@/lib/api/errors';

export async function POST(request: NextRequest) {
  try {
    const auth = await requireAuth();

    const result = await prisma.notification.deleteMany({
      where: {
        user_id: auth.userId,
      },
    });

    return NextResponse.json({ success: true, deleted: result.count });
  } catch (error) {
    return handleApiError(error);
  }
}

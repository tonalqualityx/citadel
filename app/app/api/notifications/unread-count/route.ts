import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { requireAuth } from '@/lib/auth/middleware';
import { handleApiError } from '@/lib/api/errors';

export async function GET(request: NextRequest) {
  try {
    const auth = await requireAuth();

    const count = await prisma.notification.count({
      where: {
        user_id: auth.userId,
        is_read: false,
      },
    });

    return NextResponse.json({ count });
  } catch (error) {
    return handleApiError(error);
  }
}

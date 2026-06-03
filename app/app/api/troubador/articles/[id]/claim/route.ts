import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { requireAuth } from '@/lib/auth/middleware';
import { handleApiError, ApiError } from '@/lib/api/errors';
import { isLeaseActive } from '@/lib/troubador/helpers';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireAuth();
    const { id } = await params;

    const article = await prisma.article.findFirst({
      where: { id, is_deleted: false },
    });
    if (!article) throw new ApiError('Article not found', 404);

    if (isLeaseActive(article.claimed_at) && article.claimed_by_id !== auth.userId) {
      return NextResponse.json({ claimed: false, claimed_at: article.claimed_at });
    }

    const claimed_at = new Date();
    await prisma.article.update({
      where: { id },
      data: { claimed_at, claimed_by_id: auth.userId },
    });

    return NextResponse.json({ claimed: true, claimed_at });
  } catch (error) {
    return handleApiError(error);
  }
}

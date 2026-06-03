import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { requireAuth } from '@/lib/auth/middleware';
import { handleApiError, ApiError } from '@/lib/api/errors';

export async function GET(request: NextRequest) {
  try {
    await requireAuth();
    const { searchParams } = new URL(request.url);

    const site_id = searchParams.get('site_id');
    if (!site_id) throw new ApiError('site_id is required', 400);

    const from = searchParams.get('from') || undefined;
    const to = searchParams.get('to') || undefined;

    const dateFilter: Record<string, Date> = {};
    if (from) dateFilter.gte = new Date(from);
    if (to) dateFilter.lte = new Date(to);

    const articles = await prisma.article.findMany({
      where: {
        site_id,
        is_deleted: false,
        scheduled_date: {
          not: null,
          ...(Object.keys(dateFilter).length > 0 ? dateFilter : {}),
        },
        status: { in: ['scheduled', 'published'] },
      },
      orderBy: { scheduled_date: 'asc' },
    });

    const entries = articles.map((a) => ({
      article_id: a.id,
      title: a.title,
      run_id: a.run_id,
      status: a.status,
      date: a.scheduled_date,
    }));

    return NextResponse.json({ site_id, entries });
  } catch (error) {
    return handleApiError(error);
  }
}

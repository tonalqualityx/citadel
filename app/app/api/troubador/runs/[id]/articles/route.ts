import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { requireAuth } from '@/lib/auth/middleware';
import { handleApiError, ApiError } from '@/lib/api/errors';
import { slugify, uniqueSlug } from '@/lib/troubador/helpers';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireAuth();
    const { id } = await params;

    const run = await prisma.troubadorRun.findFirst({
      where: { id, is_deleted: false },
    });
    if (!run) throw new ApiError('Run not found', 404);

    if (!(run.stage === 'topic_selection' && run.selection_ready === true)) {
      throw new ApiError('Run not ready for article creation', 409);
    }

    const selectedProposals = await prisma.topicProposal.findMany({
      where: { run_id: id, selected: true },
      orderBy: { created_at: 'asc' },
    });

    const existingArticles = await prisma.article.findMany({
      where: { run_id: id },
      select: { slug: true },
    });
    const existingSlugs = new Set(existingArticles.map((a) => a.slug));

    for (const proposal of selectedProposals) {
      const base = slugify(proposal.title);
      // Idempotent: if an article for this topic already exists, skip.
      if (existingSlugs.has(base)) continue;
      const slug = uniqueSlug(base, existingSlugs);

      await prisma.article.create({
        data: {
          run_id: id,
          client_id: run.client_id,
          site_id: run.site_id,
          slug,
          title: proposal.title,
          status: 'pending_research',
        },
      });
      existingSlugs.add(slug);
    }

    await prisma.troubadorRun.update({ where: { id }, data: { stage: 'researching' } });

    const articles_count = await prisma.article.count({
      where: { run_id: id, is_deleted: false },
    });

    return NextResponse.json({ run_id: id, stage: 'researching', articles_count });
  } catch (error) {
    return handleApiError(error);
  }
}

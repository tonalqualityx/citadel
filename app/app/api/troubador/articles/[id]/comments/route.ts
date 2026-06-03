import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { requireAuth } from '@/lib/auth/middleware';
import { handleApiError, ApiError } from '@/lib/api/errors';
import { formatArticleCommentResponse } from '@/lib/api/troubador-formatters';

const schema = z.object({
  content: z.string().min(1),
});

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

    const data = schema.parse(await request.json());

    const comment = await prisma.articleComment.create({
      data: {
        article_id: id,
        user_id: auth.userId,
        content: data.content,
        is_feedback: true,
      },
      include: { user: { select: { id: true, name: true, email: true } } },
    });

    // Feedback reopens an article that's already moved past drafting.
    let newStatus = article.status;
    if (['in_review', 'approved', 'scheduled'].includes(article.status)) {
      newStatus = 'needs_revision';
      await prisma.article.update({
        where: { id },
        data: { status: 'needs_revision', locked: false },
      });
    }

    return NextResponse.json({
      comment: formatArticleCommentResponse(comment),
      article_status: newStatus,
    });
  } catch (error) {
    return handleApiError(error);
  }
}

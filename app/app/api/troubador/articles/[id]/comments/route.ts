import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { requireAuth } from '@/lib/auth/middleware';
import { handleApiError, ApiError } from '@/lib/api/errors';
import { formatArticleCommentResponse } from '@/lib/api/troubador-formatters';
import { recomputeProductionStage } from '@/lib/troubador/run-stage';
import { createNotification } from '@/lib/services/notifications';
import { findMentionedUserIds } from '@/lib/utils/mentions';

const schema = z.object({
  content: z.string().min(1),
  // Feedback vs. note is set by the caller, NOT hardcoded. Only a CLIENT change-request (via the
  // portal endpoint) or an explicit `is_feedback: true` here counts as feedback that re-opens the
  // article. An agent/team reply closing the loop is a NOTE — the sane default — and never bumps
  // status, so "Addressed: ..." replies don't knock just-finished work back to needs_revision.
  is_feedback: z.boolean().optional().default(false),
  // Optional: a reply can resolve the original feedback comment it answers, leaving the thread clean
  // (client asked → agent answered → resolved). Scoped to this article's feedback comments.
  resolve_comment_id: z.string().uuid().optional(),
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
        is_feedback: data.is_feedback,
      },
      include: { user: { select: { id: true, name: true, email: true } } },
    });

    // Notify any @-mentioned team members. The article-comment payload only carries content,
    // so resolve mentions server-side with the shared helper against active users — never the
    // author. Reuses the same `task_mentioned` wiring as task comments (entity = the article).
    const activeUsers = await prisma.user.findMany({
      where: { is_active: true },
      select: { id: true, name: true },
    });
    const mentionedUserIds = findMentionedUserIds(data.content, activeUsers).filter(
      (uid) => uid !== auth.userId
    );
    if (mentionedUserIds.length > 0) {
      const snippet = `${data.content.substring(0, 100)}${data.content.length > 100 ? '...' : ''}`;
      const commenterName = comment.user?.name || 'Someone';
      for (const mentionedId of mentionedUserIds) {
        await createNotification({
          userId: mentionedId,
          type: 'task_mentioned',
          title: `${commenterName} mentioned you on "${article.title}"`,
          message: `"${snippet}"`,
          entityType: 'article',
          entityId: id,
        });
      }
    }

    // A reply can close the original feedback comment it answers. Scope to this article's feedback
    // comments so a note can't resolve an unrelated thread; a missing/already-non-feedback id is a 404.
    let resolvedCommentId: string | null = null;
    if (data.resolve_comment_id) {
      const { count } = await prisma.articleComment.updateMany({
        where: { id: data.resolve_comment_id, article_id: id, is_feedback: true },
        data: { resolved: true },
      });
      if (count === 0) throw new ApiError('Feedback comment not found', 404);
      resolvedCommentId = data.resolve_comment_id;
    }

    // ONLY feedback reopens an article that's already moved past drafting. A non-feedback note
    // leaves status untouched, so closing the loop never re-triggers needs_revision.
    let newStatus = article.status;
    if (data.is_feedback && ['in_review', 'approved', 'scheduled'].includes(article.status)) {
      newStatus = 'needs_revision';
      await prisma.article.update({
        where: { id },
        data: { status: 'needs_revision', locked: false },
      });
      // Reopening an article may pull the run back from Publishing to In Production.
      await recomputeProductionStage(article.run_id);
    }

    return NextResponse.json({
      comment: formatArticleCommentResponse(comment),
      article_status: newStatus,
      resolved_comment_id: resolvedCommentId,
    });
  } catch (error) {
    return handleApiError(error);
  }
}

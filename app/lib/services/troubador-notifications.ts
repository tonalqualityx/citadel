import { prisma } from '@/lib/db/prisma';
import { createNotification } from '@/lib/services/notifications';

/**
 * Fire-and-forget: notify a run's assignee that an article is ready for review.
 * Never throws — failures are logged and swallowed.
 */
export async function notifyArticleNeedsReview(articleId: string): Promise<void> {
  try {
    const article = await prisma.article.findUnique({
      where: { id: articleId },
      select: {
        id: true,
        title: true,
        run: {
          select: {
            id: true,
            title: true,
            assignee_id: true,
          },
        },
      },
    });

    if (!article || !article.run || !article.run.assignee_id) return;

    await createNotification({
      userId: article.run.assignee_id,
      type: 'article_needs_review',
      title: `Article ready for review: ${article.title}`,
      message: `In run "${article.run.title}"`,
      entityType: 'article',
      entityId: article.id,
      priority: 'normal',
    });
  } catch (error) {
    console.error('notifyArticleNeedsReview failed:', error);
  }
}

/**
 * Fire-and-forget: notify a run's assignee that a new content run needs planning.
 * Never throws — failures are logged and swallowed.
 */
export async function notifyTroubadorRunCreated(runId: string): Promise<void> {
  try {
    const run = await prisma.troubadorRun.findUnique({
      where: { id: runId },
      select: {
        id: true,
        title: true,
        assignee_id: true,
        client: { select: { name: true } },
      },
    });

    if (!run || !run.assignee_id) return;

    await createNotification({
      userId: run.assignee_id,
      type: 'troubador_run_created',
      title: `New content run: ${run.title}`,
      message: `Planning needed${run.client ? ` for ${run.client.name}` : ''}`,
      entityType: 'troubador_run',
      entityId: run.id,
      priority: 'normal',
    });
  } catch (error) {
    console.error('notifyTroubadorRunCreated failed:', error);
  }
}

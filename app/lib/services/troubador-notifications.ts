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
 * Fire-and-forget: notify a run's assignee that the whole run has reached the
 * review stage (every live article is `in_review` or beyond, at least one just
 * became `in_review`). Never throws — failures are logged and swallowed.
 */
export async function notifyRunReviewReady(runId: string): Promise<void> {
  try {
    const run = await prisma.troubadorRun.findUnique({
      where: { id: runId },
      select: {
        id: true,
        title: true,
        assignee_id: true,
        client: { select: { name: true } },
        articles: {
          where: { is_deleted: false, status: { notIn: ['dropped', 'postponed'] } },
          select: { id: true },
        },
      },
    });

    if (!run || !run.assignee_id) return;

    const count = run.articles.length;

    await createNotification({
      userId: run.assignee_id,
      type: 'troubador_run_review_ready',
      title: `Content run ready for review: ${run.title}`,
      message: `${count} article${count === 1 ? '' : 's'} ready for review${
        run.client ? ` for ${run.client.name}` : ''
      }`,
      entityType: 'troubador_run',
      entityId: run.id,
      priority: 'high',
    });
  } catch (error) {
    console.error('notifyRunReviewReady failed:', error);
  }
}

/**
 * Fire-and-forget: notify a run's assignee that a client approved one of its
 * articles. Never throws — failures are logged and swallowed.
 */
export async function notifyArticleClientApproved(articleId: string): Promise<void> {
  try {
    const article = await prisma.article.findUnique({
      where: { id: articleId },
      select: {
        id: true,
        title: true,
        approved_by_contact: { select: { name: true } },
        run: { select: { id: true, title: true, assignee_id: true } },
      },
    });

    if (!article || !article.run || !article.run.assignee_id) return;

    const contactName = article.approved_by_contact?.name;

    await createNotification({
      userId: article.run.assignee_id,
      type: 'article_client_approved',
      title: `Client approved: ${article.title}`,
      message: `${contactName ? `${contactName} approved it` : 'Approved'} in run "${article.run.title}"`,
      entityType: 'article',
      entityId: article.id,
      priority: 'high',
    });
  } catch (error) {
    console.error('notifyArticleClientApproved failed:', error);
  }
}

/**
 * Fire-and-forget: notify a run's assignee that a client requested changes on one
 * of its articles. `note` is the client's own feedback text; the message carries
 * the first ~200 characters of it. Never throws — failures are logged and swallowed.
 */
export async function notifyArticleClientChangesRequested(
  articleId: string,
  note: string
): Promise<void> {
  try {
    const article = await prisma.article.findUnique({
      where: { id: articleId },
      select: {
        id: true,
        title: true,
        run: { select: { id: true, title: true, assignee_id: true } },
      },
    });

    if (!article || !article.run || !article.run.assignee_id) return;

    const excerpt = note.length > 200 ? `${note.slice(0, 200)}…` : note;

    await createNotification({
      userId: article.run.assignee_id,
      type: 'article_client_changes_requested',
      title: `Client requested changes: ${article.title}`,
      message: excerpt,
      entityType: 'article',
      entityId: article.id,
      priority: 'high',
    });
  } catch (error) {
    console.error('notifyArticleClientChangesRequested failed:', error);
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

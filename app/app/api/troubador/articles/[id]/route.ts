import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { requireAuth, requireRole } from '@/lib/auth/middleware';
import { handleApiError, ApiError } from '@/lib/api/errors';
import { formatArticleResponse } from '@/lib/api/troubador-formatters';
import { isTroubadorBot, utcDayKey } from '@/lib/troubador/helpers';
import { logStatusChange } from '@/lib/services/activity';
import { notifyArticleNeedsReview, notifyRunReviewReady } from '@/lib/services/troubador-notifications';
import { recomputeProductionStage } from '@/lib/troubador/run-stage';

// Statuses that count as "past the drafting stage" for the run-review-ready guard —
// everything from in_review onward (needs_revision included: a rewrite sent back to
// in_review still counts once it lands there again).
const REVIEW_OR_BEYOND = new Set([
  'in_review',
  'needs_revision',
  'approved',
  'scheduled',
  'published',
]);

const articleDetailInclude = {
  client: { select: { id: true, name: true } },
  site: { select: { id: true, name: true, url: true, site_type: true } },
  approved_by: { select: { id: true, name: true, email: true } },
  comments: {
    where: { is_deleted: false },
    include: { user: { select: { id: true, name: true, email: true } } },
    orderBy: { created_at: 'desc' as const },
  },
};

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireAuth();
    const { id } = await params;

    const article = await prisma.article.findFirst({
      where: { id, is_deleted: false },
      include: articleDetailInclude,
    });
    if (!article) throw new ApiError('Article not found', 404);

    // Surface when a client last opened this article in the portal (null if never).
    const lastView = await prisma.portalSession.findFirst({
      where: { token_type: 'article_view', entity_id: id },
      orderBy: { created_at: 'desc' },
      select: { created_at: true },
    });

    return NextResponse.json(
      formatArticleResponse({ ...article, client_last_viewed_at: lastView?.created_at ?? null })
    );
  } catch (error) {
    return handleApiError(error);
  }
}

const articleStatusEnum = z.enum([
  'pending_research',
  'researched',
  'drafting',
  'in_review',
  'needs_revision',
  'approved',
  'scheduled',
  'published',
  'postponed',
  'dropped',
]);

const checkStateEnum = z.enum(['pending', 'passed', 'check_failed', 'compliance_hold']);

const patchArticleSchema = z.object({
  research_summary: z.string().optional(),
  body: z.string().optional(),
  social_copy: z.string().optional(),
  check_state: checkStateEnum.optional(),
  check_report: z.any().optional(),
  status: articleStatusEnum.optional(),
  title: z.string().optional(),
  scheduled_date: z.string().nullable().optional(),
  published_url: z.string().optional(),
  action: z.enum(['approve', 'drop', 'postpone', 'reactivate', 'schedule', 'publish']).optional(),
});

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireAuth();
    const { id } = await params;

    const article = await prisma.article.findFirst({
      where: { id, is_deleted: false },
      include: { run: true },
    });
    if (!article) throw new ApiError('Article not found', 404);

    const bot = isTroubadorBot(auth);
    const data = patchArticleSchema.parse(await request.json());

    // Worker cannot EDIT locked (approved) copy — but it may publish/schedule it.
    if (bot && article.locked) {
      const touchesContent =
        data.research_summary !== undefined ||
        data.body !== undefined ||
        data.social_copy !== undefined ||
        data.title !== undefined ||
        data.check_state !== undefined ||
        data.check_report !== undefined;
      const nonPublishAction =
        data.action !== undefined && !['publish', 'schedule'].includes(data.action);
      const badStatus =
        data.status !== undefined && !['scheduled', 'published'].includes(data.status);
      if (touchesContent || nonPublishAction || badStatus) {
        throw new ApiError(
          'Article is approved and locked — worker may only publish/schedule it',
          409
        );
      }
    }

    const update: Record<string, unknown> = {};
    let statusChange: { from: string; to: string } | null = null;
    let advanceRun = false;
    let notifyReview = false;
    let notifyRunReview = false;

    const setStatus = (to: string) => {
      update.status = to;
      statusChange = { from: article.status, to };
    };

    // Action-driven transitions
    if (data.action === 'approve') {
      if (bot) throw new ApiError('Worker cannot approve articles', 403);
      requireRole(auth, ['pm', 'admin']);
      setStatus('approved');
      update.approved_at = new Date();
      update.approved_by_id = auth.userId;
      update.locked = true;
      advanceRun = true;
    } else if (data.action === 'drop') {
      setStatus('dropped');
      advanceRun = true;
    } else if (data.action === 'postpone') {
      setStatus('postponed');
      advanceRun = true;
    } else if (data.action === 'reactivate') {
      if (article.status === 'postponed') {
        setStatus('needs_revision');
      }
    }

    // Publishing — worker (or human) marks the approved copy live.
    if (data.action === 'publish' || data.status === 'published') {
      setStatus('published');
      advanceRun = true;
    }
    if (data.published_url !== undefined) {
      update.published_url = data.published_url;
    }

    // Scheduling (action 'schedule' or scheduled_date provided)
    const wantsSchedule = data.action === 'schedule' || data.scheduled_date !== undefined;
    if (wantsSchedule && data.scheduled_date) {
      const newDate = new Date(data.scheduled_date);
      const others = await prisma.article.findMany({
        where: {
          site_id: article.site_id,
          is_deleted: false,
          id: { not: article.id },
          scheduled_date: { not: null },
          status: { not: 'dropped' },
        },
        select: { scheduled_date: true },
      });
      const key = utcDayKey(newDate);
      if (others.some((o) => o.scheduled_date && utcDayKey(o.scheduled_date) === key)) {
        throw new ApiError('Another article is already scheduled for that day on this site', 409);
      }
      update.scheduled_date = newDate;
      if (article.status === 'approved') {
        setStatus('scheduled');
      }
    } else if (data.scheduled_date === null) {
      update.scheduled_date = null;
    }

    // Worker draft-field status transitions
    if (
      data.status !== undefined &&
      ['researched', 'drafting', 'in_review'].includes(data.status)
    ) {
      setStatus(data.status);
      if (data.status === 'in_review' && article.run?.assignee_id) {
        notifyReview = true;

        // Run-review-ready guard: fire notifyRunReviewReady exactly once, only when
        // THIS transition is what completes the set (every live sibling already
        // in_review-or-beyond, AND this article's own in_review lands the "at least
        // one is in_review" requirement that wasn't already satisfied).
        const siblings = await prisma.article.findMany({
          where: {
            run_id: article.run_id,
            is_deleted: false,
            id: { not: article.id },
            status: { notIn: ['dropped', 'postponed'] },
          },
          select: { status: true },
        });
        const siblingStatuses = siblings.map((s) => s.status);

        const preStatuses = [...siblingStatuses, article.status]; // before this PATCH
        const postStatuses = [...siblingStatuses, 'in_review']; // after this PATCH

        const wasComplete =
          preStatuses.every((s) => REVIEW_OR_BEYOND.has(s)) &&
          preStatuses.some((s) => s === 'in_review');
        const isComplete =
          postStatuses.every((s) => REVIEW_OR_BEYOND.has(s)) &&
          postStatuses.some((s) => s === 'in_review');

        if (isComplete && !wasComplete) {
          notifyRunReview = true;
        }
      }
    }

    // Content fields
    if (data.research_summary !== undefined) update.research_summary = data.research_summary;
    if (data.check_state !== undefined) update.check_state = data.check_state;
    if (data.check_report !== undefined) update.check_report = data.check_report;
    // body/social_copy/title editable by humans even if locked; bot blocked above on locked.
    if (data.body !== undefined) update.body = data.body;
    if (data.social_copy !== undefined) update.social_copy = data.social_copy;
    if (data.title !== undefined) update.title = data.title;

    await prisma.article.update({ where: { id }, data: update });

    // A rewrite that returns the article to review resolves its outstanding feedback.
    if (article.status === 'needs_revision' && update.status === 'in_review') {
      await prisma.articleComment.updateMany({
        where: { article_id: id, is_feedback: true, resolved: false },
        data: { resolved: true },
      });
    }

    if (statusChange) {
      const sc = statusChange as { from: string; to: string };
      logStatusChange(auth.userId, 'article', id, article.title, sc.from, sc.to);
    }
    if (advanceRun) {
      await recomputeProductionStage(article.run_id);
    }
    if (notifyReview) {
      notifyArticleNeedsReview(article.id).catch(() => {});
    }
    if (notifyRunReview) {
      notifyRunReviewReady(article.run_id).catch(() => {});
    }

    const updated = await prisma.article.findUnique({
      where: { id },
      include: articleDetailInclude,
    });

    return NextResponse.json(formatArticleResponse(updated));
  } catch (error) {
    return handleApiError(error);
  }
}

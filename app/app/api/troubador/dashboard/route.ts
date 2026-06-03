import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { requireAuth } from '@/lib/auth/middleware';
import { handleApiError } from '@/lib/api/errors';

export async function GET() {
  try {
    const auth = await requireAuth();
    const userId = auth.userId;

    const [awaitingReview, planning, topicSelection, readyForInterview] = await Promise.all([
      prisma.article.findMany({
        where: {
          status: 'in_review',
          is_deleted: false,
          run: { assignee_id: userId },
        },
        include: { run: { select: { id: true, title: true } } },
      }),
      prisma.troubadorRun.findMany({
        where: { assignee_id: userId, stage: 'planning', is_deleted: false },
        select: { id: true, title: true },
      }),
      prisma.troubadorRun.findMany({
        where: { assignee_id: userId, stage: 'topic_selection', is_deleted: false },
        select: { id: true, title: true },
      }),
      prisma.troubadorRun.findMany({
        where: { assignee_id: userId, stage: 'ready_for_interview', is_deleted: false },
        select: { id: true, title: true },
      }),
    ]);

    return NextResponse.json({
      articles_awaiting_review: awaitingReview.map((a) => ({
        id: a.id,
        title: a.title,
        run_id: a.run_id,
        run_title: a.run?.title ?? null,
      })),
      runs_in_planning: planning.map((r) => ({ id: r.id, title: r.title })),
      runs_in_topic_selection: topicSelection.map((r) => ({ id: r.id, title: r.title })),
      runs_ready_for_interview: readyForInterview.map((r) => ({ id: r.id, title: r.title })),
    });
  } catch (error) {
    return handleApiError(error);
  }
}

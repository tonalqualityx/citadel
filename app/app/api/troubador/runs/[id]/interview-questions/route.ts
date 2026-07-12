import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { requireAuth } from '@/lib/auth/middleware';
import { handleApiError, ApiError } from '@/lib/api/errors';

const schema = z.object({
  questions: z.any(),
});

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireAuth();
    const { id } = await params;

    const run = await prisma.troubadorRun.findFirst({
      where: { id, is_deleted: false },
      include: { interview: true },
    });
    if (!run) throw new ApiError('Run not found', 404);

    // Two accepted paths:
    //   1. researching        — the worker's first-pass post: all selected articles must be
    //                            researched; upsert questions and advance → ready_for_interview.
    //   2. ready_for_interview — regeneration: the questions can be replaced any number of
    //                            times while the interview hasn't been completed yet. The
    //                            article-research check doesn't re-run here — those articles
    //                            already passed it to reach this stage. Stage does not change.
    // Any other stage, or an already-complete interview, is a 409 — no reopening via this route.
    if (run.stage === 'researching') {
      const articles = await prisma.article.findMany({
        where: { run_id: id, is_deleted: false, status: { not: 'dropped' } },
        select: { status: true },
      });
      if (articles.some((a) => a.status === 'pending_research')) {
        throw new ApiError('Articles still being researched', 409);
      }
    } else if (run.stage === 'ready_for_interview') {
      if (run.interview?.status === 'complete') {
        throw new ApiError('Interview already complete', 409);
      }
    } else {
      throw new ApiError('Run not in researching or ready_for_interview stage', 409);
    }

    const data = schema.parse(await request.json());

    await prisma.interview.upsert({
      where: { run_id: id },
      create: { run_id: id, questions: data.questions ?? undefined, status: 'pending' },
      update: { questions: data.questions ?? undefined, status: 'pending' },
    });

    if (run.stage === 'researching') {
      await prisma.troubadorRun.update({ where: { id }, data: { stage: 'ready_for_interview' } });
    }

    return NextResponse.json({
      run_id: id,
      stage: 'ready_for_interview',
      interview_status: 'pending',
    });
  } catch (error) {
    return handleApiError(error);
  }
}

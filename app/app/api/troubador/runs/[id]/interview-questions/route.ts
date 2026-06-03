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
    });
    if (!run) throw new ApiError('Run not found', 404);

    if (run.stage !== 'researching') {
      throw new ApiError('Run not in researching stage', 409);
    }

    const articles = await prisma.article.findMany({
      where: { run_id: id, is_deleted: false, status: { not: 'dropped' } },
      select: { status: true },
    });
    if (articles.some((a) => a.status === 'pending_research')) {
      throw new ApiError('Articles still being researched', 409);
    }

    const data = schema.parse(await request.json());

    await prisma.interview.upsert({
      where: { run_id: id },
      create: { run_id: id, questions: data.questions ?? undefined, status: 'pending' },
      update: { questions: data.questions ?? undefined, status: 'pending' },
    });

    await prisma.troubadorRun.update({ where: { id }, data: { stage: 'ready_for_interview' } });

    return NextResponse.json({
      run_id: id,
      stage: 'ready_for_interview',
      interview_status: 'pending',
    });
  } catch (error) {
    return handleApiError(error);
  }
}

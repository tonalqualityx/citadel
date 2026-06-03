import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { requireAuth } from '@/lib/auth/middleware';
import { handleApiError, ApiError } from '@/lib/api/errors';

const schema = z.object({
  transcript: z.string().optional(),
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

    if (run.stage !== 'ready_for_interview') {
      throw new ApiError('Run not ready for interview completion', 409);
    }

    const data = schema.parse(await request.json());

    await prisma.interview.upsert({
      where: { run_id: id },
      create: {
        run_id: id,
        status: 'complete',
        completed_at: new Date(),
        ...(data.transcript !== undefined && { transcript: data.transcript }),
      },
      update: {
        status: 'complete',
        completed_at: new Date(),
        ...(data.transcript !== undefined && { transcript: data.transcript }),
      },
    });

    await prisma.troubadorRun.update({ where: { id }, data: { stage: 'in_production' } });

    return NextResponse.json({
      run_id: id,
      stage: 'in_production',
      interview_status: 'complete',
    });
  } catch (error) {
    return handleApiError(error);
  }
}

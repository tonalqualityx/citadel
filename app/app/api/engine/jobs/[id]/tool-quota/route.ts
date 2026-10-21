import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { handleApiError, ApiError } from '@/lib/api/errors';
import { requireEngine } from '@/lib/engine/auth';
import { isLive } from '@/lib/engine/queue';
import { assertToolQuota, TOOLS } from '@/lib/engine/tool-calls';

// GET /api/engine/jobs/:id/tool-quota?tool=ga4_report (portal phase C, engine scope)
// The tool server asks BEFORE it spends a Google call. 200 { allowed: true } or 429 when the job has
// used its 6 calls or the client its 40 analytics calls a day. 409 when the job is not live.
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireEngine();
    const id = z.string().uuid().safeParse((await params).id);
    if (!id.success) throw new ApiError('Not found', 404);
    const tool = z.enum(TOOLS).safeParse(new URL(request.url).searchParams.get('tool'));
    if (!tool.success) throw new ApiError('Unknown tool', 400);
    const job = await prisma.engineJob.findUnique({ where: { id: id.data } });
    if (!job) throw new ApiError('Not found', 404);
    if (!isLive(job)) throw new ApiError('Job is not live', 409);
    await assertToolQuota(prisma, job, tool.data);
    return NextResponse.json({ allowed: true });
  } catch (error) {
    return handleApiError(error);
  }
}

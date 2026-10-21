import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { handleApiError, ApiError } from '@/lib/api/errors';
import { requireEngine } from '@/lib/engine/auth';
import { isLive } from '@/lib/engine/queue';
import { logToolCall, TOOLS } from '@/lib/engine/tool-calls';

const bodySchema = z.object({
  tool: z.enum(TOOLS),
  args: z.record(z.string(), z.unknown()),
  row_count: z.number().int().min(0).nullish(),
  latency_ms: z.number().int().min(0).nullish(),
  error: z.string().max(2000).nullish(),
  result: z.unknown().optional(),
});

// POST /api/engine/jobs/:id/tool-calls (portal phase C, engine scope)
// One row per tool call, posted BEFORE the result goes back to the model. Refuses (the tool then
// returns an error, not data) when the job is not live, or when a cap is hit: 6 calls a job and
// 40 analytics calls a client a day.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireEngine();
    const id = z.string().uuid().safeParse((await params).id);
    if (!id.success) throw new ApiError('Not found', 404);
    const body = bodySchema.parse(await request.json());
    const job = await prisma.engineJob.findUnique({ where: { id: id.data } });
    if (!job) throw new ApiError('Not found', 404);
    if (!isLive(job)) throw new ApiError('Job is not live', 409);
    const row = await logToolCall(job, body);
    return NextResponse.json({ id: row.id, tool_call_id: row.id }, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}

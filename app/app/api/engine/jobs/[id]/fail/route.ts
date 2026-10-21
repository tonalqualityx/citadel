import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { handleApiError, ApiError } from '@/lib/api/errors';
import { requireEngine } from '@/lib/engine/auth';
import { failJob, isLive } from '@/lib/engine/queue';
import { runSchema } from '@/lib/portal/chat/apply';
import { advanceTree } from '@/lib/portal/chat/tree-mode';

const bodySchema = z.object({ error: z.string().max(3000), runs: z.array(runSchema).max(6).default([]) });

// POST /api/engine/jobs/:id/fail { error, runs[] } (portal phase C, engine scope)
// The runner could not produce a result. The job is requeued once; the second failure marks it
// failed and the conversation runs the question tree. 409 when the job is not live.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireEngine();
    const id = z.string().uuid().safeParse((await params).id);
    if (!id.success) throw new ApiError('Not found', 404);
    const body = bodySchema.parse(await request.json());
    const job = await prisma.engineJob.findUnique({ where: { id: id.data } });
    if (!job) throw new ApiError('Not found', 404);
    if (!isLive(job)) return NextResponse.json({ error: 'Job is not live', code: 'expired' }, { status: 409 });
    for (const r of body.runs) {
      await prisma.engineRun.create({
        data: {
          job_id: job.id, attempt: r.attempt, model: r.model, prompt_hash: r.prompt_hash, input_tokens: r.input_tokens,
          cache_read_tokens: r.cache_read_tokens, cache_write_tokens: r.cache_write_tokens, output_tokens: r.output_tokens,
          cost_usd: r.cost_usd, duration_ms: r.duration_ms ?? null, duration_api_ms: r.duration_api_ms ?? null,
          num_turns: r.num_turns ?? null, is_error: r.is_error, rejected_text: r.rejected_text ?? null,
        },
      });
    }
    const outcome = await failJob(job.id, body.error);
    if (outcome === 'failed' && job.conversation_id) await advanceTree(job.conversation_id);
    return NextResponse.json({ outcome });
  } catch (error) {
    return handleApiError(error);
  }
}
